import { isBinary } from "./utils";
import { FileContent } from "./Components/filecontent";

// Maximum size of all files together in the app.
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
// Don't load files or directories whose names match these patterns.
const IGNORE_PATTERNS = [/^\./, /^_/];

function matches_ignore_pattern(s: string): boolean {
  for (const p of IGNORE_PATTERNS) {
    if (p.test(s)) return true;
  }
  return false;
}

export async function loadDirectoryRecursive(
  dirHandle: FileSystemDirectoryHandle,
  dirPrefix = "",
  maxBytes = MAX_FILE_SIZE
): Promise<FileContent[]> {
  let totalBytes = 0;
  const files: FileContent[] = [];

  for await (const fileHandle of dirHandle.values()) {
    let filePath = fileHandle.name;
    if (matches_ignore_pattern(filePath)) continue;

    if (dirPrefix !== "") {
      filePath = dirPrefix + "/" + filePath;
    }

    if (fileHandle.kind === "file") {
      const fileData = await fileHandle.getFile();
      totalBytes += fileData.size;
      if (totalBytes > maxBytes) {
        throw new Error(
          `Total data in directory exceeds max size of ${maxBytes} bytes.`
        );
      }

      const content = await fileData.arrayBuffer();
      const type: "text" | "binary" = isBinary(content) ? "binary" : "text";

      files.push({
        name: filePath,
        content:
          type === "text"
            ? new TextDecoder().decode(content)
            : window.btoa(String.fromCharCode(...new Uint8Array(content))),
        type: type,
      });
    } else if (fileHandle.kind === "directory") {
      const subdirFiles = await loadDirectoryRecursive(fileHandle, filePath);
      files.push(...subdirFiles);
    }
  }

  return files;
}
