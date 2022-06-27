import { LanguageServerClient } from "./client";
import { pyright } from "./pyright";
import React, { useEffect } from "react";
import * as LSP from "vscode-languageserver-protocol";

export const usePyrightLanguageServerClient = () => {
  useEffect(() => {
    console.log("usePyrightLanguageServerClient.useEffect");
    const locale = "en";
    const client = pyright(locale);

    client?.initialize().then(() => {
      client.on("diagnostics", diagnosticsListener);
      testSend(client);
    });
    return () => {
      client?.dispose();
    };
  }, []);
};

async function testSend(client: LanguageServerClient) {
  console.log("waiting 1s");
  new Promise((resolve) => setTimeout(resolve, 1000));
  console.log("sending");

  const text = "import sys\nprint(sys.path";

  const uri = "file:///src/abcd.py";
  const params: LSP.CreateFile = {
    uri,
    kind: "create",
  };
  client.connection.sendNotification("pyright/createFile", params);
  client.didOpenTextDocument({
    textDocument: {
      languageId: "python",
      text: text,
      uri,
    },
  });
}

const diagnosticsListener = (params: LSP.PublishDiagnosticsParams) => {
  console.log("LanguageServerView.diagnosticsListener");
  console.log(params);
};
