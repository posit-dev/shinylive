/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LanguageServerClient } from "../../../language-server/client";

const useLast = <T>(values: readonly T[]) => values[values.length - 1] ?? null;
// Used internally.
export const uriFacet = Facet.define<string | null, string | null>({
  combine: useLast,
});
// Used internally.
export const clientFacet = Facet.define<
  LanguageServerClient | null,
  LanguageServerClient | null
>({ combine: useLast });

export abstract class BaseLanguageServerView {
  constructor(protected view: EditorView) {}

  protected get client(): LanguageServerClient {
    const client = this.view.state.facet(clientFacet);
    if (!client) {
      throw new Error("client facet should be supplied");
    }
    return client;
  }

  protected get uri(): string {
    const uri = this.view.state.facet(uriFacet);
    if (!uri) {
      throw new Error("uri facet should be supplied");
    }
    return uri;
  }
}
