import * as fs from "fs";
import { globSync } from "glob";
import { isBinary } from "istextorbinary";
import * as path from "path";
import type { ExampleCategoryIndexJson } from "../src/examples";

export default function buildExamples(examplesDir: string, buildDir: string) {
  const orderingFile = `${examplesDir}/index.json`;
  const outputFile = `${buildDir}/shinylive/examples.json`;

  const latest_example_edit = latestMtime(examplesDir);

  // Allow for the posibility the examples output is missing
  const latest_example_out = fs.existsSync(outputFile)
    ? fs.statSync(outputFile).mtimeMs
    : 0;

  if (latest_example_edit < latest_example_out) {
    return;
  }

  console.log("Regenerating examples.json");

  const ordering: ExampleCategoryIndexJson[] = JSON.parse(
    fs.readFileSync(orderingFile).toString()
  );

  function parseApp(exampleDir: string) {
    const appPath = `${examplesDir}/${exampleDir}`;

    if (!fs.existsSync(appPath)) {
      throw new Error(
        `The requested example directory: ${appPath} does not exist. Check spelling.`
      );
    }

    const [title, ...aboutLines] = fs
      .readFileSync(`${appPath}/about.txt`)
      .toString()
      .split("\n");

    const files = globSync(`${appPath}/**`, {
      nodir: true,
      dotRelative: true,
    }).map((f) => f.replace(`${appPath}/`, "")); // Strip off leading path

    return {
      title,
      about: aboutLines.filter((l) => l !== "").join("/n"),
      files: files
        .filter((f) => f !== "about.txt")
        .filter((f) => !f.includes("__pycache__"))
        .filter((f) => {
          const fstat = fs.statSync(path.join(appPath, f));
          if (!(fstat.isFile() || fstat.isSymbolicLink())) {
            console.log(`${appPath}/${f} is not a file or symlink. Skipping.`);
            return false;
          }
          return true;
        })
        .sort((a: string, b: string) => {
          // Sort files, with "app.py" first, and other files in normal sorted
          // order.
          if (a === "app.py") return -1;
          if (b === "app.py") return 1;

          if (a < b) return -1;
          if (a > b) return 1;
          return 0;
        })
        .map((f) => {
          const type = isBinary(f) ? "binary" : "text";
          const contentBuffer = fs.readFileSync(`${appPath}/${f}`);
          let contentString: string;

          if (type === "binary") {
            contentString = contentBuffer.toString("base64");
          } else {
            contentString = contentBuffer.toString();
          }

          return {
            name: f,
            content: contentString,
            type: type,
          };
        }),
    };
  }

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      ordering.map(({ category, apps }) => ({
        category,
        apps: apps.map(parseApp),
      })),
      null,
      2
    )
  );
}

// Given the path to a file or directory:
//   - If it's a file, return the mtime of the file.
//   - If it's a directory, return the most recent mtime of all the files in the
//     the directory, including the directory itself, and recurse into subdirs.
function latestMtime(path: string): number {
  const info = fs.statSync(path);
  if (info.isDirectory()) {
    const files = fs.readdirSync(path);
    const mtimes = files.map((f) => latestMtime(path + "/" + f));
    mtimes.push(info.mtimeMs); // Append mtime of the directory itself
    return Math.max(...mtimes);
  } else {
    return info.mtimeMs;
  }
}
