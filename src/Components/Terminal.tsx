/// <reference types="jquery.terminal" />
/// <reference types="jquery" />

import * as React from "react";

import { PyodideProxyHandle } from "../hooks/usePyodide";
import "./Terminal.css";

declare global {
  interface Window {
    jQuery: typeof jQuery;
    $: typeof jQuery;
    term: JQueryTerminal;
  }
}

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
  const jqTermRef = React.useRef<JQueryTerminal | null>(null);

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

    const term = $(containerRef.current).terminal(interpreter, {
      greetings: "Starting Python...",
      prompt: "",
      scrollOnEcho: true,
      completionEscape: false,
      completion: function (command: string, callback: (x: string[]) => void) {
        (async () => {
          const completions = await tabCompleteRef.current(command);
          callback(completions);
        })();
      },
      keymap: {
        "CTRL+C": async function (_event: any, _original: any) {
          // @ts-expect-error: This is a bug in jquery.terminal. echo_command()
          // exists, but isn't listed in the .d.ts file.
          term.echo_command();
          term.echo("KeyboardInterrupt");
          term.set_command("");
          term.set_prompt(">>> ");
        },
      },
      // The onInit() and onFocus() callbacks are necessary to prevent the
      // browser from scrolling to the terminal when the terminal first
      // initializes and then is unfrozen (after Python loads).
      onInit: ($terminal) => {
        $terminal.find("textarea")[0].focus({ preventScroll: true });
      },
      onFocus: ($terminal) => {
        $terminal.find("textarea")[0].focus({ preventScroll: true });
      },
    });

    term.freeze(true);

    async function interpreter(command: string) {
      try {
        term.pause();
        await runCodeRef.current(command);
        term.resume();
      } catch (e) {
        if (e instanceof Error) {
          console.error(e.message);
        } else {
          console.error(e);
        }
      }
    }

    jqTermRef.current = term;
  }, []);

  React.useEffect(() => {
    const jqTermRefCurrent = jqTermRef.current;
    if (!jqTermRefCurrent) return;

    terminalInterface.set_exec_fn(async (msg: string) => {
      await jqTermRefCurrent.exec(msg);
    });
    terminalInterface.set_echo_fn(async (msg: string) => {
      await jqTermRefCurrent.echo(msg);
    });
    terminalInterface.set_error_fn(async (msg: string) => {
      jqTermRefCurrent.error(msg);
    });
    terminalInterface.set_clear_fn(() => {
      jqTermRefCurrent.clear();
    });

    const runCodeInTerminal = async (command: string): Promise<void> => {
      await jqTermRefCurrent.exec(command);
    };

    setTerminalMethods({
      ready: true,
      runCodeInTerminal,
    });
  }, [jqTermRef.current]);

  React.useEffect(() => {
    if (!pyodideProxyHandle.ready) return;
    if (!jqTermRef.current) return;

    jqTermRef.current.freeze(false);
    jqTermRef.current.set_prompt(">>> ");
  }, [pyodideProxyHandle.ready]);

  return <div ref={containerRef} className="Terminal"></div>;
}
