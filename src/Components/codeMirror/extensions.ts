import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldKeymap,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { r } from "@codemirror/legacy-modes/mode/r";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, Extension } from "@codemirror/state";
import {
  drawSelection,
  // highlightActiveLine,
  dropCursor,
  EditorView,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";

export function getExtensions(
  opts: { lineNumbers?: boolean } = { lineNumbers: true }
): Extension {
  const extensions = [
    // lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    // foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of("    "),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    // highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      indentWithTab,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
  ];

  if (opts.lineNumbers) {
    extensions.push(lineNumbers());
  }

  return extensions;
}

export function getBinaryFileExtensions(): Extension {
  return [EditorView.editable.of(false)];
}

const LANG_EXTENSIONS: Record<string, () => Extension> = {
  python: python,
  javascript: javascript,
  html: html,
  css: css,
  r: () => StreamLanguage.define(r),
};

export function getExtensionForFiletype(filetype: string | null): Extension {
  if (filetype === null) return [];
  if (!(filetype in LANG_EXTENSIONS)) return [];

  return LANG_EXTENSIONS[filetype]();
}
