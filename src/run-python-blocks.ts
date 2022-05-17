// TODO: Figure out how to get TypeScript to get the types from Components/App,
// but have the compiled JS import from shinylive.js (because that's what
// App.tsx gets compiled to).
// import { AppMode, runApp } from "./Components/App";
import { AppMode, runApp } from "./shinylive.js";

type classToAppTypeMapping = {
  class: string;
  appMode: AppMode;
  filename: string;
};

type CommentArgument = {
  prop: string;
  val: string;
};

// Mappings from HTML class names to types (passed to App component.
const classToAppTypeMappings: classToAppTypeMapping[] = [
  { class: "pyshiny", appMode: "editor-viewer", filename: "app.py" },
  { class: "pyshinyapp", appMode: "viewer", filename: "app.py" },
  { class: "pyterminal", appMode: "editor-terminal", filename: "code.py" },
  { class: "pycell", appMode: "editor-cell", filename: "code.py" },
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

  const { lines, args } = processQuartoArgs(block.innerText.split("\n"));

  const files = [{ name: mapping.filename, content: lines.join("\n") }];
  runApp(container, mapping.appMode, files, args);
});

// Loop through all the lines of the file and extract the lines that start
// with quarto parameter comments and have the format "#| key: val" as `args`
// and strip those lines from the result. Also remove up to one empty line after
// any args.
function processQuartoArgs(lines: string[]): {
  lines: string[];
  args: Record<string, string>;
} {
  const outLines = [...lines];
  const args: Record<string, string> = {};
  let searchingForArgs = true;

  while (searchingForArgs && outLines.length > 0) {
    const argsFromLine = outLines[0].match(
      /^#\|\s(?<prop>\w+):\s*(?<val>\w+)$/
    );

    if (argsFromLine) {
      outLines.splice(0, 1);
      const { prop, val } = argsFromLine.groups as CommentArgument;
      if (!prop || !val) {
        console.warn(
          "Invalid format of layout args. Ignoring...",
          argsFromLine.groups
        );
      } else {
        args[prop] = val;
      }
    } else {
      searchingForArgs = false;
      // Remove up to one blank line after finding any args.
      if (
        Object.keys(args).length !== 0 &&
        outLines.length >= 1 &&
        outLines[0] === ""
      ) {
        outLines.splice(0, 1);
      }
    }
  }

  return {
    lines: outLines,
    args,
  };
}
