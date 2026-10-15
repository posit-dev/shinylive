// Writing a shiny version pin into an app's dependency file. The picker calls
// this; it only ever writes `==`.

import type { FileContent } from "./Components/filecontent";
import {
  PIN_FILE,
  parseDescriptionEntry,
  parseRequirementsLine,
  type Engine,
} from "./shiny-version";

function lineEnding(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// Split keeping each line's ending out of the line, so joins are exact.
function splitLines(text: string): {
  lines: string[];
  eol: string;
  trailing: boolean;
} {
  const eol = lineEnding(text);
  const trailing = text.endsWith(eol);
  const body = trailing ? text.slice(0, -eol.length) : text;
  return { lines: body === "" ? [] : body.split(eol), eol, trailing };
}

const REQ_SHINY =
  /^(\s*)([A-Za-z0-9][A-Za-z0-9._-]*)(\s*\[[^\]]*\])?(.*?)(\s+#.*)?$/;

function pinRequirementsLine(line: string, exact: string): string {
  // The name and extras come from the line, the version from us, the comment
  // (if any) stays.
  const m = REQ_SHINY.exec(line.replace(/\r$/, ""));
  if (!m) return `shiny==${exact}`;
  const [, indent, name, extras, , comment] = m;
  return `${indent}${name}${(extras ?? "").trim()}==${exact}${comment ?? ""}`;
}

function pinRequirements(text: string, exact: string): string {
  const { lines, eol, trailing } = splitLines(text);
  const idx = lines.findIndex((l) => parseRequirementsLine(l) !== null);
  if (idx === -1) {
    lines.push(`shiny==${exact}`);
    return lines.join(eol) + eol;
  }
  lines[idx] = pinRequirementsLine(lines[idx], exact);
  return lines.join(eol) + (trailing ? eol : "");
}

// R DESCRIPTION: rewrite the shiny entry inside the Imports or Depends block,
// adding one when neither field names shiny.
function pinDescription(text: string, exact: string): string {
  const { lines, eol, trailing } = splitLines(text);
  const pinned = `shiny (== ${exact})`;

  for (const field of ["Imports", "Depends"]) {
    const start = lines.findIndex((l) => l.startsWith(field + ":"));
    if (start === -1) continue;
    let end = start + 1;
    while (end < lines.length && /^[ \t]/.test(lines[end])) end++;
    for (let i = start; i < end; i++) {
      // Entries are comma separated and may share a line, so rewrite by entry.
      const prefix = i === start ? field + ":" : "";
      const value = lines[i].slice(prefix.length);
      const entries = value.split(",");
      const hit = entries.findIndex((e) => parseDescriptionEntry(e) !== null);
      if (hit === -1) continue;
      const lead = /^\s*/.exec(entries[hit])![0];
      entries[hit] = lead + pinned;
      lines[i] = prefix + entries.join(",");
      return lines.join(eol) + (trailing ? eol : "");
    }
  }

  // No shiny entry. Append to Imports, creating the field if needed.
  const start = lines.findIndex((l) => l.startsWith("Imports:"));
  if (start === -1) {
    lines.push("Imports:", `    ${pinned}`);
    return lines.join(eol) + eol;
  }
  let end = start + 1;
  while (end < lines.length && /^[ \t]/.test(lines[end])) end++;
  const last = end - 1;
  if (last === start && lines[start].trim() !== "Imports:") {
    lines[start] = lines[start].replace(/\s*$/, "") + `, ${pinned}`;
  } else {
    if (
      !lines[last].trimEnd().endsWith(",") &&
      lines[last].trim() !== "Imports:"
    ) {
      lines[last] = lines[last].trimEnd() + ",";
    }
    lines.splice(end, 0, `    ${pinned}`);
  }
  return lines.join(eol) + (trailing ? eol : "");
}

const MINIMAL_DESCRIPTION = (exact: string) =>
  `Package: app\nVersion: 0.0.1\nImports:\n    shiny (== ${exact})\n`;

/** A copy of `files` with shiny pinned to `exact` in the engine's pin file. */
export function writeShinyPin(
  files: FileContent[],
  engine: Engine,
  exact: string,
): FileContent[] {
  const name = PIN_FILE[engine];
  const existing = files.find((f) => f.name === name);
  const rewrite = engine === "python" ? pinRequirements : pinDescription;

  if (!existing || existing.type !== "text") {
    const content =
      engine === "python" ? `shiny==${exact}\n` : MINIMAL_DESCRIPTION(exact);
    const without = files.filter((f) => f.name !== name);
    return [...without, { name, content, type: "text" }];
  }
  return files.map((f) =>
    f === existing
      ? { name, type: "text", content: rewrite(existing.content, exact) }
      : f,
  );
}
