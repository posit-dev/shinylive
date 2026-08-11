export function asCssLengthUnit(value?: number | string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  // Defensive only: the declared parameter type rules this out, so it is
  // reachable only from untyped callers.
  /* v8 ignore next 3 */
  if (typeof value !== "number") {
    return undefined;
  }

  return `${value}px`;
}

export function minCssLengthUnit(
  x?: number | string,
  y?: number | string,
  ignoreAuto: boolean = true,
): string | undefined {
  x = asCssLengthUnit(x);
  y = asCssLengthUnit(y);

  if (ignoreAuto) {
    x = x === "auto" ? undefined : x;
    y = y === "auto" ? undefined : y;
  }

  if (x === undefined && y === undefined) {
    return undefined;
  }

  if (x && !y) {
    return x;
  }

  if (!x && y) {
    return y;
  }

  return `min(${x}, ${y})`;
}
