// LZString in a Web Worker

import LZString from "lz-string";

self.onmessage = function (e: MessageEvent): void {
  const msg = e.data as RequestMessage;
  const messagePort: ResponseMesssagePort = e.ports[0];

  let result: string;

  if (msg.type === "encode") {
    result = LZString.compressToEncodedURIComponent(msg.value);
  } else if (msg.type === "decode") {
    result = LZString.decompressFromEncodedURIComponent(msg.value);
  } else {
    throw new Error(`Unknown request message type: ${(msg as any).type}`);
  }

  messagePort.postMessage({ value: result });
};

interface ResponseMesssagePort extends Omit<MessagePort, "postMessage"> {
  postMessage(msg: ResponseMessage): void;
}

export interface RequestMessageEncode {
  type: "encode";
  value: string;
}

export interface RequestMessageDecode {
  type: "decode";
  value: string;
}

export type RequestMessage = RequestMessageEncode | RequestMessageDecode;

export interface ResponseMessage {
  value: string;
}
