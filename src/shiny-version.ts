// Reading and resolving an app's shiny version pin. Pure functions, no I/O.
//
// Python apps pin in requirements.txt (`shiny[theme]==1.6.3`), R apps in
// DESCRIPTION (`Imports: shiny (== 1.11.1)`). Matching compares major.minor
// against the bundled versions; see resolveShinyVersion().

export type Engine = "python" | "r";

export type PinFile = { name: string; content: string | Uint8Array };

export type Clause = {
  op: "==" | "!=" | ">=" | "<=" | ">" | "<" | "~=";
  version: string;
};

export type ShinySpec =
  | { kind: "none" }
  | { kind: "unparseable"; line: string }
  | { kind: "clauses"; line: string; extras: string; clauses: Clause[] };

export const PIN_FILE: Record<Engine, string> = {
  python: "requirements.txt",
  r: "DESCRIPTION",
};

// PEP 503 normalization, so `Shiny`, `shiny` and `SHINY` all match.
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

// `shiny`, `shiny[theme]`, `shiny [a, b]`, followed by whatever is left.
const REQ_NAME = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/;
const CLAUSE = /^(===|==|~=|!=|>=|<=|>|<)\s*([0-9]+(?:\.[0-9]+)*(?:\.\*)?)$/;

function parseClauses(text: string): Clause[] | null {
  let rest = text.trim();
  // PEP 508 allows the version in parentheses: `shiny (>=1.5)`.
  if (rest.startsWith("(") && rest.endsWith(")"))
    rest = rest.slice(1, -1).trim();
  if (rest === "") return [];
  const clauses: Clause[] = [];
  for (const part of rest.split(",")) {
    const m = CLAUSE.exec(part.trim());
    if (!m) return null;
    const op = (m[1] === "===" ? "==" : m[1]) as Clause["op"];
    clauses.push({ op, version: m[2] });
  }
  return clauses;
}

/**
 * Parse one requirements.txt line. Returns null when the line is a comment,
 * blank, or names a package other than shiny.
 */
export function parseRequirementsLine(rawLine: string): ShinySpec | null {
  // Strip a trailing comment and an environment marker; neither affects the pin.
  let line = rawLine.replace(/\r$/, "").trim();
  if (line === "" || line.startsWith("#")) return null;
  line = line.replace(/(^|\s)#.*$/, "").trim();
  const specLine = line;
  line = line.split(";")[0].trim();

  const m = REQ_NAME.exec(line);
  if (!m || normalizeName(m[1]) !== "shiny") return null;
  const extras = m[2] ?? "";
  const rest = m[3];
  if (rest.startsWith("@")) return { kind: "unparseable", line: specLine };
  const clauses = parseClauses(rest);
  if (clauses === null) return { kind: "unparseable", line: specLine };
  return { kind: "clauses", line: specLine, extras, clauses };
}

// R DESCRIPTION fields are "Name: value" with continuation lines indented.
export function dcfField(content: string, field: string): string | null {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(field + ":"));
  if (start === -1) return null;
  const parts = [lines[start].slice(field.length + 1)];
  for (let i = start + 1; i < lines.length && /^[ \t]/.test(lines[i]); i++) {
    parts.push(lines[i]);
  }
  return parts.join(" ");
}

const R_ENTRY = /^([A-Za-z][A-Za-z0-9.]*)\s*(?:\((.*)\))?$/;

/**
 * Parse one DESCRIPTION dependency entry, such as `shiny (== 1.11.1)`.
 * Returns null when the entry names another package.
 */
export function parseDescriptionEntry(entry: string): ShinySpec | null {
  const text = entry.trim();
  if (text === "") return null;
  const m = R_ENTRY.exec(text);
  if (!m) return null;
  if (m[1] !== "shiny") return null;
  const clauses = parseClauses(m[2] ?? "");
  if (clauses === null) return { kind: "unparseable", line: text };
  return { kind: "clauses", line: text, extras: "", clauses };
}

function pinFileText(files: PinFile[], engine: Engine): string | null {
  const file = files.find((f) => f.name === PIN_FILE[engine]);
  if (!file || typeof file.content !== "string") return null;
  return file.content;
}

/** The shiny pin an app declares, if any. */
export function findShinySpec(files: PinFile[], engine: Engine): ShinySpec {
  const text = pinFileText(files, engine);
  if (text === null) return { kind: "none" };

  if (engine === "python") {
    for (const line of text.split("\n")) {
      const spec = parseRequirementsLine(line);
      if (spec) return spec;
    }
    return { kind: "none" };
  }

  for (const field of ["Imports", "Depends"]) {
    const value = dcfField(text, field);
    if (value === null) continue;
    for (const entry of value.split(",")) {
      const spec = parseDescriptionEntry(entry);
      if (spec) return spec;
    }
  }
  return { kind: "none" };
}
