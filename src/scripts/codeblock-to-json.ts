// This script is meant to be executed with Deno, not Node.js!
//
// It converts a file containing codeblock content, to a JSON file containing an
// array of FileContent objects.
//
// Usage:
//   deno run --allow-read --allow-write codeblock-to-json.ts input.txt output.json
//
// Deno can run Typescript directly, but we are still running it through esbuild
// to generate JS because we want to bundle other files into it. If we didn't
// bundle the files, we would need to do some weird stuff with paths for the
// import to work at run time, because the output path structure is different.
import { parseCodeBlock } from "../parse-codeblock";

const { args } = Deno;

if (args.length < 2) {
  const scriptName = import.meta.url.replace("file://" + Deno.cwd() + "/", "");
  console.error(
    "Need to provide input and output files.\n" +
      "Usage:\n" +
      `  deno run --allow-read --allow-write ${scriptName} <inputfile> <outputfile>`
  );
  Deno.exit(1);
}

console.log("Converting " + args[0] + " to " + args[1]);

const data = Deno.readTextFileSync(args[0]);

const { files } = parseCodeBlock(data, "app.py");

Deno.writeTextFileSync(args[1], JSON.stringify(files));
