import { Icon } from "../Icons";
import { useTabbedCodeMirror } from "./useTabbedCodeMirror";
import * as React from "react";

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
}: ReturnType<typeof useTabbedCodeMirror>) {
  const moreThanOneFile = files.length > 1;
  const inNameEditMode = editingFilename !== null;

  return (
    <>
      <div className="Editor--header--files">
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
                file.name.toLowerCase() !== editingFilename.toLowerCase()
            );

          return (
            <button
              key={f.name}
              className={isActiveFile ? "selected" : undefined}
              onClick={() => selectFile(f.name)}
            >
              <span className="Editor--header--files--filename">
                {editingCurrentFilename ? editingFilename : f.name}
              </span>

              {moreThanOneFile ? (
                <span
                  className="Editor--header--files--closebutton"
                  aria-label="Delete file"
                  onClick={(e) => {
                    if (!confirm("Delete " + f.name + "?")) {
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

        <span className="Editor--header--files--addtab">
          <button
            className="Editor--header--files--addbutton"
            title="Add a file"
            onClick={() => addFile()}
          >
            +
          </button>
          <button
            className="Editor--header--files--uploadbutton"
            title="Load a file from disk"
            onClick={() => uploadFile()}
          >
            <Icon icon="arrow-up-from-bracket"></Icon>
          </button>
        </span>
      </div>
    </>
  );
}
