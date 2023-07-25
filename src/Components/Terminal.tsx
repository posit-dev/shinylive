import { ProxyHandle } from "./App";
import "./Terminal.css";
import * as React from "react";
import { Terminal as XTerminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { Readline } from "xterm-readline";
import "xterm/css/xterm.css";

export interface TerminalInterface {
  // Display code in the terminal as if it were typed, and execute it.
  exec(msg: string): Promise<void>;
  echo(msg: string): Promise<void>;
  error(msg: string): Promise<void>;
  clear(): void;
  set_exec_fn(fn: (x: string) => Promise<void>): void;
  set_echo_fn(fn: (x: string) => Promise<void>): void;
  set_error_fn(fn: (x: string) => Promise<void>): void;
  set_clear_fn(fn: () => void): void;
}

export type TerminalMethods =
  | { ready: false }
  | {
      ready: true;
      // Run code, and echo the code in the terminal.
      runCodeInTerminal: (command: string) => Promise<void>;
    };
// =============================================================================
// Terminal component
// =============================================================================
export function Terminal({
  proxyHandle,
  setTerminalMethods,
  terminalInterface,
}: {
  proxyHandle: ProxyHandle;
  setTerminalMethods: React.Dispatch<React.SetStateAction<TerminalMethods>>;
  terminalInterface: TerminalInterface;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const xTermRef = React.useRef<XTerminal | null>(null);
  const [xTermReadline, setXTermReadline] = React.useState<Readline>();

  const runCodeRef = React.useRef(async (command: string): Promise<string> => "");
  React.useEffect(() => {
    runCodeRef.current = async (command: string) => {
      if (!proxyHandle.ready) return "";
      return await proxyHandle.runCode(command) ?? ">>> ";
    };
  }, [proxyHandle]);

  const tabCompleteRef = React.useRef(
    async (command: string): Promise<string[]> => {
      return [];
    }
  );
  React.useEffect(() => {
    tabCompleteRef.current = async (command: string): Promise<string[]> => {
      if (!proxyHandle.ready) return [];
      return await proxyHandle.tabComplete(command);
    };
  }, [proxyHandle]);

  React.useEffect(() => {
    // Start up the terminal and populate our reference objects.
    if (!containerRef.current) return;
    // Only initialize once, even if this useEffect is run twice.
    if (xTermRef.current) return;

    const term = new XTerminal({
      theme: {
        background: "#FFFFFF",
        foreground: "#000000",
        cursor: "#000000",
        selectionBackground: "#9999CC",
      },
      // TODO: Set fonts from CSS?
      fontFamily: "Menlo, Monaco, Consolas, Liberation Mono, Courier New, Monospace",
      fontSize: 12,
    });
    const fitAddon = new FitAddon();
    const readline = new Readline();
    setXTermReadline(readline);

    term.loadAddon(fitAddon);
    term.loadAddon(readline);
    term.open(containerRef.current);

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    fitAddon.fit();

    term.write("Starting...\r\n");
    // const term = $(containerRef.current).terminal(interpreter, {
    //   greetings: "Starting Python...",
    //   prompt: "",
    //   mousewheel: () => true,
    //   scrollOnEcho: true,
    //   completionEscape: false,
    //   completion: function (command: string, callback: (x: string[]) => void) {
    //     (async () => {
    //       const completions = await tabCompleteRef.current(command);
    //       callback(completions);
    //     })();
    //   },
    //   keymap: {
    //     "CTRL+C": async function (_event: any, _original: any) {
    //       // @ts-expect-error: This is a bug in jquery.terminal. echo_command()
    //       // exists, but isn't listed in the .d.ts file.
    //       term.echo_command();
    //       term.echo("KeyboardInterrupt");
    //       term.set_command("");
    //       term.set_prompt(">>> ");
    //     },
    //   },
    //   // The onInit() and onFocus() callbacks are necessary to prevent the
    //   // browser from scrolling to the terminal when the terminal first
    //   // initializes and then is unfrozen (after Python loads).
    //   onInit: ($terminal) => {
    //     $terminal.find("textarea")[0].focus({ preventScroll: true });
    //   },
    //   onFocus: ($terminal) => {
    //     $terminal.find("textarea")[0].focus({ preventScroll: true });
    //   },
    // });

    xTermRef.current = term;

    // @ts-expect-error: Add the terminal object to the div. This is used for
    // testing so that we can find out when the terminal is ready. It would
    // be nice to not need to use this.
    containerRef.current.xterm = term;
  }, []);

  React.useEffect(() => {
    const xTermRefCurrent = xTermRef.current;
    if (!xTermRefCurrent) return;

    if (!xTermReadline) return;

    terminalInterface.set_exec_fn(async (msg: string) => {
      // await jqTermRefCurrent.exec(msg);
    });
    terminalInterface.set_echo_fn(async (msg: string) => {
      xTermReadline.println(msg);
    });
    terminalInterface.set_error_fn(async (msg: string) => {
      xTermReadline.println("\x1b[31m" + msg + "\x1b[m");
    });
    terminalInterface.set_clear_fn(() => {
      xTermRefCurrent.write("\x1b[2K\r");
    });

    const runCodeInTerminal = async (command: string): Promise<void> => {
      xTermReadline.println(command);
      const prompt = await runCodeRef.current(command);
      xTermReadline.print(prompt);
    };

    setTerminalMethods({
      ready: true,
      runCodeInTerminal,
    });
  }, [xTermReadline, terminalInterface, setTerminalMethods]);

  // TODO: Make sure this doesn't run twice
  React.useEffect(() => {
    if (!proxyHandle.ready) return;
    if (!xTermRef.current) return;

    xTermRef.current.write("\x1Bc");

    function readLine(prompt: string) {
      if (!xTermReadline) return;
      xTermReadline.read(prompt).then(processLine);
    }

    async function processLine(text: string) {
      if (!xTermReadline) return;
      const prompt = await runCodeRef.current(text);
      setTimeout(() => readLine(prompt));
    }

    readLine(proxyHandle.engine === "webr" ? '> ' : ">>> ");
  }, [proxyHandle, xTermReadline]);

  return <div ref={containerRef} className="shinylive-terminal"></div>;
}
