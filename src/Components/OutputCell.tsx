import * as React from "react";
import { ToHtmlResult } from "../pyodide-proxy";
import { ProxyHandle } from "./App";
import "./OutputCell.css";
import { TerminalMethods } from "./Terminal";

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
    if (!proxyHandle.ready) return;
    if (proxyHandle.engine !== "pyodide") return;

    const runCodeInTerminal = async (command: string): Promise<void> => {
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
    if (!proxyHandle.ready) return;
    if (proxyHandle.engine !== "webr") return;

    const runCodeInTerminal = async (command: string): Promise<void> => {
      const shelter = await new proxyHandle.webRProxy.webR.Shelter();
      try {
        const ret = await shelter.captureR(command, {
          withAutoprint: true,
          captureConditions: false,
          captureStreams: true,
        });
        const output = ret.output as { type: string; data: string }[];
        setContent({
          type: "text",
          value: output
            .map((line: { type: string; data: string }) => line.data)
            .join("\n"),
        });
      } catch (e) {
        setContent({ type: "text", value: (e as Error).message });
      } finally {
        shelter.purge();
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
