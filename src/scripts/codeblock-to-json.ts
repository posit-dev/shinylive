// This script is meant to be executed with Deno, not Node.js!
//
// It converts a file containing codeblock content, to a JSON file containing an
// array of FileContent objects. Reads from stdin and writes to stdout.
//
// Usage:
//   deno run codeblock-to-json.ts
//
// Deno can run Typescript directly, but we are still running it through esbuild
// to generate JS because we want to bundle other files into it. If we didn't
// bundle the files, we would need to do some weird stuff with paths for the
// import to work at run time, because the output path structure is different.
import { parseCodeBlock } from "../parse-codeblock";
import { readLines } from 'https://deno.land/std/io/buffer.ts'

const { args } = Deno;

const lines: string[] = []
for await (const line of readLines(Deno.stdin)) {
  lines.push(line)
}

const content = parseCodeBlock(lines);

await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(content)));
