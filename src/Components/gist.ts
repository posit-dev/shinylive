// Shape of file content from user input (i.e. examples.json, data structure
// passed to App.runApp). If the type is "binary", then content is a
import { stringToUint8Array, uint8ArrayToString } from "../utils";
import { FileContent } from "./filecontent";

export type GistApiResponse = {
  url: string;
  id: string;
  files: {
    [filename: string]: GistFile;
  };
  public: boolean;
  created_at: string;
  updated_at: string;
  description: string;
  comments: 1;
};

type GistFile = {
  filename: string;
  type: string;
  language: string;
  raw_url: string;
  size: number;
  truncated: boolean;
  // content is base64-encoded, even for text files, because we make the
  // request with Accept: "application/vnd.github.v3.base64".
  content: string;
};

export async function fetchGist(id: string): Promise<GistApiResponse> {
  const response = await fetch("https://api.github.com/gists/" + id, {
    headers: {
      Accept: "application/vnd.github.v3.base64",
    },
  });
  const gistData = (await response.json()) as GistApiResponse;
  return gistData;
}

export async function gistApiResponseToFileContents(
  gist: GistApiResponse
): Promise<FileContent[]> {
  const result: FileContent[] = [];

  for (const filename in gist.files) {
    const gistFile = gist.files[filename];
    if (isTextGistFile(gistFile)) {
      let content: string;
      if (gistFile.truncated) {
        // Some Gist file entries are truncated. The API docs say it happens
        // when the files are over a megabyte. For these files, we need to fetch
        // the file directly, and we'll put the content in place.
        // https://docs.github.com/en/rest/gists/gists#truncation
        const reponse = await fetch(gistFile.raw_url);
        content = await reponse.text();
      } else {
        content = window.atob(gistFile.content);
      }
      result.push({
        name: gistFile.filename,
        type: "text",
        content: content,
      });
    } else {
      let content: Uint8Array;
      if (gistFile.truncated) {
        console.log("Fetching binary file from Gist API");
        const reponse = await fetch(gistFile.raw_url);
        const contentBlob = await reponse.blob();
        console.log(contentBlob);
        content = new Uint8Array(await contentBlob.arrayBuffer());
        console.log(content);
      } else {
        content = stringToUint8Array(window.atob(gistFile.content));
      }
      result.push({
        name: gistFile.filename,
        type: "binary",
        content: content,
      });
    }
  }

  return result;
}

// Heuristic to determine if a file is text or binary.
function isTextGistFile(gistFile: GistFile): boolean {
  if (
    gistFile.type.startsWith("text/") ||
    typeof gistFile.language === "string"
  ) {
    return true;
  }

  return false;
}
