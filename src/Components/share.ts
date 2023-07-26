import { FCtoFCJSON, FileContent } from "./filecontent";
import LZString from "lz-string";

const shinyHome = {
  py: "https://shiny.posit.co/py/",
  r: "https://shiny.posit.co/",
}

export const shortEngine = process.env.APP_ENGINE === "python" ? "py" : "r";
export const mainUrl = shinyHome[shortEngine];
export const editorUrlPrefix = `https://shinylive.io/${shortEngine}/editor/`;
export const appUrlPrefix = `https://shinylive.io/${shortEngine}/app/`;

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
