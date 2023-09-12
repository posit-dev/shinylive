import { ASGIHTTPRequestScope, makeHttpuvRequest } from "./messageporthttp.js";
import { openChannelHttpuv } from "./messageportwebsocket-channel.js";
import { Shelter, WebR, WebROptions } from "webr";
import type { EvalROptions } from "webr/webr-chan";

export interface WebRProxy {
  webR: WebR;
  toClientCache: { [key: string]: (event: Record<string, any>) => Promise<void> };

  runRAsync(
    code: string,
    options?: EvalROptions,
  ): Promise<any>;

  runCode(code: string): Promise<string>;

  openChannel(
    path: string,
    appName: string,
    clientPort: MessagePort
  ): Promise<void>;

  makeRequest(
    scope: ASGIHTTPRequestScope,
    appName: string,
    clientPort: MessagePort
  ): Promise<void>;
}

class WebRWorkerProxy implements WebRProxy {
  webR: WebR;
  shelter?: Shelter;
  prompt?: {
    resolve: (prompt: string) => void;
    reject: () => void;
  };
  toClientCache: WebRProxy['toClientCache'] = {};

  constructor(
    config: WebROptions,
    private stdoutCallback: (text: string) => void,
    private stderrCallback: (text: string) => void
  ) {
    this.webR = new WebR(config);
  }

  async runCode(code: string) {
    const waitForPrompt = new Promise<string>((resolve, reject) => {
      this.prompt = {
        resolve,
        reject,
      }
    });
    this.webR.writeConsole(code);
    return await waitForPrompt;
  }

  async runRAsync(
    code: string,
    options: EvalROptions = {},
  ): Promise<any> {
    if (!options.captureStreams) {
      options.captureStreams = false
    }
    if (!options.captureConditions) {
      options.captureConditions = false
    }
    await this.webR.init();
    if (!this.shelter) this.shelter = await new this.webR.Shelter();
    try {
      return await this.shelter.evalR(code, options);
    } catch (e) {
      this.stderrCallback((e as Error).message);
    } finally {
      this.shelter.purge();
    }
  }

  run() {
    this.#run();
  }

  async #run() {
    await this.webR.init();
    for (;;) {
      const output = await this.webR.read();
      switch (output.type) {
        case 'stdout':
          this.stdoutCallback(output.data);
          break;
        case 'stderr':
          this.stderrCallback(output.data);
          break;
        case 'prompt':
          if (this.prompt) {
            this.prompt.resolve(output.data);
          }
          break;
        case '_webR_httpuv_WSResponse': {
          const type = output.data.value[0];
          const appName = output.data.value[1]
          const message = output.data.value[2];
          const toClient = this.toClientCache[appName];
          if (typeof toClient !== 'undefined') toClient({ type, message });
          break;
        }
        default:
          break;
      }
    }
  }

  async openChannel(
    path: string,
    appName: string,
    clientPort: MessagePort
  ): Promise<void> {
    openChannelHttpuv(path, appName, clientPort, this);
  }

  async makeRequest(
    scope: ASGIHTTPRequestScope,
    appName: string,
    clientPort: MessagePort
  ): Promise<void> {
    makeHttpuvRequest(scope, appName, clientPort, this);
  }
}

export async function loadWebRProxy(
  config: WebROptions,
  stdoutCallback: (text: string) => void = console.log,
  stderrCallback: (text: string) => void = console.error
): Promise<WebRProxy> {
  const webRProxy = new WebRWorkerProxy(config, stdoutCallback, stderrCallback);
  await webRProxy.webR.init;
  webRProxy.run();
  return webRProxy;
}
