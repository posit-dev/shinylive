import { LanguageServerClient } from "./client";
import { pyright } from "./pyright";

let pyrightLSClient: LanguageServerClient | null = null;

export function ensurePyrightLanguageServerClient():
  | LanguageServerClient
  | undefined {
  if (pyrightLSClient) {
    return pyrightLSClient;
  }

  const locale = "en";
  pyrightLSClient = pyright(locale) || null;
  if (!pyrightLSClient) return;

  return pyrightLSClient;
}
