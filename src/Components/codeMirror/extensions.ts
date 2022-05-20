import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/closebrackets";
import { defaultKeymap } from "@codemirror/commands";
import { commentKeymap } from "@codemirror/comment";
import { foldKeymap } from "@codemirror/fold";
import { highlightActiveLineGutter, lineNumbers } from "@codemirror/gutter";
import { defaultHighlightStyle } from "@codemirror/highlight";
import { history, historyKeymap } from "@codemirror/history";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { indentOnInput, indentUnit } from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import { r } from "@codemirror/legacy-modes/mode/r";
import { lintKeymap } from "@codemirror/lint";
import { bracketMatching } from "@codemirror/matchbrackets";
import { rectangularSelection } from "@codemirror/rectangular-selection";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/stream-parser";
import {
  drawSelection,
  // highlightActiveLine,
  dropCursor,
  highlightSpecialChars,
  keymap,
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
    defaultHighlightStyle.fallback,
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
      ...commentKeymap,
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
