/**
 * This file is also used by the worker so should have no dependencies.
 */

export interface DocSectionsSplit {
  summary: string;
  example?: string;
  remainder?: string;
}

export const splitDocString = (markup: string): DocSectionsSplit => {
  // Workaround for https://github.com/microbit-foundation/python-editor-next/issues/501
  if (markup.startsWith("\\\n")) {
    markup = markup.substring(2);
  }
  const parts = markup.split(/\n{2,}/g);
  const summary = parts.shift()!;
  let example: string | undefined;
  if (parts[0]?.startsWith("Example: ")) {
    example = parts
      .shift()
      ?.replace(/^Example: /, "")
      .slice(1, -1);
  }
  const remainder = parts.length > 0 ? parts.join("\n\n") : undefined;
  return { summary, example, remainder };
};
