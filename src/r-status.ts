import type { RObject } from "webr";

/** One named character element of webR's serialisation of an R list.
 *
 * `RObject.toJs()` returns a tagged tree, not a plain object: an R list arrives
 * as `{ type, names, values }`, and each element is itself either a
 * `{ type, names, values }` node or an already-unwrapped scalar -- webr's
 * `WebRDataJsNode.values` is typed as holding either. So both levels are
 * handled here, and the result is a `string[]` because every R character vector
 * has a length.
 *
 * An absent or unreadable field gives `[]` rather than a guess, so a reply that
 * does not match this shape fails loudly at the caller instead of reading as
 * success.
 *
 * This lives in its own module rather than beside its caller in `Viewer.tsx` so
 * that the guards below are reachable from the jest suite. They are the ones a
 * webR upgrade would break: `Viewer.tsx` reads `status` through this function
 * too, so a shape change makes every field read as `[]`, `status` read as
 * `undefined`, and a *successful* app start report itself as a failure. The
 * pytest suite cannot cover that -- `.start_app` always returns a well-formed
 * list -- and `noUncheckedIndexedAccess` is off, so the type-checker does not
 * see it either.
 */
export function rCharacterField(
  js: Awaited<ReturnType<RObject["toJs"]>>,
  name: string,
): string[] {
  if (!("names" in js) || js.names === null || !("values" in js)) return [];
  const index = js.names.indexOf(name);
  if (index === -1) return [];
  const element: unknown = js.values[index];
  if (typeof element === "string") return [element];
  if (element === null || typeof element !== "object") return [];
  const values: unknown = (element as { values?: unknown }).values;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string");
}
