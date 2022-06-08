// prettier-plugin-organize-imports will remove the React import, but that
// raises an eslint error. So we'll disable the rule for this file.
//   'React' must be in scope when using JSX eslint(react/react-in-jsx-scope)
// organize-imports-ignore
import * as React from "react";
import "./LoadingAnimation.css";

export function LoadingAnimation() {
  return (
    <div className="loading-animation">
      <div className="hex"></div>
      <div className="hex"></div>
      <div className="hex"></div>
      <br />
      <div className="hex"></div>
      <div className="hex"></div>
      <div className="hex"></div>
      <div className="hex"></div>
      <br />
      <div className="hex"></div>
      <div className="hex"></div>
      <div className="spacer"></div>
      <div className="hex"></div>
      <div className="hex"></div>
      <br />
      <div className="hex"></div>
      <div className="hex"></div>
      <div className="hex"></div>
      <div className="hex"></div>
      <br />
      <div className="hex"></div>
      <div className="hex"></div>
      <div className="hex"></div>
    </div>
  );
}
