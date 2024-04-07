import {
  acceptCompletion,
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
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { r } from "@codemirror/legacy-modes/mode/r";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers as lineNumbersExtension,
  rectangularSelection,
} from "@codemirror/view";

export function getExtensions({
  indentSpaces = 4,
  lineNumbers = true,
}: { indentSpaces?: number; lineNumbers?: boolean } = {}): Extension {
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
    indentUnit.of(" ".repeat(indentSpaces)),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    // highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      autocompleteWithTab,
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

  if (lineNumbers) {
    extensions.push(lineNumbersExtension(), lintGutterWithCustomTheme());
  }

  return extensions;
}

const autocompleteWithTab = { key: "Tab", run: acceptCompletion };

export function getBinaryFileExtensions(): Extension {
  return [EditorView.editable.of(false)];
}

/**
 * A minimal set of extensions. The purpose of this is when switching sets of
 * extensions (when a file type is changed from python to css, for example), it
 * switches to this set of extensions, then to the final set of extensions.
 *
 * In the transition, there are the start, middle, and end extension sets. If
 * they all have history(), then undo history is preserved across all the
 * states. If the middle set doesn't have history(), then undo history is lost.
 *
 * The reason that a middle set is needed is because the start and end sets have
 * lintGutter(), but when changing file types it's necessary to drop the linter
 * diagnostics. In order to do this, the middle set has no lintGutter().
 *
 * Also note that the calls StateEffect.reconfigure.of() must be applied in two
 * separate transaction updates (or dispatches, instead of putting them in an
 * array of transactions and passing the array to a single update() or
 * dispatch().
 */
export function getMinimalExtensions(): Extension {
  return [history()];
}

const LANG_EXTENSIONS: Record<string, () => Extension> = {
  python: python,
  javascript: javascript,
  html: html,
  css: css,
  r: () => StreamLanguage.define(r),
};

export function getLanguageExtension(filetype: string | null): Extension {
  if (filetype === null) return [];
  if (!(filetype in LANG_EXTENSIONS)) return [];

  return LANG_EXTENSIONS[filetype]();
}

function lintGutterWithCustomTheme() {
  // lintGutter() returns an Extension[], but it's marked as Extension.
  let extensions = lintGutter() as Extension[];

  // Remove the original theme. Filter by iterating over the Extensions and
  // checking each one if it is of the same class as our custom theme. This may
  // be fragile if, for example, lintGutter() changes in the future to nest
  // Extensions differently.
  extensions = extensions.filter(
    // Compare .constructor to see if the classes match.
    (ext) => ext.constructor !== lintGutterCustomTheme.constructor,
  );
  extensions.push(lintGutterCustomTheme);

  return extensions;
}

const lintGutterCustomTheme = EditorView.baseTheme({
  ".cm-gutter-lint": {
    width: "0.3em",
    "& .cm-gutterElement": {
      padding: "0 0 0 0.1em",
    },
  },
  ".cm-lint-marker": {
    opacity: "0.6",
    height: "100%",
  },
  ".cm-lint-marker-info": {
    "background-color": "#999",
  },
  ".cm-lint-marker-warning": {
    "background-color": "orange",
  },
  ".cm-lint-marker-error": {
    "background-color": "#d11",
  },
});
