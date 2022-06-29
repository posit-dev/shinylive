/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */

export const removeFullyQualifiedName = (fn: string): string => {
  const bracket = fn.indexOf("(");
  const before = fn.substring(0, bracket);
  const remainder = fn.substring(bracket);

  const parts = before.split(".");
  const name = parts[parts.length - 1];
  return name + remainder;
};

export const nameFromSignature = (fn: string): string => {
  const bracket = fn.indexOf("(");
  const before = fn.substring(0, bracket);
  return before;
};
