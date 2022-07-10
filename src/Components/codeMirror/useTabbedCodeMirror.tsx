import * as fileio from "../../fileio";
import { LSPClient } from "../../language-server/lsp-client";
import { inferFiletype } from "../../utils";
import {
  EditorFile,
  fileContentsToEditorFiles,
  fileContentToEditorFile,
} from "../Editor";
import type { FileContent } from "../filecontent";
import { getMinimalExtensions } from "./extensions";
import { Extension, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as React from "react";

export function useTabbedCodeMirror({
  currentFilesFromApp,
  cmView,
  inferEditorExtensions,
  setFilesHaveChanged,
  lspClient,
  lspPathPrefix = "",
}: {
  currentFilesFromApp: FileContent[];
  cmView: EditorView | undefined;
  inferEditorExtensions: (f: FileContent | EditorFile) => Extension;
  setFilesHaveChanged: (value: boolean) => void;
  lspClient: LSPClient;
  lspPathPrefix: string;
}) {
  const [files, setFiles] = React.useState<EditorFile[]>([]);

  // A counter that increments each time a new file is added by clicking the plus
  // button. It is reset when a new set of files is received from the parent.
  const [newFileCounter, setNewFileCounter] = React.useState(1);

  const [activeFileIdx, setActiveFileIdx] = React.useState(0);

  // If a file name is being edited, this will be an object with index and name
  // (as it is being edited); otherwise it's null when no renaming is happening.
  const [editingFilename, setEditingFilename] = React.useState<string | null>(
    null
  );

  // ===========================================================================
  // Callback to run each time we receive a new set of files from the parent
  // App.
  // ===========================================================================
  React.useEffect(() => {
    setFiles(
      fileContentsToEditorFiles(currentFilesFromApp, inferEditorExtensions)
    );
    setActiveFileIdx(0);

    setNewFileCounter(1);
  }, [currentFilesFromApp, inferEditorExtensions]);

  // ===========================================================================
  // File adding/removing/renaming
  // ===========================================================================
  function closeFile(e: React.SyntheticEvent, index: number) {
    e.stopPropagation();

    const updatedFiles = [...files];
    const filename = updatedFiles[index].name;
    updatedFiles.splice(index, 1);
    setFiles(updatedFiles);

    if (activeFileIdx > updatedFiles.length - 1) {
      // If we were on the last (right-most) tab and it was closed, set the
      // active tab to the new right-most tab.
      setActiveFileIdx(updatedFiles.length - 1);
    }

    setFilesHaveChanged(true);

    lspClient.deleteFile(lspPathPrefix + filename);
  }

  function addFile() {
    const fileContent: FileContent = {
      name: `file${newFileCounter}.py`,
      type: "text",
      content: "",
    };
    const newFile: EditorFile = fileContentToEditorFile(
      fileContent,
      inferEditorExtensions
    );

    setEditingFilename(newFile.name);
    setNewFileCounter(newFileCounter + 1);
    setFiles([...files, newFile]);
    setActiveFileIdx(files.length);
    setFilesHaveChanged(true);

    lspClient.createFile(lspPathPrefix + fileContent.name, fileContent.content);
  }

  const uploadFile = React.useCallback(async () => {
    fileio.assertHasFileAccessApiSupport();
    const [fileHandle] = await window.showOpenFilePicker();
    const fileContent = await fileio.loadFileContent(fileHandle);

    const newFile: EditorFile = fileContentToEditorFile(
      fileContent,
      inferEditorExtensions
    );

    const updatedFiles = [...files];
    const filenameMatchIdx = updatedFiles.findIndex(
      (f) => f.name === newFile.name
    );
    if (filenameMatchIdx === -1) {
      updatedFiles.push(newFile);
      setActiveFileIdx(updatedFiles.length - 1);
    } else {
      // If a file with the same name already exists, replace it.
      updatedFiles[filenameMatchIdx] = newFile;
      setActiveFileIdx(filenameMatchIdx);
    }

    setFiles(updatedFiles);
    setFilesHaveChanged(true);
  }, [files, inferEditorExtensions, setFilesHaveChanged]);

  function renameFile(oldFileName: string, newFileName: string) {
    const updatedFiles = [...files];
    const fileIndex = updatedFiles.findIndex((f) => f.name === oldFileName);

    updatedFiles[fileIndex].name = newFileName;

    if (cmView) {
      // Unset extensions, then set them, using the updated file information.
      // The unsetting is necessary to clear out previous extensions that
      cmView.dispatch({
        effects: StateEffect.reconfigure.of(getMinimalExtensions()),
      });
      cmView.dispatch({
        effects: StateEffect.reconfigure.of(
          inferEditorExtensions(updatedFiles[fileIndex])
        ),
      });
    }
    syncActiveFileState();

    setFiles(updatedFiles);

    setEditingFilename(null);
    setFilesHaveChanged(true);

    if (inferFiletype(oldFileName) === "python") {
      lspClient.deleteFile(lspPathPrefix + oldFileName);
    }
    if (inferFiletype(newFileName) === "python") {
      lspClient.createFile(
        lspPathPrefix + newFileName,
        updatedFiles[fileIndex].ref.editorState.doc.toString()
      );
    }
  }

  function selectFile(fileName: string) {
    const fileIndex = files.findIndex((f) => f.name === fileName);

    if (activeFileIdx === fileIndex) {
      // User has clicked on the currently selected file tab, so turn on rename
      // mode.
      setEditingFilename(fileName);
    } else {
      // Otherwise this is just a normal file switch.
      setActiveFileIdx(fileIndex);
    }
  }

  function enterNameEditMode(name: string | null) {
    if (name === null) {
      setEditingFilename(null);
      return;
    }
    setEditingFilename(name);
  }

  const activeFile = files[activeFileIdx];

  /**
   * Store the currently active file's CodeMirror state (from the EditorView) in
   * the corresponding entry in `files`, but in the `ref` property, which is
   * meant to be mutable. This should be called just before doing operations on
   * `files` or `activeFile`.
   */
  const syncActiveFileState = React.useCallback(() => {
    if (!cmView) return;
    activeFile.ref.editorState = cmView.state;
    activeFile.ref.scrollTop = cmView.scrollDOM.scrollTop;
    activeFile.ref.scrollLeft = cmView.scrollDOM.scrollLeft;
  }, [activeFile, cmView]);

  return {
    files,
    setFiles,
    activeFile,
    syncActiveFileState,
    editingFilename,
    addFile,
    uploadFile,
    renameFile,
    closeFile,
    selectFile,
    enterNameEditMode,
  };
}
