import type { AppEngine, AppMode } from "./Components/App";
import type { Component } from "./parse-codeblock";
import { parseCodeBlock } from "./parse-codeblock";
// @ts-expect-error: This import is _not_ bundled. It would be nice to be able
// import type information from ./Components/App (which gets compiled to
// shinylive.js), but I haven't figured out how to make it do that and do this
// (non-bundled) import.
import { runApp } from "./shinylive.js";

// Select all of the DOM elements that match the combined selector. It's
// important that they're selected in the order they appear in the page, so that
// we execute them in the correct order.
const blocks: NodeListOf<HTMLPreElement> = document.querySelectorAll(
  ".shinylive-python, .shinylive-r"
);

blocks.forEach((block) => {
  const container = document.createElement("div");
  container.className = "shinylive-wrapper";

  // Look for the data-engine attribute. It is normally on the .shinylive-xx
  // element, but the Quarto filter for RevealJS moves the data-engine attribute
  // to the parent element, so we'll look there as well.
  const engine: AppEngine = (block.dataset.engine ||
    block.parentElement?.dataset.engine ||
    "python") as AppEngine;

  // Copy over explicitly-set style properties.
  container.style.cssText = block.style.cssText;

  block.parentNode!.replaceChild(container, block);

  const { files, quartoArgs } = parseCodeBlock(block.innerText, engine);

  const appMode = convertComponentArrayToAppMode(quartoArgs.components);

  const opts = { startFiles: files, ...quartoArgs };
  runApp(container, appMode, opts, engine);
});

/**
 * Convert an array of components, like ["editor", "viewer"] to an AppMode
 * string.
 */
function convertComponentArrayToAppMode(
  components: Component[] | Component
): AppMode {
  if (typeof components === "string") {
    components = [components];
  }
  const c_string = components.sort().join(",");

  if (c_string === "editor,viewer") {
    return "editor-viewer";
  } else if (c_string === "editor,terminal,viewer") {
    return "editor-terminal-viewer";
  } else if (c_string === "editor,terminal") {
    return "editor-terminal";
  } else if (c_string === "cell,editor") {
    return "editor-cell";
  } else if (c_string === "viewer") {
    return "viewer";
  } else {
    throw new Error(
      "Unknown shinylive component combination: " + JSON.stringify(components)
    );
  }
}
