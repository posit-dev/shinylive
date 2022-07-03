/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { splitDocString } from "./docstrings";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { MarkupContent } from "vscode-languageserver-types";

export const enum DocSections {
  Summary = 1 << 0,
  Example = 1 << 1,
  Remainder = 1 << 2,
  All = Summary | Example | Remainder,
}

export const renderDocumentation = (
  documentation: MarkupContent | string | undefined,
  parts: DocSections = DocSections.All
): HTMLElement => {
  if (!documentation) {
    documentation = "No documentation";
  }
  const div = document.createElement("div");
  div.className = "docstring";
  if (MarkupContent.is(documentation) && documentation.kind === "markdown") {
    try {
      div.innerHTML = renderMarkdown(documentation.value, parts).__html;
      return div;
    } catch (e) {
      // Fall through to simple text below.
    }
  }
  let fallbackContent = MarkupContent.is(documentation)
    ? documentation.value
    : documentation;
  fallbackContent = subsetMarkdown(fallbackContent, parts);
  const p = div.appendChild(document.createElement("p"));
  p.appendChild(new Text(fallbackContent));
  return div;
};

export interface SanitisedHtml {
  __html: string;
}

const fixupMarkdown = (input: string): string => {
  // Pyright's reST -> markdown conversion is imperfect.
  // Make some fixes.
  // Messy because it's after escaping. Fragile because it's regex.
  // Let's see if we can upstream or align the docs with supported syntax.
  return input
    .replace(/^\\\n/, "")
    .replace(/`([\w² \n]+?) ?<(.*?)>`\\_/gs, "[$1]($2)")
    .replace(/\\\*args/, "*args")
    .replace(/\\\*kwargs/, "*kwargs")
    .replace(/\\\*\\\*/g, "**")
    .replace(/:param ([^:]+):/g, "`$1`: ")
    .replace(/:return:/g, "**returns**: ");
};

// Workaround to open links in a new tab.
DOMPurify.addHook("afterSanitizeAttributes", function (node) {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener");
  }
});

export const renderMarkdown = (
  markdown: string,
  parts: DocSections = DocSections.All
): SanitisedHtml => {
  const html = DOMPurify.sanitize(
    marked.parse(fixupMarkdown(subsetMarkdown(markdown, parts)), { gfm: true })
  );
  return {
    __html: html,
  };
};

export const subsetMarkdown = (
  markdown: string,
  parts: DocSections
): string => {
  const split = splitDocString(markdown);
  const sections = [];
  if (parts & DocSections.Summary && split.summary) {
    sections.push(split.summary);
  }
  if (parts & DocSections.Example && split.example) {
    sections.push("`" + split.example + "`");
  }
  if (parts & DocSections.Remainder && split.remainder) {
    sections.push(split.remainder);
  }
  return sections.join("\n\n");
};

export const wrapWithDocumentationButton = (
  intl: IntlShape,
  child: Element,
  id: string
): Element => {
  const docsAndActions = document.createElement("div");
  docsAndActions.style.display = "flex";
  docsAndActions.style.height = "100%";
  docsAndActions.style.flexDirection = "column";
  docsAndActions.style.justifyContent = "space-between";
  docsAndActions.appendChild(child);

  const anchor = docsAndActions.appendChild(document.createElement("a"));
  anchor.href = "";
  anchor.style.fontSize = "var(--chakra-fontSizes-sm)";
  anchor.style.color = "var(--chakra-colors-brand-600)";
  anchor.textContent = intl.formatMessage({ id: "help" });
  anchor.style.display = "block";
  anchor.style.margin = "0";
  anchor.style.marginRight = "-0.5rem";
  anchor.style.padding = "0.5rem";
  anchor.style.alignSelf = "flex-end";
  anchor.onclick = (e) => {
    e.preventDefault();
    document.dispatchEvent(
      new CustomEvent("cm/openDocs", {
        detail: {
          id,
        },
      })
    );
  };
  return docsAndActions;
};
