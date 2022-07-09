import {
  findExampleByTitle,
  getExampleCategories,
  sanitizeTitleForUrl,
} from "../examples";
import {
  initPyodide,
  initShiny,
  PyodideProxyHandle,
  usePyodide,
} from "../hooks/usePyodide";
import { ProxyType } from "../pyodide-proxy";
import "./App.css";
import { ExampleSelector } from "./ExampleSelector";
import { OutputCell } from "./OutputCell";
import { ResizableGrid } from "./ResizableGrid/ResizableGrid";
import { Terminal, TerminalInterface, TerminalMethods } from "./Terminal";
import { Viewer, ViewerMethods } from "./Viewer";
import { FCorFCJSONtoFC, FileContent, FileContentJson } from "./filecontent";
import { fetchGist, gistApiResponseToFileContents } from "./gist";
import LZString from "lz-string";
import * as React from "react";
import { createRoot } from "react-dom/client";

// Load Editor component dynamically and lazily because it's large and not
// needed for all configurations.
const Editor = React.lazy(() => import("./Editor"));

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

export type UtilityMethods = {
  formatCode: (code: string) => Promise<string>;
};

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

type AppOptions = {
  // An optional set of files to start with.
  startFiles?: FileContentJson[] | FileContent[];

  // What orientation should we layout the app? Currently this only gets applied
  // to the editor-viewer app mode.
  layout?: "horizontal" | "vertical";

  // Height of viewer in pixels.
  viewerHeight?: number;

  // If the ExampleSelector component is present, which example, if any, should
  // start selected?
  selectedExample?: string;
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

export function App({
  appMode = "examples-editor-terminal-viewer",
  startFiles = [],
  appOptions = {},
}: {
  appMode: AppMode;
  startFiles: FileContent[];
  appOptions?: AppOptions;
}) {
  if (startFiles.length === 0) {
    if (appMode.includes("viewer")) {
      // If we're in a mode with the Shiny app viewer panel, the template should
      // be a Shiny app. If we're not, then the template should be a plain
      // script.
      startFiles = [
        {
          name: "app.py",
          content: shinyAppTemplate,
          type: "text",
        },
      ];
    } else {
      startFiles = [
        {
          name: "script.py",
          content: pythonScriptTemplate,
          type: "text",
        },
      ];
    }
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

  // Experimental code: For non-apps, save the code to /home/pyodide. This will
  // probably have to change in the future, because it (1) doesn't work well
  // with multiple instances on a page, and (2) files that are modified in the
  // editor won't be saved.
  React.useEffect(() => {
    (async () => {
      if (!pyodideProxyHandle.ready) return;
      if (currentFiles.some((file) => file.name === "app.py")) return;

      // Save the code in /home/pyodide
      await pyodideProxyHandle.pyodide.callPyAsync({
        fnName: ["_save_files"],
        kwargs: {
          files: currentFiles,
          destdir: "/home/pyodide",
          rm_destdir: false,
        },
      });
    })();
  }, [pyodideProxyHandle.ready, currentFiles]);

  const [utilityMethods, setUtilityMethods] = React.useState<UtilityMethods>({
    formatCode: async (code: string) => {
      return code;
    },
  });

  React.useEffect(() => {
    if (!pyodideProxyHandle.ready) return;

    setUtilityMethods({
      formatCode: async (code: string) => {
        const result = await pyodideProxyHandle.pyodide.callPyAsync({
          fnName: ["_format_py_code"],
          args: [code],
          returnResult: "value",
        });
        return result;
      },
    });
    if (currentFiles.some((file) => file.name === "app.py")) return;
  }, [pyodideProxyHandle.ready, currentFiles]);
  if (appMode === "examples-editor-terminal-viewer") {
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
          startWithSelectedExample={appOptions.selectedExample}
        />
        <React.Suspense fallback={<div>Loading...</div>}>
          <Editor
            currentFilesFromApp={currentFiles}
            setCurrentFiles={setCurrentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            viewerMethods={viewerMethods}
            utilityMethods={utilityMethods}
            runOnLoad={currentFiles.some((file) => file.name === "app.py")}
            showLoadSaveButtons={true}
            showOpenWindowButton={true}
            showShareButton={true}
          />
        </React.Suspense>
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
  } else if (appMode === "editor-terminal-viewer") {
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
        <React.Suspense fallback={<div>Loading...</div>}>
          <Editor
            currentFilesFromApp={currentFiles}
            setCurrentFiles={setCurrentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            viewerMethods={viewerMethods}
            utilityMethods={utilityMethods}
            runOnLoad={currentFiles.some((file) => file.name === "app.py")}
            showLoadSaveButtons={true}
            showOpenWindowButton={true}
            showShareButton={true}
          />
        </React.Suspense>
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
  } else if (appMode === "editor-terminal") {
    return (
      <ResizableGrid
        className="App--container"
        areas={[["editor", "terminal"]]}
        rowSizes={["1fr"]}
        colSizes={["1fr", "1fr"]}
      >
        <React.Suspense fallback={<div>Loading...</div>}>
          <Editor
            currentFilesFromApp={currentFiles}
            setCurrentFiles={setCurrentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            utilityMethods={utilityMethods}
            runOnLoad={false}
            showLoadSaveButtons={false}
            showOpenWindowButton={true}
            showShareButton={false}
          />
        </React.Suspense>
        <Terminal
          pyodideProxyHandle={pyodideProxyHandle}
          setTerminalMethods={setTerminalMethods}
          terminalInterface={terminalInterface}
        />
      </ResizableGrid>
    );
  } else if (appMode === "editor-cell") {
    return (
      <div className="App--container editor-cell">
        <React.Suspense fallback={<div>Loading...</div>}>
          <Editor
            currentFilesFromApp={currentFiles}
            setCurrentFiles={setCurrentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            utilityMethods={utilityMethods}
            showFileTabs={false}
            lineNumbers={false}
            showHeaderBar={false}
            floatingButtons={true}
            showShareButton={false}
            showLoadSaveButtons={false}
          />
        </React.Suspense>
        <OutputCell
          pyodideProxyHandle={pyodideProxyHandle}
          setTerminalMethods={setTerminalMethods}
        />
      </div>
    );
  } else if (appMode === "editor-viewer") {
    const layout = appOptions.layout ?? "horizontal";
    const viewerHeight = Number(appOptions.viewerHeight ?? 200);

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
        <React.Suspense fallback={<div>Loading...</div>}>
          <Editor
            currentFilesFromApp={currentFiles}
            setCurrentFiles={setCurrentFiles}
            setFilesHaveChanged={setFilesHaveChanged}
            terminalMethods={terminalMethods}
            utilityMethods={utilityMethods}
            viewerMethods={viewerMethods}
            showLoadSaveButtons={false}
            showOpenWindowButton={true}
            showShareButton={false}
          />
        </React.Suspense>
        <Viewer
          pyodideProxyHandle={pyodideProxyHandle}
          setViewerMethods={setViewerMethods}
        />
      </ResizableGrid>
    );
  } else if (appMode === "viewer") {
    return (
      <div className="App--container viewer">
        <Viewer
          pyodideProxyHandle={pyodideProxyHandle}
          setViewerMethods={setViewerMethods}
        />
      </div>
    );
  } else {
    throw new Error("Have yet to setup this view mode");
  }
}

// The exported function that can be used for embedding into a web page.
export function runApp(
  domTarget: HTMLElement,
  mode: AppMode,
  opts: AppOptions & {
    allowCodeUrl?: boolean;
    allowGistUrl?: boolean;
    allowExampleUrl?: boolean;
  } = {}
) {
  const optsDefaults = {
    allowCodeUrl: false,
    allowGistUrl: false,
    allowExampleUrl: false,
  };

  opts = { ...optsDefaults, ...opts };
  let startFiles: undefined | FileContentJson[] | FileContent[] =
    opts.startFiles;

  (async () => {
    if (startFiles === undefined) {
      // Use the URL hash to determine what files to start with.
      const hashContent = window.location.hash.replace(/^#/, "");

      // Handle URL hash with "#code="
      if (opts.allowCodeUrl && hashContent.startsWith("code=")) {
        try {
          const codeEncoded = hashContent.replace("code=", "");
          // Returns null if decoding fails
          const code = LZString.decompressFromEncodedURIComponent(codeEncoded);
          if (code) {
            // Throws if parsing fails
            startFiles = JSON.parse(code) as FileContentJson[];
          } else {
            startFiles = [];
          }
        } catch (e) {
          console.log("Could not parse JSON from URL hash.");
          startFiles = [];
        }
      }
      // Handle URL hash with "#gist="
      else if (opts.allowGistUrl && hashContent.startsWith("gist=")) {
        const gistId = hashContent.replace("gist=", "");
        try {
          const gistApiResponse = await fetchGist(gistId);
          startFiles = await gistApiResponseToFileContents(gistApiResponse);
        } catch (e) {
          console.log("Could not parse JSON from gist " + gistId);
          startFiles = [];
        }
      }
      // Look for URL hash with example name, like "#app-with-plot"
      else if (opts.allowExampleUrl) {
        const exampleCategories = await getExampleCategories();
        let pos = findExampleByTitle(hashContent, exampleCategories);
        if (pos) {
          opts.selectedExample = hashContent;
        } else {
          // If we didn't find an example name from the URL hash, we'll just use
          // the first available example.
          pos = { categoryIndex: 0, index: 0 };
          opts.selectedExample = sanitizeTitleForUrl(
            exampleCategories[pos.categoryIndex].apps[pos.index].title
          );
        }
        startFiles = exampleCategories[pos.categoryIndex].apps[pos.index].files;
      }
      // If we get here, we're either not looking for a URL hash that points to
      // code, or we didn't find such a hash.
      else {
        startFiles = [];
      }
    }

    // At this point we know that startFiles is a FileContentJson[] or
    // FileContent[]. Ensure that they're all FileContent.
    startFiles = startFiles.map(FCorFCJSONtoFC);

    const { ...appOpts } = opts;
    delete appOpts.allowCodeUrl;
    delete appOpts.allowExampleUrl;
    const unusedArgs = Object.keys(appOpts).filter(
      (key) => !propertyOfAppOptions(key)
    );
    if (unusedArgs.length > 0) {
      console.warn(
        "The following arguments were detected but not used in running app",
        unusedArgs
      );
    }

    const root = createRoot(domTarget);
    root.render(
      <React.StrictMode>
        <App appMode={mode} startFiles={startFiles} appOptions={appOpts} />
      </React.StrictMode>
    );
  })();
}

// Return true if a string is a valid key for AppOptions objects, false
// otherwise.
const propertyOfAppOptions = function <AppOptions>(name: keyof AppOptions) {
  return name;
};

// =============================================================================
// Code templates
// =============================================================================

const shinyAppTemplate = `from shiny import *

app_ui = ui.page_fluid(
  ui.input_slider("n", "N", 0, 100, 20),
  ui.output_text_verbatim("txt"),
)

def server(input, output, session):
  @output
  @render.text
  def txt():
      return f"n*2 is {input.n() * 2}"

app = App(app_ui, server)
`;

const pythonScriptTemplate = `# To run this entire script, click on the reload icon in the upper right, or
# press Ctrl- or Cmd-Shift-Enter.
# To run a single line or a selected block of code, press Ctrl- or Cmd-Enter.

def add(a, b):
  return a + b

add(1, 2)
`;
