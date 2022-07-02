/**
 * (c) 2022, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import {
  createUri,
  LanguageServerClient,
} from "../../../language-server/client";
import { LSPClient } from "../../../language-server/lsp-client";
// import {
//   DocSections,
//   renderDocumentation,
//   wrapWithDocumentationButton,
// } from "./documentation";
// import { nameFromSignature, removeFullyQualifiedName } from "./names";
import { offsetToPosition } from "./positions";
import { escapeRegExp } from "./regexp-util";
import {
  autocompletion as cmAutocompletion,
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { insertBracket } from "@codemirror/autocomplete";
import { Extension, TransactionSpec } from "@codemirror/state";
import sortBy from "lodash.sortby";
import * as LSP from "vscode-languageserver-protocol";
import {
  CompletionItem,
  CompletionItemKind,
  CompletionResolveRequest,
  CompletionTriggerKind,
} from "vscode-languageserver-protocol";

// Used to find the true start of the completion. Doesn't need to exactly match
// any language's identifier definition.
const identifierLike = /[a-zA-Z0-9_\u{a1}-\u{10ffff}]+/u;

type AugmentedCompletion = Completion & { item: CompletionItem };

export function autocompletion(
  lspClient: LSPClient,
  filename: string
): Extension {
  const findCompletion = async (
    context: CompletionContext
  ): Promise<CompletionResult | null> => {
    const client = lspClient.client;
    const uri = createUri(filename);

    if (!client || !uri || !client.capabilities?.completionProvider) {
      return null;
    }

    let triggerKind: CompletionTriggerKind | undefined;
    let triggerCharacter: string | undefined;
    const before = context.matchBefore(identifierLike);
    if (context.explicit || before) {
      triggerKind = CompletionTriggerKind.Invoked;
    } else {
      const triggerCharactersRegExp = createTriggerCharactersRegExp(client);
      const match =
        triggerCharactersRegExp && context.matchBefore(triggerCharactersRegExp);
      if (match) {
        triggerKind = CompletionTriggerKind.TriggerCharacter;
        triggerCharacter = match.text;
      } else {
        return null;
      }
    }

    console.log("context: ", context);

    // const documentationResolver = createDocumentationResolver(client, intl);
    const lspCompletionList = await client.completionRequest({
      textDocument: {
        uri,
      },
      position: offsetToPosition(context.state.doc, context.pos),
      context: {
        triggerKind,
        triggerCharacter,
      },
    });

    console.log("results: ", lspCompletionList);
    let completionItems = lspCompletionList.items
      // For now we don't support these edits (they usually add imports).
      .filter((x) => !x.additionalTextEdits)
      .map(LSPCompletionItemToCMCompletion);

    completionItems = sortBy(completionItems, (item) => {
      // console.log(item.item.sortText);
      return item.item.sortText ?? item.label;
    });

    const result: CompletionResult = {
      from: before ? before.from : context.pos,
      // Could vary these based on isIncomplete? Needs investigation.
      // Very desirable to set most of the time to remove flicker.
      filter: false,
      options: completionItems,
    };
    console.log(result);
    return result;
  };

  return cmAutocompletion({
    override: [findCompletion],
  });
}

function LSPCompletionItemToCMCompletion(
  item: LSP.CompletionItem
): AugmentedCompletion {
  const completion: AugmentedCompletion = {
    // In practice we don't get textEdit fields back from Pyright so the label is used.
    label: item.label,
    apply: (view, completion, from, to) => {
      const insert = item.label;
      const transactions: TransactionSpec[] = [
        {
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
        },
      ];
      if (
        // funcParensDisabled is set to true by Pyright for e.g. a function completion in an import
        (completion.type === "function" && !item.data.funcParensDisabled) ||
        completion.type === "method"
      ) {
        const bracketTransaction = insertBracket(view.state, "(");
        if (bracketTransaction) {
          transactions.push(bracketTransaction);
        }
      }
      view.dispatch(...transactions);
    },
    type: item.kind ? mapCompletionKind[item.kind] : undefined,
    detail: item.detail,
    // info: documentationResolver,
    boost: boost(item),
    // Needed later for resolving.
    item,
  };

  return completion;
}

// const createDocumentationResolver =
//   (client: LanguageServerClient, intl: IntlShape) =>
//   async (completion: Completion): Promise<Node> => {
//     const resolved = await client.connection.sendRequest(
//       CompletionResolveRequest.type,
//       (completion as AugmentedCompletion).item
//     );
//     const node = renderDocumentation(
//       resolved.documentation,
//       DocSections.Summary | DocSections.Example
//     );
//     node.className += " docs-skip-signature";
//     const code = node.querySelector("code");
//     if (code) {
//       const id = nameFromSignature(code.innerText);
//       if (id) {
//         code.innerText = removeFullyQualifiedName(code.innerText);
//         return wrapWithDocumentationButton(intl, node, id);
//       }
//     }
//     return node;
//   };

const createTriggerCharactersRegExp = (
  client: LanguageServerClient
): RegExp | undefined => {
  const characters = client.capabilities?.completionProvider?.triggerCharacters;
  if (characters && characters.length > 0) {
    return new RegExp("[" + escapeRegExp(characters.join("")) + "]");
  }
  return undefined;
};

const mapCompletionKind = Object.fromEntries(
  Object.entries(CompletionItemKind).map(([key, value]) => [
    value,
    key.toLowerCase(),
  ])
) as Record<CompletionItemKind, string>;

const boost = (item: LSP.CompletionItem): number | undefined => {
  if (item.label.startsWith("__")) {
    return -99;
  }
  if (item.label.endsWith("=")) {
    // Counteract a single case mismatch penalty to allow
    // `Image` to rank over `image=` for "image" input.
    // This is vulnerable to changes in the ranking algorithm in
    // https://github.com/codemirror/autocomplete/blob/main/src/filter.ts
    return -200 - "image=".length;
  }
  return undefined;
};
