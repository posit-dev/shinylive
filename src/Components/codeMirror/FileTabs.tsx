import "balloon-css";
import * as React from "react";
import { Icon } from "../Icons";
import type { useTabbedCodeMirror } from "./useTabbedCodeMirror";

// =============================================================================
// Utility functions
// =============================================================================
export function FileTabs({
  files,
  activeFile,
  editingFilename,
  addFile,
  uploadFile,
  renameFile,
  closeFile,
  selectFile,
  enterNameEditMode,
  setFocusOnEditor,
}: ReturnType<typeof useTabbedCodeMirror>) {
  const moreThanOneFile = files.length > 1;
  const inNameEditMode = editingFilename !== null;

  return (
    <>
      <div className="editor-files">
        {files.map((f, index) => {
          const isActiveFile = activeFile.name === f.name;

          const editingCurrentFilename = inNameEditMode && isActiveFile;

          // The filename is valid if...
          const validFileName =
            // It's not being edited
            !editingCurrentFilename ||
            // or it has no conflicts with the names of the other files
            files.every(
              (file, i) =>
                i === index || // Can't conflict with its own name
                file.name.toLowerCase() !== editingFilename.toLowerCase(),
            );

          return (
            <button
              key={f.name}
              className={isActiveFile ? "selected" : undefined}
              onClick={() => {
                selectFile(f.name);
                setFocusOnEditor(true);
              }}
            >
              <span className="editor-filename">
                {editingCurrentFilename ? editingFilename : f.name}
              </span>

              {moreThanOneFile ? (
                <span
                  className="editor-closebutton"
                  aria-label="Close file"
                  onClick={(e) => {
                    if (!confirm("Close " + f.name + "?")) {
                      e.stopPropagation();
                      return;
                    }
                    closeFile(e, index);
                  }}
                >
                  &times;
                </span>
              ) : null}

              {editingCurrentFilename ? (
                <input
                  autoFocus
                  aria-label="Name current file"
                  className={validFileName ? undefined : "invalid-filename"}
                  value={editingFilename}
                  spellCheck="false"
                  onChange={(e) => enterNameEditMode(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter" && validFileName) {
                      renameFile(activeFile.name, editingFilename);
                    } else if (!/^[a-zA-Z0-9/_.-]$/.test(e.key)) {
                      // Only allow letters, numbers, slash, underscore, period,
                      // and hyphen to go through.
                      e.preventDefault();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      enterNameEditMode(null);
                    } else if (e.key == " ") {
                      // Prevent Spacebar from triggering click on the button,
                      // and resetting editingFilename.
                      e.preventDefault();
                    }
                  }}
                  onBlur={(e) => {
                    if (editingFilename) {
                      if (validFileName) {
                        renameFile(activeFile.name, editingFilename);
                      } else {
                        enterNameEditMode(null);
                      }
                    }
                  }}
                />
              ) : null}
            </button>
          );
        })}

        <span className="editor-addtab">
          <button
            className="editor-addbutton"
            aria-label="Add a file"
            data-balloon-pos="down"
            onClick={() => addFile()}
          >
            +
          </button>
          <button
            className="editor-uploadbutton"
            aria-label="Load a file from disk"
            data-balloon-pos="down"
            onClick={() => uploadFile()}
          >
            <Icon icon="arrow-up-from-bracket"></Icon>
          </button>
        </span>
      </div>
    </>
  );
}
