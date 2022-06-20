// Shape of file content from user input (i.e. examples.json, data structure
// passed to App.runApp). If the type is "binary", then content is a
import { stringToUint8Array, uint8ArrayToString } from "../utils";

// base64-encoded string representation of the data.
export type FileContentJson = {
  name: string;
  content: string;
  type?: "text" | "binary";
};

// Completed data structure for internal use. This also represents binary data
// as a Uint8Array.
export type FileContent =
  | {
      name: string;
      content: string;
      type: "text";
    }
  | {
      name: string;
      content: Uint8Array;
      type: "binary";
    };

// Convert FileContentJson to FileContent.
export function FCJSONtoFC(x: FileContentJson): FileContent {
  if (x.type === "binary") {
    return {
      name: x.name,
      content: stringToUint8Array(window.atob(x.content)),
      type: "binary",
    };
  } else {
    return {
      name: x.name,
      content: x.content,
      type: "text",
    };
  }
}

// Sometimes we don't know whether the input is a FileContent or a
// FileContentJson. This function will take either tpye and convert it to a
// FileContent.
export function FCorFCJSONtoFC(x: FileContent | FileContentJson): FileContent {
  if (x.type === "binary") {
    if (typeof x.content === "string") {
      return FCJSONtoFC(x as FileContentJson);
    } else {
      return x as FileContent;
    }
  } else {
    return {
      name: x.name,
      content: x.content,
      type: "text",
    };
  }
}

// Convert FileContent to FileContentJson.
export function FCtoFCJSON(x: FileContent): FileContentJson {
  if (x.type === "binary") {
    return {
      name: x.name,
      content: window.btoa(uint8ArrayToString(x.content)),
      type: "binary",
    };
  } else {
    return {
      name: x.name,
      content: x.content,
      // To save a bit of space, don't include type:"text".
    };
  }
}
