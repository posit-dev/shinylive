/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import DOMPurify from "dompurify";
import { marked } from "marked";
import { MarkupContent } from "vscode-languageserver-types";

export const renderDocumentation = (
  documentation: MarkupContent | string | undefined
): HTMLElement => {
  if (!documentation) {
    documentation = "No documentation";
  }
  const div = document.createElement("div");
  div.className = "docstring";
  if (MarkupContent.is(documentation) && documentation.kind === "markdown") {
    try {
      div.innerHTML = renderMarkdown(documentation.value).__html;
      return div;
    } catch (e) {
      // Fall through to simple text below.
    }
  }
  const fallbackContent = MarkupContent.is(documentation)
    ? documentation.value
    : documentation;

  const p = div.appendChild(document.createElement("p"));
  p.appendChild(new Text(fallbackContent));
  return div;
};

export interface SanitisedHtml {
  __html: string;
}

// Workaround to open links in a new tab.
DOMPurify.addHook("afterSanitizeAttributes", function (node) {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener");
  }
});

export const renderMarkdown = (markdown: string): SanitisedHtml => {
  const html = DOMPurify.sanitize(marked.parse(markdown, { gfm: true }));
  return {
    __html: html,
  };
};
