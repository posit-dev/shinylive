export function asCssLengthUnit(value?: number | string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value !== "number") {
    return undefined;
  }

  return `${value}px`;
}
