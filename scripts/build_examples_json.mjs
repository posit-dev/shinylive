import * as fs from "fs";
import * as path from "path";
import glob from "glob";
import { isBinary } from "istextorbinary";

export default function buildExamples(examplesDir, buildDir) {
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

  const ordering = JSON.parse(fs.readFileSync(orderingFile));

  function parseApp(exampleDir) {
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

    const files = glob
      .sync(`${appPath}/**`, { nodir: true })
      .map((f) => f.replace(`${appPath}/`, "")); // Strip off leading path

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
        .map((f) => {
          const type = isBinary(f) ? "binary" : "text";
          let content = fs.readFileSync(`${appPath}/${f}`);

          if (type === "binary") {
            content = content.toString("base64");
          } else {
            content = content.toString();
          }

          return {
            name: f,
            content: content,
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
function latestMtime(path) {
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
