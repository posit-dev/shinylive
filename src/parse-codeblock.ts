import type { FileContent } from "./Components/filecontent";
import { load as yamlLoad } from "js-yaml";

/**
 * Given a code block, parse it into a FileContent object and set of Quarto
 * arguments.
 *
 * A simple code block can like this (between the lines):
 * ------------------------------
 * def foo(x):
 *   return x + 1
 * ------------------------------
 *
 * It can also contain Quarto-style arguments, and multiple files. Files can
 * also be binary.
 * ------------------------------
 * #| layout: vertical
 *
 * ## file: app.py
 * def foo(x):
 *   return x + 1
 *
 * ## file: util.py
 * def bar(x):
 *   return x + 2
 *
 * ## file: logo.png
 * ## type: binary
 * iVBORw0KGgoAAAANSUhEUgAAACgAAAAuCAYAAABap1twAAAABGdBTUEAALGPC ...
 * ------------------------------
 */
export function parseCodeBlock(
  codeblock: string | string[],
  defaultFilename: string
): {
  files: FileContent[];
  quartoArgs: Record<string, string>;
} {
  if (!Array.isArray(codeblock)) {
    codeblock = codeblock.split("\n");
  }
  const { lines, quartoArgs } = processQuartoArgs(codeblock);
  const files = parseFileContents(lines, defaultFilename);
  return { files, quartoArgs };
}

/**
 *  Loop through all the lines and extract lines at the beginning which start
 *  with Quarto parameter comments and have the format "#| " as `quartoArgs`,
 *  and strip those lines from the result. Also remove up to one empty line
 *  after any args.
 */
export function processQuartoArgs(lines: string[]): {
  lines: string[];
  quartoArgs: Record<string, string>;
} {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.match(/^#\| /)) {
      // Remove up to one blank line after finding any args.
      if (line === "") {
        i++;
      }
      // Stop searching for arg comments.
      break;
    }

    i++;
  }

  // Extract the lines that start with "#| " and remove that comment prefix.
  const argCommentLines = lines
    .slice(0, i)
    .map((line) => line.replace(/^#\| /, ""));

  // Parse the args as YAML.
  const quartoArgs: Record<string, string> = yamlLoad(
    argCommentLines.join("\n")
  ) as Record<string, string>;

  return {
    lines: lines.slice(i),
    quartoArgs,
  };
}

/**
 * Given a code chunk as an array of strings, parse it into an array of
 * FileContent objects.
 *
 * @param lines The code chunk as an array of strings.
 * @param defaultFilename The filename to use if none is specified.
 *
 * @returns An array of FileContent objects.
 */
export function parseFileContents(
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
