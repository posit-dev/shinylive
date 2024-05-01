import LZString from "lz-string";
import type * as LZStringWorker from "../lzstring-worker";
import * as utils from "../utils";
import type { AppEngine } from "./App";
import type { FileContent } from "./filecontent";
import { FCtoFCJSON } from "./filecontent";

const shortEngine = {
  python: "py",
  r: "r",
};
export function editorUrlPrefix(engine: AppEngine) {
  return `https://shinylive.io/${shortEngine[engine]}/editor/`;
}

export function appUrlPrefix(engine: AppEngine) {
  return `https://shinylive.io/${shortEngine[engine]}/app/`;
}

/**
 * Given a FileContent[] object, return a string that is a LZ-compressed JSON
 * representation of it.
 */
export function fileContentsToUrlString(
  fileContents: FileContent[],
  sort: boolean = true,
): string {
  if (sort) {
    fileContents.sort((a, b) => a.name.localeCompare(b.name));
  }
  return LZString.compressToEncodedURIComponent(
    JSON.stringify(fileContents.map(FCtoFCJSON)),
  );
}

/**
 * Given a FileContent[] object, return a string that is a LZ-compressed JSON
 * representation of it. This version uses a web worker to do the compression.
 */
export async function fileContentsToUrlStringInWebWorker(
  fileContents: FileContent[],
  sort: boolean = true,
): Promise<string> {
  if (sort) {
    fileContents.sort((a, b) => a.name.localeCompare(b.name));
  }
  const fileContentJsonString = JSON.stringify(fileContents.map(FCtoFCJSON));
  return await encodeLzstringWebWorker(fileContentJsonString);
}

// =============================================================================
// Code for calling lzstring with a web worker
// =============================================================================

// Narrow the types for postMessage to just the type we'll actually send.
interface LZStringWebWorker extends Omit<Worker, "postMessage"> {
  postMessage(
    msg: LZStringWorker.RequestMessage,
    transfer: Transferable[],
  ): void;
}

let _lzstringWebWorker: LZStringWebWorker | null = null;

/**
 * Ensure that the lzstring web worker exists.
 *
 * @returns The lzstring web worker. If it doesn't exist, it will be created.
 */
function ensureLzstringWebWorker(): LZStringWebWorker {
  if (_lzstringWebWorker === null) {
    _lzstringWebWorker = new Worker(
      utils.currentScriptDir() + "/lzstring-worker.js",
      { type: "module" },
    );
  }
  return _lzstringWebWorker;
}

/**
 * Compress a string using lzstring in a web worker.
 */
async function encodeLzstringWebWorker(value: string): Promise<string> {
  const response = await postMessageLzstringWebWorker({
    type: "encode",
    value,
  });
  return response.value;
}

/**
 * Send a message to the lzstring web worker and return a promise that resolves
 * when the worker responds.
 */
async function postMessageLzstringWebWorker(
  msg: LZStringWorker.RequestMessage,
): Promise<LZStringWorker.ResponseMessage> {
  const worker = ensureLzstringWebWorker();

  return new Promise((onSuccess) => {
    const channel = new MessageChannel();

    channel.port1.onmessage = (e) => {
      channel.port1.close();
      const msg = e.data as LZStringWorker.ResponseMessage;
      onSuccess(msg);
    };

    worker.postMessage(msg, [channel.port2]);
  });
}
