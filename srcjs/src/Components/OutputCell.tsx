import * as React from "react";
import { PyodideProxyHandle } from "../hooks/usePyodide";
import { TerminalMethods } from "./Terminal";

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
  const [content, setContent] = React.useState<string>("");

  React.useEffect(() => {
    const runCodeInTerminal = async (command: string): Promise<void> => {
      if (!pyodideProxyHandle.ready) return;

      const result = await pyodideProxyHandle.pyodide.runPythonAsync(command, {
        returnResult: "printed_value",
        printResult: false,
      });
      setContent(result);
    };

    setTerminalMethods({
      ready: true,
      runCodeInTerminal,
    });
  }, [setTerminalMethods, pyodideProxyHandle]);

  return (
    <pre className="OutputCell sourceCode">
      <code className="sourceCode">{content}</code>
    </pre>
  );
}
