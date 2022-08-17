// import { AppMode, runApp } from "./Components/App";
import { parseCodeBlock } from "./parse-codeblock";
// @ts-expect-error: This import is _not_ bundled. It would be nice to be able
// import type information from ./Components/App (which gets compiled to
// shinylive.js), but I haven't figured out how to make it do that and do this
// (non-bundled) import.
import { AppMode, runApp } from "./shinylive.js";

type classToAppTypeMapping = {
  class: string;
  appMode: AppMode;
  defaultFilename: string;
};

// Mappings from HTML class names to types (passed to App component.
const classToAppTypeMappings: classToAppTypeMapping[] = [
  { class: "pyshiny", appMode: "editor-viewer", defaultFilename: "app.py" },
  { class: "pyshinyapp", appMode: "viewer", defaultFilename: "app.py" },
  {
    class: "pyterminal",
    appMode: "editor-terminal",
    defaultFilename: "code.py",
  },
  { class: "pycell", appMode: "editor-cell", defaultFilename: "code.py" },
];

// Get a string that selects all the cells, like
// ".pyshiny, .pyshinyapp, .pyterminal, .pycell"
const allClassesSelector = classToAppTypeMappings
  .map((x) => "." + x.class)
  .join(", ");

// Select all of the DOM elements that match the combined selector. It's
// important that they're selected in the order they appear in the page, so that
// we execute them in the correct order.
const blocks: NodeListOf<HTMLPreElement> =
  document.querySelectorAll(allClassesSelector);

blocks.forEach((block) => {
  // Look for first of our mapping classes that matches (like pyshiny,
  // pyshinyapp, etc.)
  let mapping: classToAppTypeMapping | null = null;
  for (const m of classToAppTypeMappings) {
    if (block.className.split(" ").includes(m.class)) {
      mapping = m;
      break;
    }
  }

  if (!mapping) {
    console.log("No mapping found for block ", block);
    return;
  }

  const container = document.createElement("div");
  container.className = "pyshiny-container";

  // Copy over explicitly-set style properties.
  container.style.cssText = block.style.cssText;

  block.parentNode!.replaceChild(container, block);

  const { files, quartoArgs: quartoArgs } = parseCodeBlock(
    block.innerText,
    mapping.defaultFilename
  );

  const opts = { startFiles: files, ...quartoArgs };
  runApp(container, mapping.appMode, opts);
});
