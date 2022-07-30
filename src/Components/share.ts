import { FCtoFCJSON, FileContent } from "./filecontent";
import LZString from "lz-string";

export const editorUrlPrefix = "https://shinylive.io/py/editor/#code=";
export const appUrlPrefix = "https://shinylive.io/py/app/#code=";

/**
 * Given a FileContent[] object, return a string that is a LZ-compressed JSON
 * representation of it.
 */
export function fileContentsToUrlString(
  fileContents: FileContent[],
  sort: boolean = true
): string {
  if (sort) {
    fileContents.sort((a, b) => a.name.localeCompare(b.name));
  }
  return LZString.compressToEncodedURIComponent(
    JSON.stringify(fileContents.map(FCtoFCJSON))
  );
}
