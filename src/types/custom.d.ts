// This seems to be necessary so that the TS compiler doesn't complain about
// importing svg files.
declare module "*.svg" {
  import type * as React from "react";

  export const ReactComponent: React.FunctionComponent<
    React.SVGProps<SVGSVGElement> & { title?: string }
  >;

  const src: string;
  export default src;
}

// src/shinylive-inject-socket.ts, bundled to a string by scripts/build.ts.
declare module "virtual:shinylive-inject-socket" {
  const content: string;
  export default content;
}
