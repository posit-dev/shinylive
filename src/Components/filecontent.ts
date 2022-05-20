// Shape of file content from user input (i.e. examples.json, data structure
// passed to App.runApp)
export type FileContentInput = {
  name: string;
  content: string;
  type?: "text" | "binary";
};

// Completed data structure (with no missing fields) for internal use.
export type FileContent = Required<FileContentInput>;

export function completeFileContent(x: FileContentInput): FileContent {
  return {
    ...x,
    type: x.type || "text",
  };
}

export function completeFileContents(x: FileContentInput[]): FileContent[] {
  return x.map(completeFileContent);
}
