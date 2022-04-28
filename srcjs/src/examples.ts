import { FileContent } from "./Components/types";

export type ExampleItem = {
  title: string;
  about?: string;
  files: FileContent[];
};

export type ExampleCategory = {
  category: string;
  apps: ExampleItem[];
};

export type ExamplePosition = {
  categoryIndex: number;
  index: number;
};

let exampleCategories: ExampleCategory[] | null = null;

export async function getExampleCategories(): Promise<ExampleCategory[]> {
  if (exampleCategories) {
    return exampleCategories;
  }

  const response = await fetch("../shinylive/examples.json");
  exampleCategories = (await response.json()) as ExampleCategory[];
  return exampleCategories;
}

export function findExampleByTitle(
  title: string,
  exampleCategories: ExampleCategory[]
): ExamplePosition | null {
  if (title === "") return null;

  // Convert everything to lowercase to make matching easier when typing by hand
  title = title.toLowerCase();
  for (
    let categoryIndex = 0;
    categoryIndex < exampleCategories.length;
    categoryIndex++
  ) {
    const examples = exampleCategories[categoryIndex].apps;
    for (let index = 0; index < examples.length; index++) {
      if (sanitizeTitleForUrl(examples[index].title) === title) {
        return { categoryIndex, index };
      }
    }
  }

  // Failed to find example
  return null;
}

export function sanitizeTitleForUrl(title: string) {
  return title
    .toLowerCase()
    .replace(/\s/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
