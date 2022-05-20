import React from "react";
import "babel-polyfill";
// Gets stuff into the "dom" (jsdom) and allows you to reach in easily
import { render, screen, waitFor, within } from "@testing-library/react";
// Used for simulating user events easily
import userEvent from "@testing-library/user-event";

import Editor from "./Editor";
import clearThenType from "../../testing-helpers/clearThenType";

import { FileContent } from "./filecontent";

const initialFiles: FileContent[] = [
  {
    name: "app.py",
    content: "#Here's my app",
  },
  {
    name: "utils.py",
    content: "#Here's some utilities",
  },
];

describe("File manipulation/Tabs", () => {
  test("Can add a new file using the tabs interface", () => {
    const filesHaveChangedMock = jest.fn();
    render(
      <Editor
        currentFilesFromApp={initialFiles}
        setFilesHaveChanged={filesHaveChangedMock}
        terminalMethods={{ ready: false }}
      />
    );

    expect(filesHaveChangedMock).toHaveBeenLastCalledWith(false);

    // Click the new file button
    userEvent.click(screen.getByText("+"));

    expect(filesHaveChangedMock).toHaveBeenLastCalledWith(true);
    const nameInput = screen.getByLabelText(/name current file/i);

    clearThenType(nameInput, "newFile.py");
    userEvent.keyboard("{Enter}");
  });

  test("No close button present if only a single file exists", () => {
    const singleFile: FileContent[] = [{ ...initialFiles[0] }];

    render(
      <Editor
        currentFilesFromApp={singleFile}
        setFilesHaveChanged={(x) => {}}
        terminalMethods={{ ready: false }}
      />
    );

    // With just one file the close button is not there
    expect(screen.queryAllByLabelText(/delete file/i)).toHaveLength(0);

    // Open a new file tab...
    userEvent.click(screen.getByText("+"));

    // And now the close button should exist on both tabs
    expect(screen.queryAllByLabelText(/delete file/i)).toHaveLength(2);
  });

  test("Pressing delete button on tab will ask if you want to delete file", () => {
    window.confirm = jest.fn();

    render(
      <Editor
        currentFilesFromApp={initialFiles}
        setFilesHaveChanged={(x) => {}}
        terminalMethods={{ ready: false }}
      />
    );

    // Click the delete button
    const fileToDelete = initialFiles[1].name;
    const secondFileTab = screen.getByText(fileToDelete)
      .parentNode as HTMLButtonElement;
    userEvent.click(within(secondFileTab).getByLabelText(/delete file/i));

    // We should get a confirm dialog asking if this is really what we wanted
    expect(window.confirm).toHaveBeenLastCalledWith(`Delete ${fileToDelete}?`);
  });

  // Wont let you rename a file to the same as any existing file
});

// describe("Keyboard behavior for code running", () => {
//   test("Command+Enter runs selected line", async () => {
//     const runCodeMock = jest.fn();
//     const runCodeInTerminalMock = jest.fn();
//     const runAppMock = jest.fn();
//     const stopAppMock = jest.fn();
//     const tabCompleteMock = jest.fn();

//     render(
//       <Editor
//         editorMode="shiny"
//         currentFilesFromApp={initialFiles}
//         setFilesHaveChanged={(x) => {}}
//         pyCallbacks={{
//           ready: true,
//           runCode: runCodeMock,
//           // Run code, and echo the code in the terminal.
//           runCodeInTerminal: runCodeInTerminalMock,
//           runApp: runAppMock,
//           stopApp: stopAppMock,
//           tabComplete: tabCompleteMock,
//         }}
//       />
//     );

//     expect(document.querySelector("div.monaco-editor")).toBeFalsy();
//     // wait for appearance inside an assertion
//     await waitFor(
//       () => {
//         expect(document.querySelector("div.monaco-editor")).toBeTruthy();
//         // expect(screen.getByRole("code")).toBeTruthy();
//       },
//       { timeout: 2000 }
//     );

//     // screen.debug();
//   });
// });
