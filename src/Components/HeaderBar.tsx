import shinyLogo from "../assets/shiny-logo.svg";
import "./HeaderBar.css";
import { Icon } from "./Icons";
import * as React from "react";

export type HeaderBarCallbacks = {
  loadLocalFiles?: () => void;
  saveLocalFiles?: () => void;
  downloadFiles?: () => void;
  showShareModal?: () => void;
  openEditorWindow?: () => void;
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
        data-balloon-pos="down"
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
        data-balloon-pos="down"
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
        data-balloon-pos="down"
        onClick={() => downloadFiles()}
      >
        <Icon icon="cloud-arrow-down"></Icon>
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
        data-balloon-pos="down"
        onClick={() => showShareModal()}
      >
        <Icon icon="share-nodes"></Icon>
        <span className="button-label">Share</span>
      </button>
    );
  }

  let editButton = null;
  if (headerBarCallbacks?.openEditorWindow) {
    const openEditorWindow = headerBarCallbacks.openEditorWindow;
    editButton = (
      <button
        className="code-run-button"
        aria-label="Open in editor view"
        data-balloon-pos="down-right"
        onClick={() => openEditorWindow()}
      >
        <Icon icon="pen-to-square"></Icon>
        <span className="button-label">Edit</span>
      </button>
    );
  }

  return (
    <div className="HeaderBar">
      <a className="page-title" href="https://shiny.rstudio.com/py/">
        <img className="shiny-logo" src={shinyLogo} alt="Shiny" />
        <span>for Python</span>
      </a>
      <div>
        {loadButton}
        {saveButton}
        {downloadButton}
        {shareButton}
        {editButton}
      </div>
    </div>
  );
}
