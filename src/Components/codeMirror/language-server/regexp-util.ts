/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Escape a regular expression.
 *
 * @param unescaped A string.
 * @returns A regular expression that matches the literal string.
 */
export const escapeRegExp = (unescaped: string) => {
  return unescaped.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
};
