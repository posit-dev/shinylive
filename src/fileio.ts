import {
  arrayBufferToBinaryString,
  binaryStringtoUint8Array,
  isBinary,
} from "./utils";
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

      const contentBuffer = await fileData.arrayBuffer();
      let type: "text" | "binary";
      let contentString: string;
      if (isBinary(contentBuffer)) {
        type = "binary";
        contentString = window.btoa(arrayBufferToBinaryString(contentBuffer));
      } else {
        type = "text";
        contentString = new TextDecoder().decode(contentBuffer);
      }

      files.push({
        name: filePath,
        content: contentString,
        type: type,
      });
    } else if (fileHandle.kind === "directory") {
      const subdirFiles = await loadDirectoryRecursive(fileHandle, filePath);
      files.push(...subdirFiles);
    }
  }

  return files;
}

export async function saveFileContentsToDirectory(
  files: FileContent[],
  dirHandle: FileSystemDirectoryHandle
): Promise<void> {
  for (const file of files) {
    const filePathParts = file.name.split("/");
    const dir = await ensureDirPathExists(
      filePathParts.slice(0, -1),
      dirHandle
    );
    await saveFileContentToFile(
      filePathParts.slice(-1)[0],
      file.content,
      file.type,
      dir
    );
  }
}

// If dirname is ["x"], then make sure there exists subdir of dirHandle named
// "x", creating it if necessary.This can recurse: if dirname is ["x", "y",
// "z"], then create the subdirs "x", "x/y", and "x/y/z". This returns the
// resulting dirHandle. If dirname is [], then just return dirHandle.
async function ensureDirPathExists(
  dirParts: string[],
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle> {
  if (dirParts.length === 0) {
    return dirHandle;
  }

  const subdir = await dirHandle.getDirectoryHandle(dirParts[0], {
    create: true,
  });

  return ensureDirPathExists(dirParts.slice(1), subdir);
}

async function saveFileContentToFile(
  filename: string,
  content: string,
  type: "text" | "binary",
  dirHandle: FileSystemDirectoryHandle
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(filename, {
    create: true,
  });
  const fileStream = await fileHandle.createWritable();
  if (type === "binary") {
    const binContent = binaryStringtoUint8Array(atob(content));
    await fileStream.write(binContent);
  } else {
    await fileStream.write(content);
  }
  await fileStream.close();
}
