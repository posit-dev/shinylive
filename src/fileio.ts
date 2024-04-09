import type { FileContent } from "./Components/filecontent";
import { isBinary } from "./utils";

// Maximum size files to upload, in bytes.
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
// Maximum number of files to load from a directory. If we have anywhere near
// this many, it's probably a mistake.
const MAX_FILES = 20;
// Don't load files or directories whose names match these patterns.
const IGNORE_PATTERNS = [/^\./, /^_/];

export const FILE_SYSTEM_API_ERROR_MESSAGE =
  "Sorry, this browser does not support the File System Access API." +
  " This feature requires Chrome or Edge.";

function matches_ignore_pattern(s: string): boolean {
  for (const p of IGNORE_PATTERNS) {
    if (p.test(s)) return true;
  }
  return false;
}

export async function loadDirectoryRecursive(
  dirHandle: FileSystemDirectoryHandle,
  dirPrefix = "",
  maxBytes = MAX_FILE_SIZE,
  maxFiles = MAX_FILES,
): Promise<FileContent[]> {
  const files: FileContent[] = [];

  for await (const fileHandle of dirHandle.values()) {
    if (files.length > maxFiles) {
      throw new Error(
        `Too many files in directory ${dirHandle.name}; maximum is ${maxFiles}.`,
      );
    }

    let filePath = fileHandle.name;
    if (matches_ignore_pattern(filePath)) continue;

    if (dirPrefix !== "") {
      filePath = dirPrefix + "/" + filePath;
    }

    if (fileHandle.kind === "file") {
      const fileContent = await loadFileContent(fileHandle, maxBytes);
      // loadFile() uses the name of the file on disk, but it doesn't include
      // the leading path. We already have the path+filename, so we'll just use
      // that.
      fileContent.name = filePath;
      files.push(fileContent);
    } else if (fileHandle.kind === "directory") {
      const subdirFiles = await loadDirectoryRecursive(fileHandle, filePath);
      files.push(...subdirFiles);
    }
  }

  return files;
}

export async function loadFileContent(
  fileHandle: FileSystemFileHandle,
  maxBytes: number = MAX_FILE_SIZE,
): Promise<FileContent> {
  const fileData = await fileHandle.getFile();
  if (fileData.size > maxBytes) {
    throw new Error(`File exceeds max size of ${maxBytes} bytes.`);
  }

  const contentArray = new Uint8Array(await fileData.arrayBuffer());
  if (isBinary(contentArray)) {
    return {
      name: fileData.name,
      content: contentArray,
      type: "binary",
    };
  } else {
    const contentString = new TextDecoder().decode(contentArray);
    return {
      name: fileData.name,
      content: contentString,
      type: "text",
    };
  }
}

export function assertHasFileAccessApiSupport(): void {
  if (!window.showOpenFilePicker) {
    alert(FILE_SYSTEM_API_ERROR_MESSAGE);
    throw new Error(FILE_SYSTEM_API_ERROR_MESSAGE);
  }
}

export async function saveFileContentsToDirectory(
  files: FileContent[],
  dirHandle: FileSystemDirectoryHandle,
): Promise<void> {
  for (const file of files) {
    const filePathParts = file.name.split("/");
    const dir = await ensureDirPathExists(
      filePathParts.slice(0, -1),
      dirHandle,
    );

    await saveFileContentToFile(
      // Use the stuff from the `file` object, but use just the filename,
      // without directory.
      {
        ...file,
        name: filePathParts.slice(-1)[0],
      },
      dir,
    );
  }
}

// Tell the browser to download a file.
export async function downloadFile(
  filename: string,
  content: BlobPart,
  type = "text/plain",
): Promise<void> {
  const element = document.createElement("a");
  const file = new Blob([content], { type: type });
  element.href = URL.createObjectURL(file);
  element.download = filename;
  element.click();
}

// If dirname is ["x"], then make sure there exists subdir of dirHandle named
// "x", creating it if necessary.This can recurse: if dirname is ["x", "y",
// "z"], then create the subdirs "x", "x/y", and "x/y/z". This returns the
// resulting dirHandle. If dirname is [], then just return dirHandle.
async function ensureDirPathExists(
  dirParts: string[],
  dirHandle: FileSystemDirectoryHandle,
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
  file: FileContent,
  dirHandle: FileSystemDirectoryHandle,
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(file.name, {
    create: true,
  });
  const fileStream = await fileHandle.createWritable();
  if (file.type === "binary") {
    await fileStream.write(file.content);
  } else {
    await fileStream.write(file.content);
  }
  await fileStream.close();
}
