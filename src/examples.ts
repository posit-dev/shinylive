import type { AppEngine } from "./Components/App";
import type { FileContent, FileContentJson } from "./Components/filecontent";
import { FCJSONtoFC } from "./Components/filecontent";

export type ExampleItemJson = {
  title: string;
  about?: string;
  files: FileContentJson[];
};

// For examples/index.json
export type ExampleCategoryIndexJson = {
  engine: string;
  examples: {
    category: string;
    apps: string[];
  }[];
};

// For examples.json
export type ExampleIndexJson = {
  engine: string;
  examples: ExampleCategoryJson[];
};

export type ExampleCategoryJson = {
  category: string;
  apps: ExampleItemJson[];
};

export type ExampleItem = {
  title: string;
  about: string | null;
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

export async function getExampleCategories(
  engine: AppEngine,
): Promise<ExampleCategory[]> {
  if (exampleCategories) {
    return exampleCategories;
  }

  const response = await fetch("../shinylive/examples.json");
  const exampleIndexJson = (await response.json()) as ExampleIndexJson[];

  const exampleCategoriesJson = exampleIndexJson.find(
    (value) => value.engine === engine,
  );

  if (!exampleCategoriesJson) {
    throw new Error(`No examples found for app engine ${engine}`);
  }

  exampleCategories = exampleCategoriesJson.examples.map(
    exampleCategoryJsonToExampleCategory,
  );

  return exampleCategories;
}

export function findExampleByTitle(
  title: string,
  exampleCategories: ExampleCategory[],
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
    .replace(/[\s/]/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function exampleCategoryJsonToExampleCategory(
  x: ExampleCategoryJson,
): ExampleCategory {
  return {
    category: x.category,
    apps: x.apps.map(exampleItemJsonToExampleItem),
  };
}

function exampleItemJsonToExampleItem(x: ExampleItemJson): ExampleItem {
  return {
    title: x.title,
    about: x.about || null,
    files: x.files.map(FCJSONtoFC),
  };
}
