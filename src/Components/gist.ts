// Shape of file content from user input (i.e. examples.json, data structure
// passed to App.runApp). If the type is "binary", then content is a
import { isBinary, stringToUint8Array, uint8ArrayToString } from "../utils";
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

    let binary: boolean;
    let contentString: string = "";
    let contentArray: Uint8Array = new Uint8Array(0);

    // Some Gist file entries are truncated. The API docs say it happens
    // when the files are over a megabyte. For these files, we need to fetch
    // the file directly, and we'll put the content in place.
    // https://docs.github.com/en/rest/gists/gists#truncation
    if (gistFile.truncated) {
      const reponse = await fetch(gistFile.raw_url);
      const contentBlob = await reponse.blob();
      contentArray = new Uint8Array(await contentBlob.arrayBuffer());
      // The gist API includes the 'type' field, but they are not always
      // helpful. 'type' can be "text/plain" for some binary files like sqlite
      // .db files.
      binary = isBinary(contentArray);
      if (!binary) {
        contentString = uint8ArrayToString(contentArray);
      }
    } else {
      contentString = window.atob(gistFile.content);
      binary = isBinary(contentString);
      if (binary) {
        contentArray = stringToUint8Array(contentString);
      }
    }

    if (binary) {
      result.push({
        name: gistFile.filename,
        type: "binary",
        content: contentArray,
      });
    } else {
      result.push({
        name: gistFile.filename,
        type: "text",
        content: contentString,
      });
    }
  }

  return result;
}
