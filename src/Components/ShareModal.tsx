import * as React from "react";
import { useOnEscOrClickOutside } from "../hooks/useOnEscOrClickOutside";
import type { AppEngine } from "./App";
import "./ShareModal.css";
import type { FileContent } from "./filecontent";
import {
  appUrlPrefix,
  editorUrlPrefix,
  fileContentsToUrlString,
} from "./share";

// =============================================================================
// ShareModal component
// =============================================================================

export function ShareModal({
  fileContents = [],
  setShareModalVisible,
  appEngine,
}: {
  fileContents: FileContent[];
  setShareModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
  appEngine: AppEngine;
}) {
  const showModalRef = React.useRef<HTMLDivElement>(null);

  const encodedCode = fileContentsToUrlString(fileContents);

  const [hideHeaderChecked, setHideHeaderChecked] = React.useState(false);

  const editorUrl = editorUrlPrefix(appEngine) + "#code=" + encodedCode;

  const appUrl =
    appUrlPrefix(appEngine) +
    "#" +
    (hideHeaderChecked ? "h=0&" : "") +
    "code=" +
    encodedCode;

  const editorUrlInputRef = React.useRef<HTMLInputElement>(null);
  const appUrlInputRef = React.useRef<HTMLInputElement>(null);

  const [editorButtonText, setEditorButtonText] = React.useState("Copy URL");
  const [appButtonText, setAppButtonText] = React.useState("Copy URL");

  useOnEscOrClickOutside(showModalRef, () => setShareModalVisible(false));

  return (
    <>
      <div className="ShareModal-overlay"></div>
      <div className="ShareModal" ref={showModalRef}>
        <div className="ShareModal--item">
          <label>Editor URL ({editorUrl.length} bytes)</label>
          <div className="ShareModal--row">
            <span className="ShareModal--url">
              <input
                value={editorUrl}
                ref={editorUrlInputRef}
                className="ShareModal--urlinput"
                onFocus={(e) => e.target.select()}
                readOnly
              ></input>
            </span>
            <button
              style={{ whiteSpace: "nowrap", width: "8em" }}
              onClick={() => {
                if (!editorUrlInputRef.current) return;
                editorUrlInputRef.current.select();
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                navigator.clipboard.writeText(editorUrlInputRef.current.value);

                setEditorButtonText("\u2713");
                setTimeout(() => setEditorButtonText("Copy URL"), 800);
              }}
            >
              {editorButtonText}
            </button>
          </div>
        </div>
        <div className="ShareModal--item">
          <div className="ShareModal--row">
            <label>Application URL ({appUrl.length} bytes)</label>
            <label
              className="ShareModal--checkbox"
              aria-label="Don't show the Shiny header with Edit button"
              data-balloon-pos="up"
            >
              <input
                type="checkbox"
                checked={hideHeaderChecked}
                onChange={() => setHideHeaderChecked(!hideHeaderChecked)}
              />
              <span>Hide header</span>
            </label>
          </div>
          <div className="ShareModal--row">
            <span className="ShareModal--url">
              <input
                value={appUrl}
                ref={appUrlInputRef}
                className="ShareModal--urlinput"
                onFocus={(e) => e.target.select()}
                readOnly
              ></input>
            </span>
            <button
              style={{ whiteSpace: "nowrap", width: "8em" }}
              onClick={() => {
                if (!appUrlInputRef.current) return;
                appUrlInputRef.current.select();
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                navigator.clipboard.writeText(appUrlInputRef.current.value);

                setAppButtonText("\u2713");
                setTimeout(() => setAppButtonText("Copy URL"), 800);
              }}
            >
              {appButtonText}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
