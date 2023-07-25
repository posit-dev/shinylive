import { ProxyHandle } from "./App";
import { ToHtmlResult } from "../pyodide-proxy";
import "./OutputCell.css";
import { TerminalMethods } from "./Terminal";
import * as React from "react";

// =============================================================================
// OutputCell component
// =============================================================================
export function OutputCell({
  proxyHandle,
  setTerminalMethods,
}: {
  proxyHandle: ProxyHandle;
  setTerminalMethods: React.Dispatch<React.SetStateAction<TerminalMethods>>;
}) {
  const [content, setContent] = React.useState<ToHtmlResult>({
    type: "text",
    value: "",
  });

  React.useEffect(() => {
    const runCodeInTerminal = async (command: string): Promise<void> => {
      if (!proxyHandle.ready) return;
      if (proxyHandle.engine !== "pyodide") return;

      try {
        const result = await proxyHandle.pyodide.runPyAsync(command, {
          returnResult: "to_html",
          printResult: false,
        });

        setContent(result);
      } catch (e) {
        setContent({ type: "text", value: (e as Error).message });
      }
    };

    setTerminalMethods({
      ready: true,
      runCodeInTerminal,
    });
  }, [setTerminalMethods, proxyHandle]);

  React.useEffect(() => {
    const runCodeInTerminal = async (command: string): Promise<void> => {
      if (!proxyHandle.ready) return;
      if (proxyHandle.engine !== "webr") return;

      try {
        // TODO: Better convert output of runRAsync into HTML format
        const result = await proxyHandle.webRProxy.runRAsync(command);
        const output = JSON.stringify(await result.toJs());
        setContent({ type: "text", value: output });
      } catch (e) {
        setContent({ type: "text", value: (e as Error).message });
      }
    };

    setTerminalMethods({
      ready: true,
      runCodeInTerminal,
    });
  }, [setTerminalMethods, proxyHandle]);

  return (
    <div className="shinylive-output-cell">
      {content.type === "html" ? (
        <div
          className="rendered-html"
          dangerouslySetInnerHTML={{ __html: content.value }}
        ></div>
      ) : (
        <pre className="output-content">
          <code className="output-content">{content.value}</code>
        </pre>
      )}
    </div>
  );
}
