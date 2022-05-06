import * as React from "react";
import { ToHtmlResult } from "../pyodide-proxy";
import { PyodideProxyHandle } from "../hooks/usePyodide";
import { TerminalMethods } from "./Terminal";
import "./OutputCell.css";

// =============================================================================
// OutputCell component
// =============================================================================
export default function OutputCell({
  pyodideProxyHandle,
  setTerminalMethods,
}: {
  pyodideProxyHandle: PyodideProxyHandle;
  setTerminalMethods: React.Dispatch<React.SetStateAction<TerminalMethods>>;
}) {
  const [content, setContent] = React.useState<ToHtmlResult>({
    type: "text",
    content: "",
  });

  React.useEffect(() => {
    const runCodeInTerminal = async (command: string): Promise<void> => {
      if (!pyodideProxyHandle.ready) return;

      const result = (await pyodideProxyHandle.pyodide.runPythonAsync(command, {
        returnResult: "to_html",
        printResult: false,
      })) as ToHtmlResult;

      setContent(result);
    };

    setTerminalMethods({
      ready: true,
      runCodeInTerminal,
    });
  }, [setTerminalMethods, pyodideProxyHandle]);

  return (
    <div className="OutputCell">
      {content.type === "html" ? (
        <div
          className="rendered_html"
          dangerouslySetInnerHTML={{ __html: content.content }}
        ></div>
      ) : (
        <pre className="sourceCode">
          <code className="sourceCode">{content.content}</code>
        </pre>
      )}
    </div>
  );
}
