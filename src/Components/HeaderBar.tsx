import shinyLogo from "../assets/shiny-logo.svg";
import "./HeaderBar.css";
import * as React from "react";

export default function HeaderBar() {
  return (
    <div className="HeaderBar">
      <a href="https://shiny.rstudio.com/py/">
        <img className="shiny-logo" src={shinyLogo} alt="Shiny" />
        <span>for Python</span>
      </a>
    </div>
  );
}
