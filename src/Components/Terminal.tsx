import { PyodideProxyHandle } from "../hooks/usePyodide";
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
  pyodideProxyHandle,
  setTerminalMethods,
  terminalInterface,
}: {
  pyodideProxyHandle: PyodideProxyHandle;
  setTerminalMethods: React.Dispatch<React.SetStateAction<TerminalMethods>>;
  terminalInterface: TerminalInterface;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const xTermRef = React.useRef<XTerminal | null>(null);
  const [xTermReadline, setXTermReadline] = React.useState<Readline>();

  const runCodeRef = React.useRef(async (command: string): Promise<void> => {});
  React.useEffect(() => {
    runCodeRef.current = async (command: string): Promise<void> => {
      if (!pyodideProxyHandle.ready) return;
      await pyodideProxyHandle.runCode(command);
    };
  }, [pyodideProxyHandle]);

  const tabCompleteRef = React.useRef(
    async (command: string): Promise<string[]> => {
      return [];
    }
  );
  React.useEffect(() => {
    tabCompleteRef.current = async (command: string): Promise<string[]> => {
      if (!pyodideProxyHandle.ready) return [];
      return await pyodideProxyHandle.tabComplete(command);
    };
  }, [pyodideProxyHandle]);

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
        selection: "#9999CC",
      },
      // TODO: Set fonts from CSS?
      fontFamily: "Menlo, Monaco, Courier New, Monospace",
      fontSize: 12,
    });
    const fitAddon = new FitAddon();
    const readline = new Readline();
    setXTermReadline(readline);

    term.loadAddon(fitAddon);
    term.loadAddon(readline);
    term.open(containerRef.current);

    fitAddon.fit();
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    term.focus();

    fitAddon.fit();

    function resizeTerm() {
      (async () => {
        const dims = fitAddon.proposeDimensions();
      })();
      fitAddon.fit();
    }
    // TODO: Add event listener
    window.addEventListener("resize", resizeTerm);

    term.write("Starting Python...\r\n");
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

    // term.freeze(true);

    // async function interpreter(command: string) {
    //   try {
    //     term.pause();
    //     await runCodeRef.current(command);
    //     term.resume();
    //   } catch (e) {
    //     if (e instanceof Error) {
    //       console.error(e.message);
    //     } else {
    //       console.error(e);
    //     }
    //   }
    // }
    // console.log("Printing stuff");
    // term.write("\x1b[2K\r");
    // term.write("\x1B[1;3;31mxterm.js\x1B[0m");

    resizeTerm();
    xTermRef.current = term;
    // jqTermRef.current = term;
  }, []);

  React.useEffect(() => {
    const xTermRefCurrent = xTermRef.current;
    if (!xTermRefCurrent) return;

    if (!xTermReadline) return;

    terminalInterface.set_exec_fn(async (msg: string) => {
      // await jqTermRefCurrent.exec(msg);
    });
    terminalInterface.set_echo_fn(async (msg: string) => {
      console.log("PRINTING STDOUT");
      xTermReadline.println(msg as string);
      // await xTermRefCurrent.echo(msg);
    });
    terminalInterface.set_error_fn(async (msg: string) => {
      console.log("PRINTING STDERR");
      xTermReadline.println(msg as string);
      // jqTermRefCurrent.error(msg);
    });
    terminalInterface.set_clear_fn(() => {
      console.log("CLEAR FUNCTION");
      xTermRefCurrent.write("\x1b[2K\r");
      // jqTermRefCurrent.clear();
    });

    const runCodeInTerminal = async (command: string): Promise<void> => {
      // if (!xTermReadline) return;
      xTermReadline.println(command);
      await runCodeRef.current(command);
      xTermReadline.print(">>> ");
      console.log("RUN CODE IN TERMINAL");
      // await jqTermRefCurrent.exec(command);
    };

    setTerminalMethods({
      ready: true,
      runCodeInTerminal,
    });
  }, [xTermReadline, terminalInterface, setTerminalMethods]);

  // TODO: Make sure this doesn't run twice
  React.useEffect(() => {
    if (!pyodideProxyHandle.ready) return;
    if (!xTermRef.current) return;

    xTermRef.current.write("\x1Bc");

    function readLine() {
      if (!xTermReadline) return;
      xTermReadline.read(">>> ").then(processLine);
    }

    async function processLine(text: string) {
      if (!xTermReadline) return;
      await runCodeRef.current(text);
      setTimeout(readLine);
    }

    readLine();
  }, [pyodideProxyHandle.ready, xTermReadline]);

  // React.useEffect(() => {
  //   if (!pyodideProxyHandle.ready) return;
  //   if (!jqTermRef.current) return;

  //   jqTermRef.current.freeze(false);
  //   jqTermRef.current.set_prompt(">>> ");
  // }, [pyodideProxyHandle.ready]);

  return <div ref={containerRef} className="shinylive-terminal"></div>;
}
