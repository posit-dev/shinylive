// Reading and resolving an app's shiny version pin. Pure functions, no I/O.
//
// Python apps pin in requirements.txt (`shiny[theme]==1.6.3`), R apps in
// DESCRIPTION (`Imports: shiny (== 1.11.1)`). Matching compares major.minor
// against the bundled versions; see resolveShinyVersion().

import shinyVersionsJson from "../shiny_versions.json";

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

export type AvailableVersions = Record<string, string>;

export type ShinyVersionResolution = {
  minor: string;
  exact: string;
  requested: string | null;
  note: string | null;
};

/** The versions this build of shinylive bundles, from shiny_versions.json. */
export function bundledShinyVersions(engine: Engine): AvailableVersions {
  return (shinyVersionsJson as Record<Engine, AvailableVersions>)[engine];
}

function parts(version: string): number[] {
  return version
    .split(".")
    .filter((p) => p !== "*")
    .map((p) => parseInt(p, 10));
}

// Compare two dotted versions numerically, padding the shorter with zeros.
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// "1.6.3" -> "1.6", "1.6" -> "1.6", "1.6.*" -> "1.6", "2" -> "2.0"
export function minorOf(version: string): string {
  const p = parts(version);
  return `${p[0] ?? 0}.${p[1] ?? 0}`;
}

type Bundled = { minor: string; exact: string };

function sortedNewestFirst(available: AvailableVersions): Bundled[] {
  return Object.entries(available)
    .map(([minor, exact]) => ({ minor, exact }))
    .sort((a, b) => compareVersions(b.minor, a.minor));
}

export function newestBundled(available: AvailableVersions): Bundled {
  return sortedNewestFirst(available)[0];
}

function satisfies(exact: string, clause: Clause): boolean {
  const c = compareVersions(exact, clause.version);
  switch (clause.op) {
    case "==":
      return minorOf(exact) === minorOf(clause.version);
    case "!=":
      return c !== 0;
    case ">=":
      return c >= 0;
    case ">":
      return c > 0;
    case "<=":
      return c <= 0;
    case "<":
      return c < 0;
    case "~=": {
      // >= version, and the same prefix with the last component dropped.
      const prefix = parts(clause.version).slice(0, -1);
      const ep = parts(exact);
      return c >= 0 && prefix.every((v, i) => (ep[i] ?? 0) === v);
    }
  }
}

function isFullVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

export function resolveShinyVersion(
  files: PinFile[],
  engine: Engine,
  available: AvailableVersions,
): ShinyVersionResolution {
  const bundled = sortedNewestFirst(available);
  const newest = bundled[0];
  const oldest = bundled[bundled.length - 1];
  const range = `${oldest.exact} to ${newest.exact}`;
  const clean = (
    b: Bundled,
    requested: string | null,
    note: string | null,
  ) => ({
    minor: b.minor,
    exact: b.exact,
    requested,
    note,
  });

  const spec = findShinySpec(files, engine);
  if (spec.kind === "none") return clean(newest, null, null);
  if (spec.kind === "unparseable") {
    return clean(
      newest,
      null,
      `could not read the shiny line "${spec.line}"; running ${newest.exact}`,
    );
  }
  if (spec.clauses.length === 0) return clean(newest, null, null);

  const pin = spec.clauses.find((c) => c.op === "==");
  const requested = pin && isFullVersion(pin.version) ? pin.version : null;

  // A pin picks a minor directly; anything else is a range over the bundled set.
  if (pin && spec.clauses.length === 1) {
    const wanted = minorOf(pin.version);
    const hit = bundled.find((b) => b.minor === wanted);
    if (hit) return clean(hit, requested, null);
    const closest = compareVersions(wanted, oldest.minor) < 0 ? oldest : newest;
    return clean(
      closest,
      requested,
      `shiny ${pin.version} is outside the bundled versions (${range}); running ${closest.exact}`,
    );
  }

  const hit = bundled.find((b) =>
    spec.clauses.every((c) => satisfies(b.exact, c)),
  );
  if (hit) return clean(hit, requested, null);

  // Nothing fits. Below the window (an upper bound under the oldest) takes the
  // oldest; everything else takes the newest.
  const belowWindow = spec.clauses.some(
    (c) =>
      (c.op === "<" || c.op === "<=") &&
      compareVersions(oldest.exact, c.version) >= 0,
  );
  const closest = belowWindow ? oldest : newest;
  return clean(
    closest,
    requested,
    `no bundled shiny version satisfies "${spec.line}" (bundled: ${range}); running ${closest.exact}`,
  );
}

/**
 * The terminal line for a version the engine did not deliver, or null.
 * Compares what the app asked for against what the engine really loaded.
 */
export function shinyVersionMessage(
  resolved: ShinyVersionResolution,
  actual: string,
): string | null {
  if (resolved.requested !== null && resolved.requested !== actual) {
    return `requested shiny ${resolved.requested}, running ${actual}`;
  }
  if (resolved.exact !== actual) {
    return `requested shiny ${resolved.exact}, running ${actual}`;
  }
  return null;
}
