import * as React from "react";
import shinyLogo from "../assets/shiny-logo.svg";
import { engineSwitch } from "../utils";
import type { AppEngine } from "./App";
import "./HeaderBar.css";
import { Icon } from "./Icons";

export type HeaderBarCallbacks = {
  loadLocalFiles?: () => void;
  saveLocalFiles?: () => void;
  downloadFiles?: () => void;
  showShareModal?: () => void;
  openEditorWindow?: () => void;
  // This is functionally the same as openEditorWindow; the difference is that
  // the button has a different icon and text; it is meant to be used with the
  // standalone viewer.
  openEditorWindowFromViewer?: () => void;
};

export type ShinyVersionPicker = {
  running: string;
  options: { exact: string; latest: boolean }[];
  // The engine is loading, or the picker cannot act. The select stays
  // focusable and ignores changes.
  busy: boolean;
  onSelect: (exact: string) => void;
};

// Keys that move the selection of a closed <select>. On Windows and Linux
// each press fires `change` at once, so these only update a pending value.
const NAVIGATION_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function isNavigationKey(e: React.KeyboardEvent): boolean {
  if (NAVIGATION_KEYS.has(e.key)) return true;
  // Typeahead: a printable character selects the next option that starts
  // with it.
  return (
    e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey
  );
}

function VersionPicker({ picker }: { picker: ShinyVersionPicker }) {
  const options = picker.options.some((o) => o.exact === picker.running)
    ? picker.options
    : [{ exact: picker.running, latest: false }, ...picker.options];

  // A version chosen with the keyboard, not yet committed. Enter or blur
  // commits it; a pointer choice commits at once.
  const [pending, setPending] = React.useState<string | null>(null);
  React.useEffect(() => setPending(null), [picker.running, picker.busy]);

  // True from a navigation keydown until the end of its task. The browser
  // fires the `change` that the key causes in the same task, after the
  // keydown listeners return, so a timeout of 0 clears the flag after it.
  const navigatingRef = React.useRef(false);

  const commit = (value: string | null) => {
    setPending(null);
    if (picker.busy || value === null || value === picker.running) return;
    picker.onSelect(value);
  };

  return (
    <span
      className="shiny-version-picker"
      role="group"
      data-balloon-pos="down"
      aria-label="Pick the shiny version the app runs on"
    >
      <label>
        <span className="picker-label">Shiny</span>
        <select
          className="shiny-version-select"
          aria-label="Shiny version"
          value={pending ?? picker.running}
          aria-disabled={picker.busy ? "true" : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(pending);
            } else if (e.key === "Escape") {
              setPending(null);
            } else if (isNavigationKey(e)) {
              navigatingRef.current = true;
              setTimeout(() => {
                navigatingRef.current = false;
              }, 0);
            }
          }}
          onChange={(e) => {
            if (picker.busy) return;
            if (navigatingRef.current) setPending(e.target.value);
            else commit(e.target.value);
          }}
          onBlur={() => commit(pending)}
        >
          {options.map((o) => (
            <option key={o.exact} value={o.exact}>
              {o.exact}
              {o.latest ? " (latest)" : ""}
            </option>
          ))}
        </select>
      </label>
    </span>
  );
}

export default function HeaderBar({
  headerBarCallbacks = null,
  appEngine,
  shinyVersionPicker = null,
}: {
  headerBarCallbacks: HeaderBarCallbacks | null;
  appEngine: AppEngine;
  shinyVersionPicker?: ShinyVersionPicker | null;
}) {
  let loadButton = null;
  if (headerBarCallbacks?.loadLocalFiles) {
    const loadLocalFiles = headerBarCallbacks.loadLocalFiles;
    loadButton = (
      <button
        className="code-run-button"
        aria-label="Load project from a directory on disk"
        data-balloon-pos="down-right"
        onClick={() => loadLocalFiles()}
      >
        <Icon icon="upload"></Icon>
      </button>
    );
  }

  let saveButton = null;
  if (headerBarCallbacks?.saveLocalFiles) {
    const saveLocalFiles = headerBarCallbacks.saveLocalFiles;
    saveButton = (
      <button
        className="code-run-button"
        aria-label="Save all project files to disk"
        data-balloon-pos="down-right"
        onClick={() => saveLocalFiles()}
      >
        <Icon icon="download"></Icon>
      </button>
    );
  }

  let downloadButton = null;
  if (headerBarCallbacks?.downloadFiles) {
    const downloadFiles = headerBarCallbacks.downloadFiles;
    downloadButton = (
      <button
        className="code-run-button"
        aria-label="Download project files"
        data-balloon-pos="down-right"
        onClick={() => downloadFiles()}
      >
        <Icon icon="cloud-arrow-down"></Icon>
      </button>
    );
  }

  // This button is used with the Editor component.
  let openEditorButton = null;
  if (headerBarCallbacks?.openEditorWindow) {
    const openEditorWindow = headerBarCallbacks.openEditorWindow;
    openEditorButton = (
      <button
        className="code-run-button"
        aria-label="Open files in new editor window"
        data-balloon-pos="down-right"
        onClick={() => openEditorWindow()}
      >
        <Icon icon="pen-to-square"></Icon>
      </button>
    );
  }

  // This button is functionally the same as openEditorButton, but looks
  // different and is used with the standalone Viewer component.
  let openEditorFromViewerButton = null;
  if (headerBarCallbacks?.openEditorWindowFromViewer) {
    const viewInEditorWindow = headerBarCallbacks.openEditorWindowFromViewer;
    openEditorFromViewerButton = (
      <button
        className="code-run-button"
        aria-label="Open a copy in editor view"
        data-balloon-pos="down-right"
        onClick={() => viewInEditorWindow()}
      >
        <Icon icon="pen-to-square"></Icon>
        <span className="button-label">Edit</span>
      </button>
    );
  }

  let shareButton = null;
  if (headerBarCallbacks?.showShareModal) {
    const showShareModal = headerBarCallbacks.showShareModal;
    shareButton = (
      <button
        className="code-run-button"
        aria-label="Create share link"
        data-balloon-pos="down-right"
        onClick={() => showShareModal()}
      >
        <Icon icon="share-nodes"></Icon>
        <span className="button-label">Share</span>
      </button>
    );
  }

  const mainUrl = {
    python: "https://shiny.posit.co/py/",
    r: "https://shiny.posit.co/",
  };

  return (
    <div className="HeaderBar">
      {
        // eslint-disable-next-line react/jsx-no-target-blank
        <a className="page-title" href={mainUrl[appEngine]} target="_blank">
          <img className="shiny-logo" src={shinyLogo} alt="Shiny" />
          <span>
            <span style={{ fontSize: "0.65em", marginLeft: "-2px" }}>for</span>{" "}
            {engineSwitch(appEngine, "R", "Python")}
          </span>
        </a>
      }
      <div>
        {shinyVersionPicker ? (
          <VersionPicker picker={shinyVersionPicker} />
        ) : null}
        {loadButton}
        {saveButton}
        {downloadButton}
        {openEditorButton}
        {openEditorFromViewerButton}
        {shareButton}
      </div>
    </div>
  );
}
