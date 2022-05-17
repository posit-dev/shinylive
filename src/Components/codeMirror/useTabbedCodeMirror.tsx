import { EditorState, Extension } from "@codemirror/state";
import * as React from "react";
import { inferFiletype } from "../../utils";
import { getExtensionForFiletype } from "./extensions";
import type { EditorFile } from "../Editor";
import type { FileContent } from "../types";

export default function useTabbedCodeMirror({
  currentFilesFromApp,
  editorExtensions,
}: {
  currentFilesFromApp: FileContent[];
  editorExtensions: Extension[];
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
    setFiles(fileContentsToEditorFiles(currentFilesFromApp, editorExtensions));
    setActiveFileIdx(0);

    setNewFileCounter(1);
  }, [currentFilesFromApp, editorExtensions]);

  // ===========================================================================
  // File adding/removing/renaming
  // ===========================================================================
  function closeFile(e: React.SyntheticEvent, index: number) {
    e.stopPropagation();

    const updatedFiles = [...files];
    updatedFiles.splice(index, 1);
    setFiles(updatedFiles);

    if (activeFileIdx > updatedFiles.length - 1) {
      // If we were on the last (right-most) tab and it was closed, set the
      // active tab to the new right-most tab.
      setActiveFileIdx(updatedFiles.length - 1);
    }
  }

  function addFile() {
    const newFile: EditorFile = {
      name: `file${newFileCounter}.py`,
      ref: {
        editorState: EditorState.create({
          extensions: editorExtensions,
          doc: `def add(x, y):\n  return x + y\n`,
        }),
      },
    };

    setEditingFilename(newFile.name);
    setNewFileCounter(newFileCounter + 1);
    setFiles([...files, newFile]);
    setActiveFileIdx(files.length);
  }

  function renameFile(oldFileName: string, newFileName: string) {
    const updatedFiles = [...files];
    const fileIndex = updatedFiles.findIndex((f) => f.name === oldFileName);

    updatedFiles[fileIndex].name = newFileName;
    setFiles(updatedFiles);

    setEditingFilename(null);
    setActiveFileIdx(fileIndex);
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

  return {
    files,
    activeFile,
    editingFilename,
    addFile,
    renameFile,
    closeFile,
    selectFile,
    enterNameEditMode,
  };
}

function fileContentsToEditorFiles(
  files: FileContent[],
  extensions: Extension[]
): EditorFile[] {
  return files.map((file) => {
    return {
      name: file.name,
      ref: {
        editorState: EditorState.create({
          extensions: [
            ...extensions,
            getExtensionForFiletype(inferFiletype(file.name)),
          ],
          doc: file.content,
        }),
      },
    };
  });
}
