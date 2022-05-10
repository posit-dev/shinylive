import { EditorState, Prec } from "@codemirror/state";
import { EditorView, KeyBinding, keymap, ViewUpdate } from "@codemirror/view";
import * as React from "react";
import { modKeySymbol } from "../utils";
import {
  getExtensionForFiletype,
  getExtensions,
} from "./codeMirror/extensions";
import { FileTabs } from "./codeMirror/FileTabs";
import useTabbedCodeMirror from "./codeMirror/useTabbedCodeMirror";
import * as cmUtils from "./codeMirror/utils";
import "./Editor.css";
import ShareModal from "./ShareModal";
import { TerminalMethods } from "./Terminal";
import { FileContent } from "./types";
import { ViewerMethods } from "./Viewer";

export type EditorFile = {
  name: string;
  ref: {
    editorState: EditorState;
  };
};

export default function Editor({
  currentFilesFromApp,
  setFilesHaveChanged,
  terminalMethods,
  viewerMethods = null,
  showFileTabs = true,
  runOnLoad = true,
  lineNumbers = true,
  showHeaderBar = true,
  showShareButton = true,
  floatingButtons = false,
}: {
  currentFilesFromApp: FileContent[];
  setFilesHaveChanged: React.Dispatch<React.SetStateAction<boolean>>;
  terminalMethods: TerminalMethods;
  viewerMethods?: ViewerMethods | null;
  showFileTabs?: boolean;
  runOnLoad?: boolean;
  lineNumbers?: boolean;
  showHeaderBar?: boolean;
  showShareButton?: boolean;
  floatingButtons?: boolean;
}) {
  const [keyBindings] = React.useState<KeyBinding[]>([
    {
      key: "Mod-Enter",
      run: (view: EditorView) => {
        runSelectedTextOrCurrentLine.current();
        return true;
      },
    },
    {
      key: "Mod-Shift-Enter",
      run: (view: EditorView) => {
        runAllAuto.current();
        return true;
      },
    },
  ]);

  // Declare extensions within a memoized function to maintain referentially stablity
  const editorExtensions = React.useMemo(
    () => [
      getExtensions({ lineNumbers }),
      // This may need to not be there for the file update one
      getExtensionForFiletype("python"),
      EditorView.updateListener.of((u: ViewUpdate) => {
        if (u.docChanged) {
          setFilesHaveChanged(true);
        }
      }),
      Prec.high(keymap.of(keyBindings)),
    ],
    [keyBindings, lineNumbers, setFilesHaveChanged]
  );

  const tabbedFiles = useTabbedCodeMirror({
    currentFilesFromApp,
    editorExtensions,
  });
  const { files, activeFile } = tabbedFiles;

  // If there's a file named app.py, assume we have a Shiny app.
  const [isShinyApp, setIsShinyApp] = React.useState(false);
  React.useEffect(() => {
    setIsShinyApp(files.some((file) => file.name === "app.py"));
  }, [files]);

  // Store the currently active file's CodeMirror editor state in the
  // corresponding entry in `files`, but in the `ref` property, which is meant
  // to be mutable.
  const syncFileState = React.useCallback(() => {
    if (!cmViewRef.current) return;
    activeFile.ref.editorState = cmViewRef.current.state;
  }, [activeFile]);

  // ===========================================================================
  // Callbacks for running app/code
  // ===========================================================================
  const runCodeInTerminal = React.useCallback(
    (command: string) => {
      if (!terminalMethods.ready) return;
      terminalMethods.runCodeInTerminal(command);
    },
    [terminalMethods]
  );

  // Runs the Shiny application using the current set of files in the editor.
  const runAllApp = React.useCallback(() => {
    if (!viewerMethods || !viewerMethods.ready) return;

    syncFileState();
    (async () => {
      await viewerMethods.stopApp();
      await viewerMethods.runApp(editorFilesToFileContents(files));
    })();
  }, [viewerMethods, syncFileState, files]);

  // Run the entire current file in the terminal.
  const runAllCode = React.useCallback(() => {
    if (!cmViewRef.current) return;
    syncFileState();
    runCodeInTerminal(cmViewRef.current.state.doc.toString());
  }, [runCodeInTerminal, syncFileState]);

  // ===========================================================================
  // Running app/code when the page loads
  // ===========================================================================
  // After (1) a set of files has been received from the app, and (2) pyodide is
  // ready, run the app.
  React.useEffect(() => {
    if (!runOnLoad) return;
    if (!viewerMethods || !viewerMethods.ready) return;

    setFilesHaveChanged(false);

    (async () => {
      await viewerMethods.stopApp();
      // Note that we use this `isShinyCode` instead of the state var
      // `isShinyApp` because we need it to decide on the first pass whether to
      // run as an app, or as code. This has to happen on the first pass, before
      // state vars are set and available. It would be nice to consolidate the
      // two vars, but I haven't figured out how yet.
      const isShinyCode = currentFilesFromApp.some((f) => f.name === "app.py");
      if (isShinyCode) {
        await viewerMethods.runApp(currentFilesFromApp);
      }
      // TODO: Should switch to the following, but there's some state capture
      // issue that's causing problems.
      // runAppCurrentFiles.current();
    })();
  }, [runOnLoad, currentFilesFromApp, viewerMethods, setFilesHaveChanged]);

  React.useEffect(() => {
    if (!runOnLoad) return;
    if (!terminalMethods.ready) return;

    (async () => {
      const isShinyCode = currentFilesFromApp.some((f) => f.name === "app.py");
      if (!isShinyCode) {
        // TODO: use activeFile instead of currentFilesFromApp?
        runCodeInTerminal(currentFilesFromApp[0].content!);
      }
    })();
  }, [runOnLoad, currentFilesFromApp, terminalMethods, runCodeInTerminal]);

  // ===========================================================================
  // CodeMirror setup
  // ===========================================================================
  const cmDivRef = React.useRef<HTMLDivElement>(null);
  const cmViewRef = React.useRef<EditorView>();

  // Populate the cmViewRef object.
  React.useEffect(() => {
    if (!cmDivRef.current) {
      throw new Error("Target div ref for CodeMirror is null.");
    }
    cmViewRef.current = new EditorView({
      parent: cmDivRef.current,
    });
  }, []);

  // This is run when switching tabs, and when receiving new files from the app.
  React.useEffect(() => {
    if (!cmViewRef.current || files.length === 0) return;

    cmViewRef.current.setState(activeFile.ref.editorState);
    cmViewRef.current.focus();

    return function cleanup() {
      syncFileState();
    };
  }, [files, syncFileState, activeFile]);

  // Referentially stable function, called when the user presses Mod-Enter.
  const runSelectedTextOrCurrentLine = React.useRef((): void => {});
  React.useEffect(() => {
    runSelectedTextOrCurrentLine.current = (): void => {
      if (!cmViewRef.current) return;
      // Get selected text, or if no selection, current line
      let code = cmUtils.getSelectedText(cmViewRef.current);
      if (code == "") {
        code = cmUtils.getCurrentLineText(cmViewRef.current);
        cmUtils.moveCursorToNextLine(cmViewRef.current);
      }
      runCodeInTerminal(code);
    };
  }, [runCodeInTerminal]);

  // Referentially stable function, called when the user presses
  // Mod-Shift-Enter. If the code is a Shiny app, it runs all the files as an
  // app; if the code is not a Shiny app, it runs the entire current file in the
  // terminal.
  const runAllAuto = React.useRef((): void => {});
  React.useEffect(() => {
    runAllAuto.current = () => {
      if (isShinyApp) {
        runAllApp();
      } else {
        runAllCode();
      }
    };
  }, [isShinyApp, runAllCode, runAllApp]);

  // ===========================================================================
  // React component
  // ===========================================================================

  const [showShareModal, setShowShareModal] = React.useState(false);

  const shareButton = (
    <button
      className="code-run-button"
      title={`Share ${isShinyApp ? "app" : "code"}`}
      onClick={() => setShowShareModal(true)}
    >
      Share
    </button>
  );

  let shareModal: JSX.Element | null = null;
  if (showShareModal) {
    // If the user clicks the share button, we need to sync the files before
    // showing the
    syncFileState();
    shareModal = (
      <ShareModal
        fileContents={editorFilesToFileContents(files)}
        setShowShareModal={setShowShareModal}
      ></ShareModal>
    );
  }

  // Run button either gets placed in the header or floating over the editor but
  // it's the same button either way
  const runButton = (
    <button
      className="code-run-button"
      title={`Re-run ${
        isShinyApp ? "app" : "code"
      } (${modKeySymbol()})-Shift-Enter`}
      onClick={() => runAllAuto.current()}
    >
      &#8629;
    </button>
  );

  return (
    <div className="Editor">
      {shareModal}
      {showHeaderBar ? (
        <div className="Editor--header">
          {showFileTabs ? <FileTabs {...tabbedFiles} /> : null}
          <div className="Editor--header--actions">
            {showShareButton ? shareButton : null}
            {runButton}
          </div>
        </div>
      ) : null}
      <div className="Editor--container" ref={cmDivRef}></div>
      {floatingButtons ? (
        <div className="floating-buttons">{runButton}</div>
      ) : null}
    </div>
  );
}

/**
 * Convert files to proper format for code mirrors editor state
 */
function editorFilesToFileContents(files: EditorFile[]): FileContent[] {
  return files.map((file) => {
    return {
      name: file.name,
      content: file.ref.editorState.doc.toString(),
    };
  });
}
