import * as React from "react";
import ReactDOM from "react-dom";
import LZString from "lz-string";
import {
  initPyodide,
  initShiny,
  PyodideProxyHandle,
  usePyodide,
} from "../hooks/usePyodide";
import { ProxyType } from "../pyodide-proxy";
import "./App.css";
import Editor from "./Editor";
import { getExampleCategories, findExampleByTitle } from "../examples";
import ExampleSelector from "./ExampleSelector";
import {
  completeFileContents,
  FileContent,
  FileContentInput,
} from "./filecontent";
import OutputCell from "./OutputCell";
import ResizableGrid from "./ResizableGrid/ResizableGrid";
import Terminal, { TerminalInterface, TerminalMethods } from "./Terminal";
import Viewer, { ViewerMethods } from "./Viewer";

const terminalInterface: TerminalInterface = (() => {
  let _exec = async (x: string) => console.log("preload exec:" + x);
  let _echo = async (x: string) => console.log("preload echo:" + x);
  let _error = async (x: string) => console.error("preload error:" + x);
  let _clear = () => {};

  return {
    exec: async (x: string): Promise<void> => _exec(x),
    echo: async (x: string): Promise<void> => _echo(x),
    error: async (x: string): Promise<void> => _error(x),
    clear: (): void => _clear(),
    set_exec_fn: (fn: (x: string) => Promise<void>): void => {
      _exec = fn;
    },
    set_echo_fn: (fn: (x: string) => Promise<void>): void => {
      _echo = fn;
    },
    set_error_fn: (fn: (x: string) => Promise<void>): void => {
      _error = fn;
    },
    set_clear_fn: (fn: () => void): void => {
      _clear = fn;
    },
  };
})();

const pyodideProxyType: ProxyType =
  new URLSearchParams(window.location.search).get("webworker") === "0"
    ? "normal"
    : "webworker";

export type AppMode =
  | "examples-editor-terminal-viewer"
  | "editor-terminal-viewer"
  | "editor-terminal"
  | "editor-viewer"
  | "editor-cell"
  | "viewer";

type EditorViewerOptions = {
  /**
   * What orientation should we layout the app? Currently this only gets applied
   * to the editor-viewer app mode
   */
  layout?: "horizontal" | "vertical";
  /**
   * Height of viewer in pixels
   */
  viewerHeight?: number;
};

let pyodideProxyHandlePromise: Promise<PyodideProxyHandle> | null = null;

function ensurePyodideProxyHandlePromise({
  proxyType,
  shiny,
  showStartBanner,
}: {
  proxyType: ProxyType;
  shiny: boolean;
  showStartBanner: boolean;
}): Promise<PyodideProxyHandle> {
  if (!pyodideProxyHandlePromise) {
    pyodideProxyHandlePromise = (async (): Promise<PyodideProxyHandle> => {
      let pyodideProxyHandle = await initPyodide({
        proxyType,
        stdout: terminalInterface.echo,
        stderr: terminalInterface.error,
      });

      if (shiny) {
        pyodideProxyHandle = await initShiny({ pyodideProxyHandle });
      }

      if (!pyodideProxyHandle.initError) {
        terminalInterface.clear();

        if (showStartBanner) {
          // When we get here, .ready will always be true.
          if (pyodideProxyHandle.ready) {
            await pyodideProxyHandle.pyodide.runPyAsync(
              `print(pyodide.console.BANNER); print(" ")`
            );
          }
        }
      }

      return pyodideProxyHandle;
    })();
  }
  return pyodideProxyHandlePromise;
}

export default function App({
  appMode = "examples-editor-terminal-viewer",
  startFiles = [],
  editorViewerOptions = {},
}: {
  appMode: AppMode;
  startFiles: FileContent[];
  editorViewerOptions?: EditorViewerOptions;
}) {
  let autoSelectExample = false;

  if (startFiles.length === 0) {
    startFiles = [
      {
        name: "blank.py",
        content: "",
        type: "text",
      },
    ];

    autoSelectExample = true;
  }

  // For most but not all appMode, set up pyodide for shiny.
  const loadShiny = !["editor-terminal"].includes(appMode);

  // Temporarily disabled
  // Modes in which _not_ to show Pyodide startup message.
  // const showStartBanner = !["editor-terminal"].includes(appMode);
  pyodideProxyHandlePromise = ensurePyodideProxyHandlePromise({
    proxyType: pyodideProxyType,
    shiny: loadShiny,
    showStartBanner: false,
  });
  const pyodideProxyHandle = usePyodide({ pyodideProxyHandlePromise });

  const [viewerMethods, setViewerMethods] = React.useState<ViewerMethods>({
    ready: false,
  });

  // TODO: Customize these methods so that print output is sent to the specific
  // terminal.
  const [terminalMethods, setTerminalMethods] = React.useState<TerminalMethods>(
    {
      ready: false,
    }
  );

  const [currentFiles, setCurrentFiles] =
    React.useState<FileContent[]>(startFiles);
  const [filesHaveChanged, setFilesHaveChanged] =
    React.useState<boolean>(false);

  React.useEffect(() => {
    if (appMode === "viewer" && viewerMethods.ready) {
      viewerMethods.runApp(currentFiles);
    }
  }, [appMode, currentFiles, viewerMethods]);

  switch (appMode) {
    case "examples-editor-terminal-viewer":
      return (
        <ResizableGrid
          className="App--container"
          areas={[
            ["exampleselector", "editor", "viewer"],
            ["exampleselector", "terminal", "viewer"],
          ]}
          rowSizes={["2fr", "1fr"]}
          colSizes={["180px", "1.5fr", "1fr"]}
        >
          <ExampleSelector
            setCurrentFiles={setCurrentFiles}
            filesHaveChanged={filesHaveChanged}
            autoSelectExample={autoSelectExample}
          />
          <Editor
            currentFilesFromApp={currentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            viewerMethods={viewerMethods}
            runOnLoad={currentFiles.some((file) => file.name === "app.py")}
            showShareButton={true}
          />
          <Terminal
            pyodideProxyHandle={pyodideProxyHandle}
            setTerminalMethods={setTerminalMethods}
            terminalInterface={terminalInterface}
          />
          <Viewer
            pyodideProxyHandle={pyodideProxyHandle}
            setViewerMethods={setViewerMethods}
          />
        </ResizableGrid>
      );

    case "editor-terminal-viewer":
      return (
        <ResizableGrid
          className="App--container"
          areas={[
            ["editor", "viewer"],
            ["terminal", "viewer"],
          ]}
          rowSizes={["2fr", "1fr"]}
          colSizes={["1.5fr", "1fr"]}
        >
          <Editor
            currentFilesFromApp={currentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            viewerMethods={viewerMethods}
            runOnLoad={currentFiles.some((file) => file.name === "app.py")}
            showShareButton={true}
          />
          <Terminal
            pyodideProxyHandle={pyodideProxyHandle}
            setTerminalMethods={setTerminalMethods}
            terminalInterface={terminalInterface}
          />
          <Viewer
            pyodideProxyHandle={pyodideProxyHandle}
            setViewerMethods={setViewerMethods}
          />
        </ResizableGrid>
      );

    case "editor-terminal":
      return (
        <ResizableGrid
          className="App--container"
          areas={[["editor", "terminal"]]}
          rowSizes={["1fr"]}
          colSizes={["1fr", "1fr"]}
        >
          <Editor
            currentFilesFromApp={currentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            runOnLoad={false}
            showShareButton={false}
          />
          <Terminal
            pyodideProxyHandle={pyodideProxyHandle}
            setTerminalMethods={setTerminalMethods}
            terminalInterface={terminalInterface}
          />
        </ResizableGrid>
      );

    case "editor-cell":
      return (
        <div className="App--container editor-cell">
          <Editor
            currentFilesFromApp={currentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            showFileTabs={false}
            lineNumbers={false}
            showHeaderBar={false}
            floatingButtons={true}
            showShareButton={false}
          />
          <OutputCell
            pyodideProxyHandle={pyodideProxyHandle}
            setTerminalMethods={setTerminalMethods}
          />
        </div>
      );

    case "editor-viewer": {
      const layout = editorViewerOptions.layout ?? "horizontal";
      const viewerHeight = Number(editorViewerOptions.viewerHeight ?? 200);

      const gridDef =
        layout === "horizontal"
          ? {
              areas: [["editor", "viewer"]],
              rowSizes: ["1fr"],
              colSizes: ["1fr", "1fr"],
            }
          : {
              areas: [["editor"], ["viewer"]],
              rowSizes: ["auto", `${viewerHeight}px`],
              colSizes: ["1fr"],
            };

      return (
        <ResizableGrid className="App--container editor-viewer" {...gridDef}>
          <Editor
            currentFilesFromApp={currentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            viewerMethods={viewerMethods}
            showShareButton={false}
          />
          <Viewer
            pyodideProxyHandle={pyodideProxyHandle}
            setViewerMethods={setViewerMethods}
          />
        </ResizableGrid>
      );
    }
    case "viewer":
      return (
        <div className="App--container viewer">
          <Viewer
            pyodideProxyHandle={pyodideProxyHandle}
            setViewerMethods={setViewerMethods}
          />
        </div>
      );

    default:
      throw new Error("Have yet to setup this view mode");
  }
}

// The exported function that can be used for embedding into another app
export function runApp(
  domTarget: HTMLElement,
  appMode: AppMode,
  startFiles: FileContentInput[] | "auto" = "auto",
  args?: EditorViewerOptions
) {
  (async () => {
    if (startFiles === "auto") {
      // Use the hash to determine which example to load. If no match is found,
      // it defaults to the first example.
      const hashContent = window.location.hash.replace(/^#/, "");

      if (hashContent.startsWith("code=")) {
        try {
          const codeEncoded = hashContent.replace("code=", "");
          // Returns null if decoding fails
          const code = LZString.decompressFromEncodedURIComponent(codeEncoded);
          if (code) {
            // Throws if parsing fails
            startFiles = JSON.parse(code) as FileContentInput[];
          }
        } catch (e) {
          // Do nothing
        }

        if (startFiles === "auto") {
          console.log("Could not parse JSON from URL hash.");
          startFiles = [];
        }
      } else {
        const exampleCategories = await getExampleCategories();
        const pos = findExampleByTitle(hashContent, exampleCategories);
        if (pos) {
          startFiles = exampleCategories[pos.categoryIndex].apps[pos.index]
            .files as FileContentInput[]; // A little help for type checker.
        } else {
          startFiles = [];
        }
      }
    }

    const { layout, viewerHeight, ...unusedArgs } = args ?? {};

    if (Object.keys(unusedArgs).length > 0) {
      console.warn(
        "The following arguments were detected but not used in running app",
        unusedArgs
      );
    }

    ReactDOM.render(
      <React.StrictMode>
        <App
          appMode={appMode}
          startFiles={completeFileContents(startFiles)}
          editorViewerOptions={{ layout, viewerHeight }}
        />
      </React.StrictMode>,
      domTarget
    );
  })();
}
