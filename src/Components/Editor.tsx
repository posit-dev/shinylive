// Needed because TypeScript's support for window.showOpenFilePicker and
// .showDirectoryPicker is currently broken. There is a fix, but it's not yet
// released; when it's released, we can remove this.
// https://github.com/microsoft/vscode/issues/141908
/// <reference types="wicg-file-system-access" />
import type { Extension } from "@codemirror/state";
import { EditorState, Prec } from "@codemirror/state";
import type { KeyBinding, ViewUpdate } from "@codemirror/view";
import { EditorView, keymap } from "@codemirror/view";
import "balloon-css";
import type { Zippable } from "fflate";
import { zipSync } from "fflate";
import * as React from "react";
import toast, { Toaster } from "react-hot-toast";
import type * as LSP from "vscode-languageserver-protocol";
import * as fileio from "../fileio";
import { createUri } from "../language-server/client";
import type { LSPClient } from "../language-server/lsp-client";
import { ensureNullClient } from "../language-server/null-client";
import { ensurePyrightClient } from "../language-server/pyright-client";
import { inferFiletype, modKeySymbol, stringToUint8Array } from "../utils";
import type { AppEngine, UtilityMethods } from "./App";
import "./Editor.css";
import type { HeaderBarCallbacks } from "./HeaderBar";
import { Icon } from "./Icons";
import { ShareModal } from "./ShareModal";
import type { TerminalMethods } from "./Terminal";
import type { ViewerMethods } from "./Viewer";
import { FileTabs } from "./codeMirror/FileTabs";
import {
  getBinaryFileExtensions,
  getExtensions,
  getLanguageExtension,
} from "./codeMirror/extensions";
import { diagnosticToTransaction } from "./codeMirror/language-server/diagnostics";
import { languageServerExtensions } from "./codeMirror/language-server/lsp-extension";
import { useTabbedCodeMirror } from "./codeMirror/useTabbedCodeMirror";
import * as cmUtils from "./codeMirror/utils";
import type { FileContent } from "./filecontent";
import {
  editorUrlPrefix,
  fileContentsToUrlString,
  fileContentsToUrlStringInWebWorker,
} from "./share";

// If the file contents are larger than this value, then don't automatically
// update the URL hash when re-running the app.
const UPDATE_URL_SIZE_THRESHOLD = 250000;

export type EditorFile =
  | {
      name: string;
      type: "text";
      // This `ref` field is used to store the editor state, along with other
      // relevant bits like the scroll position. These pieces of information are
      // used to restore the editor state when switching between tabs.
      ref: {
        editorState: EditorState;
        scrollTop?: number;
        scrollLeft?: number;
      };
    }
  | {
      name: string;
      type: "binary";
      // Binary files need to keep the actual content separate from what the
      // editor knows about (which is just a short string describing the file).
      content: Uint8Array;
      ref: {
        editorState: EditorState;
        scrollTop?: number;
        scrollLeft?: number;
      };
    };

export default function Editor({
  currentFilesFromApp,
  setCurrentFiles,
  setFilesHaveChanged,
  setHeaderBarCallbacks,
  terminalMethods,
  viewerMethods = null,
  utilityMethods = null,
  showFileTabs = true,
  runOnLoad = true,
  lineNumbers = true,
  showHeaderBar = true,
  floatingButtons = false,
  updateUrlHashOnRerun = false,
  appEngine,
}: {
  currentFilesFromApp: FileContent[];
  setCurrentFiles: React.Dispatch<React.SetStateAction<FileContent[]>>;
  setFilesHaveChanged: React.Dispatch<React.SetStateAction<boolean>>;
  setHeaderBarCallbacks: React.Dispatch<
    React.SetStateAction<HeaderBarCallbacks>
  >;
  terminalMethods: TerminalMethods;
  viewerMethods?: ViewerMethods | null;
  utilityMethods?: UtilityMethods | null;
  showFileTabs?: boolean;
  runOnLoad?: boolean;
  lineNumbers?: boolean;
  showHeaderBar?: boolean;
  floatingButtons?: boolean;
  updateUrlHashOnRerun?: boolean;
  appEngine: AppEngine;
}) {
  // In the future, instead of directly instantiating the PyrightClient, it
  // would make sense to abstract it out to a class which in turn can run
  // multiple language server clients behind the scenes. In this file,
  // lsp-extensions.ts, and useTabbedCodeMirror.tsx, there are explicit checks
  // that files are python files in order to enable LS features, and they should
  // not be necessary at this level.
  const lspClient: LSPClient =
    appEngine === "python" ? ensurePyrightClient() : ensureNullClient();

  // A unique ID for this instance of the Editor. At some point it might make
  // sense to hoist this up into the App component, if we need unique IDs for
  // each instance of the App.
  const editorInstanceId = useInstanceCounter();
  // Path prefix (like "editor2/") for files that are sent to the Language
  // Server, to keep the files distinct from files in other Editor instances.
  // This prefix is _not_ the same as the one used when we run a Shiny app in
  // the Viewer component.
  const lspPathPrefix = `editor${editorInstanceId}/`;

  // This tracks whether the files have changed since the the last time the user
  // has run the app/code. This is used to determine whether to update the URL.
  // It is different from `setFilesHaveChanged` which is passed in, because that
  // tracks whether the files have changed since they were passed into the
  // Editor component.
  //
  // If the Editor starts with a file, then you change it and re-run, then both
  // the external `filesHaveChanged` and `filesHaveChangedSinceLastRun` will be
  // true. But if you re-run it again without making changes, then
  // `filesHaveChanged` will still be true, and `filesHaveChangedSinceLastRun`
  // will be false.
  const [filesHaveChangedSinceLastRun, setFilesHaveChangedSinceLastRun] =
    React.useState<boolean>(false);

  // This is a shortcut to indicate that the files have changed. See the comment
  // for `setFilesHaveChangedSinceLastRun` to understand why this is needed.
  const setFilesHaveChangedCombined = React.useCallback(
    (value: boolean) => {
      setFilesHaveChanged(value);
      setFilesHaveChangedSinceLastRun(value);
    },
    [setFilesHaveChanged, setFilesHaveChangedSinceLastRun],
  );

  const [hasShownUrlTooLargeMessage, setHasShownUrlTooLargeMessage] =
    React.useState<boolean>(false);

  // Given a FileContent object, figure out which editor extensions to use.
  // Use a memoized function to maintain referentially stablity.
  const inferEditorExtensions = React.useCallback(
    (file: FileContent | EditorFile) => {
      if (file.type === "binary") {
        return getBinaryFileExtensions();
      }

      const language = inferFiletype(file.name);
      const indentSpaces = language === "r" ? 2 : 4;

      return [
        getExtensions({ lineNumbers, indentSpaces }),
        getLanguageExtension(language),
        EditorView.updateListener.of((u: ViewUpdate) => {
          if (u.docChanged) {
            setFilesHaveChangedCombined(true);
          }
        }),
        languageServerExtensions(lspClient, lspPathPrefix + file.name),
        Prec.high(
          keymap.of(keyBindings({ runSelectedTextOrCurrentLine, runAllAuto })),
        ),
      ];
    },
    [lineNumbers, setFilesHaveChangedCombined, lspClient, lspPathPrefix],
  );

  const [cmView, setCmView] = React.useState<EditorView>();

  const tabbedFiles = useTabbedCodeMirror({
    currentFilesFromApp,
    cmView,
    inferEditorExtensions,
    setFilesHaveChanged: setFilesHaveChangedCombined,
    lspClient,
    lspPathPrefix,
  });
  const { files, activeFile, syncActiveFileState, focusOnEditor } = tabbedFiles;

  // If there's a file named app.py, assume we have a Shiny app.
  const [isShinyApp, setIsShinyApp] = React.useState(false);
  React.useEffect(() => {
    setIsShinyApp(
      files.some(
        (f) =>
          f.name === "app.py" || f.name === "app.R" || f.name === "server.R",
      ),
    );
  }, [files]);

  // ===========================================================================
  // Callbacks for running app/code
  // ===========================================================================
  const runCodeInTerminal = React.useCallback(
    (command: string) => {
      if (!terminalMethods.ready) return;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      terminalMethods.runCodeInTerminal(command);
    },
    [terminalMethods],
  );

  // Runs the Shiny application using the current set of files in the editor.
  const runAllApp = React.useCallback(() => {
    if (!viewerMethods || !viewerMethods.ready) return;

    syncActiveFileState();
    const fileContents = editorFilesToFileContents(files);

    if (updateUrlHashOnRerun && filesHaveChangedSinceLastRun) {
      const filesSize = fileContentsSize(fileContents);

      if (
        !hasShownUrlTooLargeMessage &&
        filesSize > UPDATE_URL_SIZE_THRESHOLD
      ) {
        toast(
          "Auto-updating the app link is disabled because the app is very large. " +
            "If you want the sharing URL, click the Share button.",
        );
        setHasShownUrlTooLargeMessage(true);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        updateBrowserUrlHash(fileContents);
      }
    }

    setFilesHaveChangedCombined(false);

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      await viewerMethods.stopApp();
      await viewerMethods.runApp(fileContents);
    })();
  }, [
    viewerMethods,
    syncActiveFileState,
    updateUrlHashOnRerun,
    filesHaveChangedSinceLastRun,
    setFilesHaveChangedCombined,
    hasShownUrlTooLargeMessage,
    setHasShownUrlTooLargeMessage,
    files,
  ]);

  // Run the entire current file in the terminal.
  const runAllCode = React.useCallback(() => {
    if (!cmView) return;
    syncActiveFileState();
    runCodeInTerminal(cmView.state.doc.toString());
  }, [runCodeInTerminal, syncActiveFileState, cmView]);

  // ===========================================================================
  // Running app/code when the page loads
  // ===========================================================================
  // After (1) a set of files has been received from the app, and (2) pyodide is
  // ready, run the app.
  React.useEffect(() => {
    if (!viewerMethods || !viewerMethods.ready) return;

    setFilesHaveChanged(false);

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      await viewerMethods.stopApp();
      currentFilesFromApp.map((file) => {
        if (file.type === "text" && inferFiletype(file.name) === "python") {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          lspClient.createFile(lspPathPrefix + file.name, file.content);
        }
      });

      if (!runOnLoad) return;
      // Note that we use this `isShinyCode` instead of the state var
      // `isShinyApp` because we need it to decide on the first pass whether to
      // run as an app, or as code. This has to happen on the first pass, before
      // state vars are set and available. It would be nice to consolidate the
      // two vars, but I haven't figured out how yet.
      const isShinyCode = currentFilesFromApp.some(
        (f) =>
          f.name === "app.py" || f.name === "app.R" || f.name === "server.R",
      );
      if (isShinyCode) {
        await viewerMethods.runApp(currentFilesFromApp);
      }
      // TODO: Should switch to the following, but there's some state capture
      // issue that's causing problems.
      // runAppCurrentFiles.current();
    })();
  }, [
    runOnLoad,
    currentFilesFromApp,
    viewerMethods,
    setFilesHaveChanged,
    lspClient,
    lspPathPrefix,
  ]);

  React.useEffect(() => {
    if (!runOnLoad) return;
    if (!terminalMethods.ready) return;

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      const isShinyCode = currentFilesFromApp.some(
        (f) =>
          f.name === "app.py" || f.name === "app.R" || f.name === "server.R",
      );
      if (!isShinyCode) {
        // TODO: use activeFile instead of currentFilesFromApp?
        if (currentFilesFromApp[0].type === "text") {
          runCodeInTerminal(currentFilesFromApp[0].content!);
        }
      }
    })();
  }, [runOnLoad, currentFilesFromApp, terminalMethods, runCodeInTerminal]);

  // ===========================================================================
  // CodeMirror setup
  // ===========================================================================
  const cmDivRef = React.useRef<HTMLDivElement>(null);

  // Populate the cmViewRef object.
  React.useEffect(() => {
    if (!cmDivRef.current) {
      throw new Error("Target div ref for CodeMirror is null.");
    }
    const cmViewLocal = new EditorView({
      parent: cmDivRef.current,
    });

    setCmView(cmViewLocal);

    return function cleanup() {
      cmViewLocal.destroy();
    };
  }, []);

  // This is run when switching tabs, and when receiving new files from the app.
  React.useEffect(() => {
    if (!cmView || files.length === 0) return;

    // Restore CM state object.
    cmView.setState(activeFile.ref.editorState);

    // Restore scroll position, if it's available. Otherwise default to top.
    cmView.scrollDOM.scrollTop = activeFile.ref.scrollTop ?? 0;
    cmView.scrollDOM.scrollLeft = activeFile.ref.scrollLeft ?? 0;

    if (focusOnEditor) {
      cmView.focus();
    }

    return function cleanup() {
      syncActiveFileState();
    };
  }, [files, syncActiveFileState, activeFile, focusOnEditor, cmView]);

  // Referentially stable function, called when the user presses Mod-Enter.
  const runSelectedTextOrCurrentLine = React.useRef((): void => {});
  React.useEffect(() => {
    runSelectedTextOrCurrentLine.current = (): void => {
      if (!cmView) return;
      // Get selected text, or if no selection, current line
      let code = cmUtils.getSelectedText(cmView);
      if (code == "") {
        code = cmUtils.getCurrentLineText(cmView);
        cmUtils.moveCursorToNextLine(cmView);
      }
      runCodeInTerminal(code);
    };
  }, [runCodeInTerminal, cmView]);

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
  // Language Server
  // ===========================================================================

  const diagnosticsListener = React.useCallback(
    (params: LSP.PublishDiagnosticsParams) => {
      if (!cmView) return;
      // console.log("diagnosticsListener", params);

      syncActiveFileState();

      files.map((file) => {
        if (createUri(lspPathPrefix + file.name) !== params.uri) return;

        const transaction = diagnosticToTransaction(
          file.ref.editorState,
          params.diagnostics.filter(diagnosticFilter),
        );

        // In the case where the View's state is the same as the file we're
        // iterating over, dispatch the transaction so the View gets updated.
        if (cmView.state === file.ref.editorState) {
          cmView.dispatch(transaction);
        }

        file.ref.editorState = transaction.state;
      });

      // Notably, we do not call `setFiles` because we're only modifying the
      // `file.ref` part, and  we dont' want to trigger a re-render.
    },
    [files, lspPathPrefix, syncActiveFileState, cmView],
  );

  React.useEffect(() => {
    lspClient.on("diagnostics", diagnosticsListener);

    return function cleanup() {
      lspClient.off("diagnostics", diagnosticsListener);
    };
  }, [lspClient, diagnosticsListener]);

  // ===========================================================================
  // Callbacks for the buttons in the HeaderBar component
  // ===========================================================================
  const [localDirHandle, setLocalDirHandle] =
    React.useState<FileSystemDirectoryHandle | null>(null);

  const loadLocalFiles = React.useCallback(async () => {
    fileio.assertHasFileAccessApiSupport();
    const confirmMessage =
      "Load files from disk? This will close all open files and load all the files from a directory on disk.";
    if (!window.confirm(confirmMessage)) return;

    const dirHandle = await window.showDirectoryPicker();
    const localFiles = await fileio.loadDirectoryRecursive(dirHandle);

    setLocalDirHandle(dirHandle);
    setCurrentFiles(localFiles);
  }, [setCurrentFiles]);

  const saveLocalFiles = React.useCallback(async () => {
    fileio.assertHasFileAccessApiSupport();

    const confirmMessage =
      "Save project files to disk? This will save all files from the editor to a directory on disk.";
    if (!window.confirm(confirmMessage)) return;

    let dirHandle: FileSystemDirectoryHandle;
    if (localDirHandle) {
      dirHandle = localDirHandle;
    } else {
      dirHandle = await window.showDirectoryPicker();
      setLocalDirHandle(dirHandle);
    }

    syncActiveFileState();
    const fileContents = editorFilesToFileContents(files);

    await fileio.saveFileContentsToDirectory(fileContents, dirHandle);
  }, [files, syncActiveFileState, localDirHandle]);

  const downloadFiles = React.useCallback(async () => {
    if (!window.confirm("Downlad all project files?")) return;

    syncActiveFileState();
    const fileContents = editorFilesToFileContents(files);

    if (fileContents.length == 1) {
      const file = fileContents[0];
      await fileio.downloadFile(
        file.name,
        file.content,
        file.type === "text" ? "text/plain" : "application/octet-stream",
      );
    } else {
      const zippableContents = editorFilesToFflateZippable(files);
      const zipBuffer = zipSync(zippableContents);
      await fileio.downloadFile("app.zip", zipBuffer, "application/zip");
    }
  }, [files, syncActiveFileState]);

  const openEditorWindow = React.useCallback(async () => {
    syncActiveFileState();
    const fileContents = editorFilesToFileContents(files);
    window.open(
      editorUrlPrefix(appEngine) +
        "#code=" +
        fileContentsToUrlString(fileContents),
      "_blank",
    );
  }, [files, syncActiveFileState]);

  const [shareModalVisible, setShareModalVisible] = React.useState(false);

  const showShareModal = React.useCallback(() => {
    // If the user clicks the share button, we need to sync the files before
    // showing the dialog.
    syncActiveFileState();
    setShareModalVisible(true);
  }, [syncActiveFileState]);

  let shareModal: JSX.Element | null = null;
  if (shareModalVisible) {
    shareModal = (
      <ShareModal
        fileContents={editorFilesToFileContents(files)}
        setShareModalVisible={setShareModalVisible}
        appEngine={appEngine}
      ></ShareModal>
    );
  }

  React.useEffect(() => {
    setHeaderBarCallbacks({
      loadLocalFiles: loadLocalFiles,
      saveLocalFiles: saveLocalFiles,
      downloadFiles: downloadFiles,
      showShareModal: showShareModal,
      openEditorWindow: openEditorWindow,
    });
  }, [
    downloadFiles,
    loadLocalFiles,
    openEditorWindow,
    saveLocalFiles,
    setHeaderBarCallbacks,
    showShareModal,
  ]);

  // ===========================================================================
  // Buttons
  // ===========================================================================
  const formatCodeButton =
    appEngine === "python" ? (
      <button
        className="code-run-button"
        aria-label="Reformat code"
        data-balloon-pos="down"
        onClick={() => formatCode()}
      >
        <Icon icon="code"></Icon>
      </button>
    ) : null;

  const formatCode = React.useCallback(async () => {
    if (!cmView) return;
    if (!utilityMethods) return;
    syncActiveFileState();

    if (activeFile.type !== "text") return;
    const content = editorFileToFileContent(activeFile).content as string;

    // TODO: pass file type to formatCode.
    const formatted = await utilityMethods.formatCode(content);

    // Make sure the cursor stays within the document.
    const cursorPos = Math.min(
      formatted.length,
      cmView.state.selection.main.anchor,
    );
    // Replace the old code with the new formatted code.
    const transaction = cmView.state.update({
      changes: {
        from: 0,
        to: cmView.state.doc.length,
        insert: formatted,
      },
      selection: { anchor: cursorPos },
    });

    cmView.dispatch(transaction);
  }, [utilityMethods, syncActiveFileState, activeFile, cmView]);

  // Run button either gets placed in the header or floating over the editor but
  // it's the same button either way
  const runButton = (
    <button
      className="code-run-button"
      aria-label={`Re-run ${
        isShinyApp ? "app" : "code"
      } (${modKeySymbol()})-Shift-Enter`}
      data-balloon-pos="down"
      onClick={() => runAllAuto.current()}
    >
      <Icon icon="play"></Icon>
    </button>
  );

  // ===========================================================================
  // React component
  // ===========================================================================

  return (
    <div className="shinylive-editor">
      {shareModal}
      {showHeaderBar ? (
        <div className="editor-header">
          {showFileTabs ? <FileTabs {...tabbedFiles} /> : null}
          <div className="editor-actions">
            {formatCodeButton}
            {runButton}
          </div>
        </div>
      ) : null}
      <div className="editor-container" ref={cmDivRef}></div>
      <Toaster
        toastOptions={{
          duration: 5000,
          position: "top-center",
          style: { fontFamily: "var(--font-face)" },
        }}
      />
      {floatingButtons ? (
        <div className="floating-buttons">{runButton}</div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Conversion between FileContent and EditorFile
// =============================================================================
export function fileContentsToEditorFiles(
  files: FileContent[],
  inferEditorExtensions: (f: FileContent) => Extension,
): EditorFile[] {
  return files.map((f) => fileContentToEditorFile(f, inferEditorExtensions));
}

export function fileContentToEditorFile(
  file: FileContent,
  inferEditorExtensions: (f: FileContent) => Extension,
): EditorFile {
  if (file.type === "binary") {
    const content = file.content;
    return {
      name: file.name,
      type: file.type,
      content: content,
      ref: {
        editorState: EditorState.create({
          extensions: inferEditorExtensions(file),
          doc: `<< ${content.length} bytes of binary data >>`,
        }),
      },
    };
  } else {
    return {
      name: file.name,
      type: file.type,
      ref: {
        editorState: EditorState.create({
          extensions: inferEditorExtensions(file),
          doc: file.content,
        }),
      },
    };
  }
}

export function editorFilesToFileContents(files: EditorFile[]): FileContent[] {
  return files.map(editorFileToFileContent);
}

export function editorFileToFileContent(file: EditorFile): FileContent {
  if (file.type === "binary") {
    return {
      name: file.name,
      type: file.type,
      content: file.content,
    };
  } else {
    return {
      name: file.name,
      type: file.type,
      content: file.ref.editorState.doc.toString(),
    };
  }
}

function editorFilesToFflateZippable(files: EditorFile[]): Zippable {
  const res: Zippable = {};

  for (const file of files) {
    if (file.type === "binary") {
      res[file.name] = file.content;
    } else {
      res[file.name] = stringToUint8Array(file.ref.editorState.doc.toString());
    }
  }

  return res;
}

// Get the size in bytes of the contents of a FileContent array. Note that this
// isn't exactly the size in bytes -- for text files, it counts the number of
// characters, but some could be multi-byte (and the size could vary depending
// on the encoding). But it's close enough for our purposes.
function fileContentsSize(files: FileContent[]): number {
  let size = 0;
  for (const file of files) {
    if (file.type === "binary") {
      size += file.content.length;
    } else {
      size += file.content.length;
    }
  }
  return size;
}

// =============================================================================
// Misc utility functions
// =============================================================================
/**
 * Filter out specific diagnostic messages that we don't want to show.
 */
function diagnosticFilter(diagnostic: LSP.Diagnostic): boolean {
  // Don't show diagnostics about unused vars.
  if (
    diagnostic.severity === 4 &&
    /is not accessed$/.test(diagnostic.message)
  ) {
    return false;
  }

  return true;
}

/**
 * Get a unique sequential ID for each React component instance that calls this
 * function.
 */
let instanceCount = 0;
function useInstanceCounter() {
  const [id] = React.useState(instanceCount);

  React.useEffect(() => {
    instanceCount += 1;
    return () => {
      instanceCount -= 1;
    };
  }, []);

  return id;
}

/**
 * Create CodeMirror key bindings to run code from the editor.
 */
function keyBindings({
  runSelectedTextOrCurrentLine,
  runAllAuto,
}: {
  runSelectedTextOrCurrentLine: React.RefObject<() => void>;
  runAllAuto: React.RefObject<() => void>;
}): KeyBinding[] {
  return [
    {
      key: "Mod-Enter",
      run: (view: EditorView) => {
        if (!runSelectedTextOrCurrentLine.current) return false;
        runSelectedTextOrCurrentLine.current();
        return true;
      },
    },
    {
      key: "Mod-Shift-Enter",
      run: (view: EditorView) => {
        if (!runAllAuto.current) return false;
        runAllAuto.current();
        return true;
      },
    },
  ];
}
/**
 * Update the browser URL hash with the current contents of the Editor.
 */
async function updateBrowserUrlHash(
  fileContents: FileContent[],
): Promise<void> {
  const encodedFileContents =
    await fileContentsToUrlStringInWebWorker(fileContents);
  const hash = "#code=" + encodedFileContents;
  history.replaceState(null, "", hash);
}
