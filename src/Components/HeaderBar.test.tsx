import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HeaderBar from "./HeaderBar";

const picker = {
  running: "1.6.4",
  options: [
    { exact: "1.8.0", latest: true },
    { exact: "1.7.0", latest: false },
    { exact: "1.6.4", latest: false },
  ],
  disabled: false,
  onSelect: () => {},
};

describe("HeaderBar shiny version picker", () => {
  test("absent without the prop", () => {
    const html = renderToStaticMarkup(
      <HeaderBar headerBarCallbacks={{}} appEngine="python" />,
    );
    expect(html).not.toContain('aria-label="Shiny version"');
  });

  test("lists the options, marks the newest as latest, and selects the running one", () => {
    const html = renderToStaticMarkup(
      <HeaderBar
        headerBarCallbacks={{}}
        appEngine="python"
        shinyVersionPicker={picker}
      />,
    );
    expect(html).toContain('aria-label="Shiny version"');
    expect(html).toContain('<option value="1.8.0">1.8.0 (latest)</option>');
    expect(html).toMatch(
      /<option (?=[^>]*selected="")(?=[^>]*value="1\.6\.4")[^>]*>1\.6\.4<\/option>/,
    );
    expect(html).not.toContain("latest-badge");
  });

  test("shows the latest badge when running the newest", () => {
    const html = renderToStaticMarkup(
      <HeaderBar
        headerBarCallbacks={{}}
        appEngine="python"
        shinyVersionPicker={{ ...picker, running: "1.8.0" }}
      />,
    );
    expect(html).toContain('class="latest-badge"');
  });

  test("adds the running version as an option when it is not bundled", () => {
    const html = renderToStaticMarkup(
      <HeaderBar
        headerBarCallbacks={{}}
        appEngine="python"
        shinyVersionPicker={{ ...picker, running: "1.9.0" }}
      />,
    );
    expect(html).toMatch(
      /<option (?=[^>]*selected="")(?=[^>]*value="1\.9\.0")[^>]*>1\.9\.0<\/option>/,
    );
  });

  test("is disabled while the engine starts", () => {
    const html = renderToStaticMarkup(
      <HeaderBar
        headerBarCallbacks={{}}
        appEngine="python"
        shinyVersionPicker={{ ...picker, disabled: true }}
      />,
    );
    expect(html).toMatch(/<select[^>]*disabled=""/);
  });
});
