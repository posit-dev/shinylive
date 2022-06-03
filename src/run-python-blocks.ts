// TODO: Figure out how to get TypeScript to get the types from Components/App,
// but have the compiled JS import from shinylive.js (because that's what
// App.tsx gets compiled to).
// import { AppMode, runApp } from "./Components/App";
import { AppMode, runApp } from "./shinylive.js";
import type { FileContent } from "./Components/filecontent";

type classToAppTypeMapping = {
  class: string;
  appMode: AppMode;
  defaultFilename: string;
};

type CommentArgument = {
  prop: string;
  val: string;
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

  const { lines, args } = processQuartoArgs(block.innerText.split("\n"));

  const files = parseFileContents(lines, mapping.defaultFilename);
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

function parseFileContents(
  lines: string[],
  defaultFilename: string
): FileContent[] {
  const files: FileContent[] = [];

  let currentFile: FileContent = {
    name: defaultFilename,
    content: "",
    type: "text",
  };

  let state: "START" | "HEADER" | "FILE_CONTENT" = "START";

  for (const line of lines) {
    if (state === "START") {
      if (line.match(/^##\s?file:/)) {
        state = "HEADER";
        currentFile = {
          name: line.replace(/^##\s?file:/, "").trim(),
          content: "",
          type: "text",
        };
      } else if (line === "") {
        // Blank leading lines are ignored.
      } else {
        // File content starts with a non-blank line.
        state = "FILE_CONTENT";
        currentFile.content += line;
      }
    } else if (state === "HEADER") {
      if (line.match(/^##\s?file:/)) {
        // We've found the start of a new file -- if the previous state was
        // HEADER, the previous file would have been empty.
        state = "HEADER";
        files.push(currentFile);
        currentFile = {
          name: line.replace(/^##\s?file:/, "").trim(),
          content: "",
          type: "text",
        };
      } else if (line.match(/^##\s?type:/)) {
        const fileType = line.replace(/^##\s?type:/, "").trim();
        if (fileType === "text" || fileType === "binary") {
          currentFile.type = fileType;
        } else {
          console.warn(`Invalid type string: "${line}".`);
        }
      } else {
        // Anything else is file content.
        state = "FILE_CONTENT";
        currentFile.content += line;
      }
    } else if (state === "FILE_CONTENT") {
      if (line.match(/^##\s?file:/)) {
        // We've found the start of a new file.
        state = "HEADER";
        files.push(currentFile);
        currentFile = {
          name: line.replace(/^##\s?file:/, "").trim(),
          content: "",
          type: "text",
        };
      } else {
        // Anything else is more file content.
        currentFile.content += "\n" + line;
      }
    }
  }

  files.push(currentFile);

  return files;
}
