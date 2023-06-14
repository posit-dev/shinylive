import shinyLogo from "../assets/shiny-for-python.svg";
import "./HeaderBar.css";
import { Icon } from "./Icons";
import * as React from "react";

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

export default function HeaderBar({
  headerBarCallbacks = null,
}: {
  headerBarCallbacks: HeaderBarCallbacks | null;
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

  return (
    <div className="HeaderBar">
      <a className="page-title" href="https://shiny.rstudio.com/py/">
        <img className="shiny-logo" src={shinyLogo} alt="Shiny" />
      </a>
      <div>
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
