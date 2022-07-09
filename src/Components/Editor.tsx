// Needed because TypeScript's support for window.showOpenFilePicker and
// .showDirectoryPicker is currently broken. There is a fix, but it's not yet
// released; when it's released, we can remove this.
// https://github.com/microsoft/vscode/issues/141908
/// <reference types="wicg-file-system-access" />
import * as fileio from "../fileio";
import { createUri } from "../language-server/client";
import { LSPClient } from "../language-server/lsp-client";
import { ensurePyrightClient } from "../language-server/pyright-client";
import * as utils from "../utils";
import { inferFiletype, modKeySymbol, stringToUint8Array } from "../utils";
import type { UtilityMethods } from "./App";
import "./Editor.css";
import { Icon } from "./Icons";
import { ShareModal } from "./ShareModal";
import { TerminalMethods } from "./Terminal";
import { ViewerMethods } from "./Viewer";
import { FileTabs } from "./codeMirror/FileTabs";
import {
  getBinaryFileExtensions,
  getLanguageExtension,
  getExtensions,
} from "./codeMirror/extensions";
import { diagnosticToTransaction } from "./codeMirror/language-server/diagnostics";
import { languageServerExtensions } from "./codeMirror/language-server/lsp-extension";
import { useTabbedCodeMirror } from "./codeMirror/useTabbedCodeMirror";
import * as cmUtils from "./codeMirror/utils";
import { FileContent } from "./filecontent";
import { EditorState, Extension, Prec } from "@codemirror/state";
import { EditorView, KeyBinding, keymap, ViewUpdate } from "@codemirror/view";
import "balloon-css";
import { zipSync, Zippable } from "fflate";
import * as React from "react";
import * as LSP from "vscode-languageserver-protocol";

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
  terminalMethods,
  viewerMethods = null,
  utilityMethods = null,
  showFileTabs = true,
  runOnLoad = true,
  lineNumbers = true,
  showHeaderBar = true,
  showLoadSaveButtons = true,
  showOpenWindowButton = true,
  showShareButton = true,
  floatingButtons = false,
}: {
  currentFilesFromApp: FileContent[];
  setCurrentFiles: React.Dispatch<React.SetStateAction<FileContent[]>>;
  setFilesHaveChanged: React.Dispatch<React.SetStateAction<boolean>>;
  terminalMethods: TerminalMethods;
  viewerMethods?: ViewerMethods | null;
  utilityMethods?: UtilityMethods | null;
  showFileTabs?: boolean;
  runOnLoad?: boolean;
  lineNumbers?: boolean;
  showHeaderBar?: boolean;
  showLoadSaveButtons?: boolean;
  showOpenWindowButton?: boolean;
  showShareButton?: boolean;
  floatingButtons?: boolean;
}) {
  // In the future, instead of directly instantiating the PyrightClient, it
  // would make sense to abstract it out to a class which in turn can run
  // multiple language server clients behind the scenes. In this file,
  // lsp-extensions.ts, and useTabbedCodeMirror.tsx, there are explicit checks
  // that files are python files in order to enable LS features, and they should
  // not be necessary at this level.
  const lspClient: LSPClient = ensurePyrightClient();

  // A unique ID for this instance of the Editor. At some point it might make
  // sense to hoist this up into the App component, if we need unique IDs for
  // each instance of the App.
  const editorInstanceId = useInstanceCounter();
  // Path prefix (like "editor2/") for files that are sent to the Language
  // Server, to keep the files distinct from files in other Editor instances.
  // This prefix is _not_ the same as the one used when we run a Shiny app in
  // the Viewer component.
  const lspPathPrefix = `editor${editorInstanceId}/`;

  // Given a FileContent object, figure out which editor extensions to use.
  // Use a memoized function to maintain referentially stablity.
  const inferEditorExtensions = React.useCallback(
    (file: FileContent) => {
      if (file.type === "binary") {
        return getBinaryFileExtensions();
      }

      const language = inferFiletype(file.name);

      return [
        getExtensions({ lineNumbers }),
        getLanguageExtension(language),
        EditorView.updateListener.of((u: ViewUpdate) => {
          if (u.docChanged) {
            setFilesHaveChanged(true);
          }
        }),
        languageServerExtensions(lspClient, lspPathPrefix + file.name),
        Prec.high(
          keymap.of(keyBindings({ runSelectedTextOrCurrentLine, runAllAuto }))
        ),
      ];
    },
    [lineNumbers, setFilesHaveChanged, lspClient, lspPathPrefix]
  );

  const tabbedFiles = useTabbedCodeMirror({
    currentFilesFromApp,
    inferEditorExtensions,
    lspClient,
    lspPathPrefix,
  });
  const { files, setFiles, activeFile } = tabbedFiles;

  // If there's a file named app.py, assume we have a Shiny app.
  const [isShinyApp, setIsShinyApp] = React.useState(false);
  React.useEffect(() => {
    setIsShinyApp(files.some((file) => file.name === "app.py"));
  }, [files]);

  /**
   * Store the currently active file's CodeMirror editor state in the
   * corresponding entry in `files`, but in the `ref` property, which is meant
   * to be mutable. This should be called just before doing operations on
   * `files` or `activeFile`.
   */
  const syncActiveFileState = React.useCallback(() => {
    if (!cmViewRef.current) return;
    activeFile.ref.editorState = cmViewRef.current.state;
    activeFile.ref.scrollTop = cmViewRef.current.scrollDOM.scrollTop;
    activeFile.ref.scrollLeft = cmViewRef.current.scrollDOM.scrollLeft;
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

    syncActiveFileState();
    (async () => {
      await viewerMethods.stopApp();
      await viewerMethods.runApp(editorFilesToFileContents(files));
    })();
  }, [viewerMethods, syncActiveFileState, files]);

  // Run the entire current file in the terminal.
  const runAllCode = React.useCallback(() => {
    if (!cmViewRef.current) return;
    syncActiveFileState();
    runCodeInTerminal(cmViewRef.current.state.doc.toString());
  }, [runCodeInTerminal, syncActiveFileState]);

  // ===========================================================================
  // Running app/code when the page loads
  // ===========================================================================
  // After (1) a set of files has been received from the app, and (2) pyodide is
  // ready, run the app.
  React.useEffect(() => {
    if (!viewerMethods || !viewerMethods.ready) return;

    setFilesHaveChanged(false);

    (async () => {
      await viewerMethods.stopApp();
      currentFilesFromApp.map((file) => {
        if (file.type === "text" && inferFiletype(file.name) === "python") {
          lspClient.createFile(lspPathPrefix + file.name, file.content);
        }
      });

      if (!runOnLoad) return;
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

    (async () => {
      const isShinyCode = currentFilesFromApp.some((f) => f.name === "app.py");
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
  const cmViewRef = React.useRef<EditorView>();

  // Populate the cmViewRef object.
  React.useEffect(() => {
    if (!cmDivRef.current) {
      throw new Error("Target div ref for CodeMirror is null.");
    }
    cmViewRef.current = new EditorView({
      parent: cmDivRef.current,
    });

    return function cleanup() {
      if (!cmViewRef.current) return;
      cmViewRef.current.destroy();
    };
  }, []);

  // This is run when switching tabs, and when receiving new files from the app.
  React.useEffect(() => {
    if (!cmViewRef.current || files.length === 0) return;

    // Restore CM state object.
    cmViewRef.current.setState(activeFile.ref.editorState);

    // Restore scroll position, if it's available. Otherwise default to top.
    cmViewRef.current.scrollDOM.scrollTop = activeFile.ref.scrollTop ?? 0;
    cmViewRef.current.scrollDOM.scrollLeft = activeFile.ref.scrollLeft ?? 0;

    return function cleanup() {
      syncActiveFileState();
    };
  }, [files, syncActiveFileState, activeFile]);

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
  // Language Server
  // ===========================================================================

  const diagnosticsListener = React.useCallback(
    (params: LSP.PublishDiagnosticsParams) => {
      if (!cmViewRef.current) return;
      // console.log("diagnosticsListener", params);

      syncActiveFileState();

      files.map((file) => {
        if (createUri(lspPathPrefix + file.name) !== params.uri) return;

        const transaction = diagnosticToTransaction(
          file.ref.editorState,
          params.diagnostics.filter(diagnosticFilter)
        );

        // In the case where the View's state is the same as the file we're
        // iterating over, dispatch the transaction so the View gets updated.
        if (cmViewRef.current?.state === file.ref.editorState) {
          cmViewRef.current.dispatch(transaction);
        }

        file.ref.editorState = transaction.state;
      });

      // Notably, we do not call `setFiles` because we're only modifying the
      // `file.ref` part, and  we dont' want to trigger a re-render.
    },
    [files, lspPathPrefix, setFiles, syncActiveFileState]
  );

  React.useEffect(() => {
    lspClient.on("diagnostics", diagnosticsListener);

    return function cleanup() {
      lspClient.off("diagnostics", diagnosticsListener);
    };
  }, [lspClient, diagnosticsListener]);

  // ===========================================================================
  // React component
  // ===========================================================================

  const [showShareModal, setShowShareModal] = React.useState(false);

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

  const loadButton = (
    <button
      className="code-run-button"
      aria-label="Load project from a directory on disk"
      data-balloon-pos="down"
      onClick={() => loadLocalFiles()}
    >
      <Icon icon="upload"></Icon>
    </button>
  );

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

  const saveButton = (
    <button
      className="code-run-button"
      aria-label="Save all project files to disk"
      data-balloon-pos="down"
      onClick={() => saveLocalFiles()}
    >
      <Icon icon="download"></Icon>
    </button>
  );

  const downloadFiles = React.useCallback(async () => {
    if (!window.confirm("Downlad all project files?")) return;

    syncActiveFileState();
    const fileContents = editorFilesToFileContents(files);

    if (fileContents.length == 1) {
      const file = fileContents[0];
      fileio.downloadFile(
        file.name,
        file.content,
        file.type === "text" ? "text/plain" : "application/octet-stream"
      );
    } else {
      const zippableContents = editorFilesToFflateZippable(files);
      const zipBuffer = zipSync(zippableContents);
      await fileio.downloadFile("app.zip", zipBuffer, "application/zip");
    }
  }, [files, syncActiveFileState]);

  const formatCodeButton = (
    <button
      className="code-run-button"
      aria-label="Reformat code"
      data-balloon-pos="down"
      onClick={() => formatCode()}
    >
      <Icon icon="code"></Icon>
    </button>
  );

  const formatCode = React.useCallback(async () => {
    if (!cmViewRef.current) return;
    if (!utilityMethods) return;
    syncActiveFileState();

    if (activeFile.type !== "text") return;
    const content = editorFileToFileContent(activeFile).content as string;

    // TODO: pass file type to formatCode.
    const formatted = await utilityMethods.formatCode(content);

    // Make sure the cursor stays within the document.
    const cursorPos = Math.min(
      formatted.length,
      cmViewRef.current.state.selection.main.anchor
    );
    // Replace the old code with the new formatted code.
    const transaction = cmViewRef.current.state.update({
      changes: {
        from: 0,
        to: cmViewRef.current.state.doc.length,
        insert: formatted,
      },
      selection: { anchor: cursorPos },
    });

    cmViewRef.current.dispatch(transaction);
  }, [utilityMethods, syncActiveFileState, activeFile]);

  const downloadButton = (
    <button
      className="code-run-button"
      aria-label="Download project files"
      data-balloon-pos="down"
      onClick={() => downloadFiles()}
    >
      <Icon icon="cloud-arrow-down"></Icon>
    </button>
  );

  const openEditorWindow = React.useCallback(async () => {
    syncActiveFileState();
    const fileContents = editorFilesToFileContents(files);

    const editorWindow = window.open(
      window.location.origin +
        utils.dirname(window.location.pathname) +
        "/editor/",
      "_blank"
    );
    // @ts-ignore: .fileContents is a custom field we're adding to the window.
    editorWindow.fileContents = fileContents;
  }, [files, syncActiveFileState]);

  // Run button either gets placed in the header or floating over the editor but
  // it's the same button either way
  const openWindowButton = (
    <button
      className="code-run-button"
      aria-label="Open project files in new window"
      data-balloon-pos="down"
      onClick={() => openEditorWindow()}
    >
      <Icon icon="clone"></Icon>
    </button>
  );

  const shareButton = (
    <button
      className="code-run-button"
      aria-label="Create share link"
      data-balloon-pos="down"
      onClick={() => setShowShareModal(true)}
    >
      <Icon icon="share-nodes"></Icon>
    </button>
  );

  let shareModal: JSX.Element | null = null;
  if (showShareModal) {
    // If the user clicks the share button, we need to sync the files before
    // showing the
    syncActiveFileState();
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
      aria-label={`Re-run ${
        isShinyApp ? "app" : "code"
      } (${modKeySymbol()})-Shift-Enter`}
      data-balloon-pos="down"
      onClick={() => runAllAuto.current()}
    >
      <Icon icon="play"></Icon>
    </button>
  );

  return (
    <div className="Editor">
      {shareModal}
      {showHeaderBar ? (
        <div className="Editor--header">
          {showFileTabs ? <FileTabs {...tabbedFiles} /> : null}
          <div className="Editor--header--actions">
            {showLoadSaveButtons ? loadButton : null}
            {showLoadSaveButtons ? saveButton : null}
            {showLoadSaveButtons ? downloadButton : null}
            {showOpenWindowButton ? openWindowButton : null}
            {showShareButton ? shareButton : null}
            {formatCodeButton}
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

// =============================================================================
// Conversion between FileContent and EditorFile
// =============================================================================
export function fileContentsToEditorFiles(
  files: FileContent[],
  inferEditorExtensions: (f: FileContent) => Extension
): EditorFile[] {
  return files.map((f) => fileContentToEditorFile(f, inferEditorExtensions));
}

export function fileContentToEditorFile(
  file: FileContent,
  inferEditorExtensions: (f: FileContent) => Extension
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

// =============================================================================
// Misc utility functions
// =============================================================================
/**
 * Filter out specific diagnostic messages that we don't want to show.
 */
function diagnosticFilter(diagnostic: LSP.Diagnostic): boolean {
  // Don't show diagnostics about unused vars.
  if (diagnostic.severity === 4 && /is unused$/.test(diagnostic.message)) {
    return false;
  }

  // The version of pyright we currently use still has a buggy diagnostic. Once
  // we update pyright, we can remove this filter.
  // https://github.com/rstudio/py-shiny/issues/124
  // https://github.com/microsoft/pyright/issues/3344
  if (
    /Argument does not match parameter type for parameter "value".*Iterable\[SliderValueArg@input_slider\]/s.test(
      diagnostic.message
    )
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
