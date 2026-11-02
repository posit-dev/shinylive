#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "node:util";

// Frontmatter is one-line `key: value` pairs, so no YAML dependency is needed.
// This lets the script run before `npm ci`.
function parse(text) {
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) meta[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return meta;
}

function readDocument(file) {
  const content = fs.readFileSync(file, "utf8");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const meta = frontmatter ? parse(frontmatter[1]) : {};
  // Keep line endings so section byte counts match the original UTF-8 file.
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const byteOffsets = [0];
  for (const line of lines) {
    byteOffsets.push(byteOffsets.at(-1) + Buffer.byteLength(line, "utf8"));
  }
  return {
    meta: meta && typeof meta === "object" ? meta : {},
    lines,
    byteOffsets,
    frontmatterLines: frontmatter ? (frontmatter[0].match(/[^\n]*\n|[^\n]+$/g) ?? []).length : 0,
  };
}

function printSummary(file, document) {
  const { meta, lines, byteOffsets } = document;
  const title = typeof meta.title === "string" ? meta.title : path.basename(file);
  console.log(`## ${title} (${file})`);
  console.log(`${lines.length} lines; ${byteOffsets.at(-1)} UTF-8 bytes`);
  if (typeof meta.description === "string" && meta.description) {
    console.log(meta.description);
  }
  console.log();
}

function printOutline(document) {
  const { lines, byteOffsets, frontmatterLines } = document;
  const headings = [];
  let fence = null;

  for (let i = frontmatterLines; i < lines.length; i++) {
    const text = lines[i].replace(/\r?\n$/, "");
    const marker = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = marker[1];
      continue;
    }
    const heading = text.match(/^ {0,3}(#{1,6})(?:[\t ]+|$)(.*)$/);
    if (heading) {
      headings.push({
        level: heading[1].length,
        title: heading[2].replace(/(?:^|[\t ]+)#+[\t ]*$/, "").trim(),
        start: i + 1,
      });
    }
  }

  if (headings.length === 0) {
    console.log("No # headings found. Use a targeted text search or bounded line read.");
    return;
  }
  console.log("Inclusive line ranges include subsections, ending before the next heading of equal or higher level.");
  console.log("Parent and child ranges overlap; choose the smallest relevant section.");
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const next = headings.slice(i + 1).find((candidate) => candidate.level <= heading.level);
    const end = next ? next.start - 1 : lines.length;
    const bytes = byteOffsets[end] - byteOffsets[heading.start - 1];
    console.log(`${heading.start}-${end} | ${bytes} bytes | ${"#".repeat(heading.level)} ${heading.title}`);
  }
}

function main() {
  const { values, positionals } = parseArgs({
    options: { outline: { type: "string" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log("Usage: node list_memory_bank.mjs [memory-bank-directory] [--outline file.md]");
    console.log("Default: catalog with titles, descriptions, line counts, and UTF-8 byte sizes.");
    console.log("--outline: # headings (H1-H6) with line ranges and sizes; skips frontmatter and fenced code.");
    console.log("Outline paths are relative to the selected memory bank, or absolute.");
    return;
  }
  if (positionals.length > 1) {
    throw new Error("Expected at most one memory-bank directory. Use --help for usage.");
  }
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const memoryBank = positionals[0]
    ? path.resolve(positionals[0])
    : path.resolve(directory, "..", "..", "..", "..", "memory-bank");

  if (!fs.statSync(memoryBank).isDirectory()) {
    throw new Error(`${memoryBank} is not a directory`);
  }
  if (values.outline) {
    const file = path.resolve(memoryBank, values.outline);
    const document = readDocument(file);
    printSummary(file, document);
    printOutline(document);
    return;
  }

  console.log(`Memory bank: ${memoryBank}\n`);
  const files = fs.readdirSync(memoryBank, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  for (const file of files) {
    printSummary(file, readDocument(path.join(memoryBank, file)));
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
