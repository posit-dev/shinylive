// This seems to be necessary so that the TS compiler doesn't complain about
// importing svg files.
declare module "*.svg" {
  import * as React from "react";

  export const ReactComponent: React.FunctionComponent<
    React.SVGProps<SVGSVGElement> & { title?: string }
  >;

  const src: string;
  export default src;
}

// This is so the TS compiler doesn't complain about importing text files.
declare module "*.txt" {
  const content: string;
  export default content;
}
