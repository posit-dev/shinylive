// Download buttons and links.
// Port of shiny/playwright/controller/_file.py

import type { Download } from "@playwright/test";
import type { ActionOptions, ShinyApp } from "./_base";
import { InputActionBase } from "./_input_buttons";

/** Shared behaviour of the two download controls. */
class DownloadBase extends InputActionBase {
  /** Expect the control's label. */
  async expectLabel(
    value: string | RegExp,
    options?: ActionOptions,
  ): Promise<void> {
    // Unlike an action button, a download control's label is its own text.
    await this.expect.toHaveText(value, options);
  }

  /**
   * Click the control and return the download it triggers.
   *
   * Nothing about a download is visible in the DOM, so this is the only way to
   * tell "the handler ran and produced a file" from "the link is there". The
   * download event fires on the page even though the click happens inside the
   * app's iframe.
   */
  async download(options?: ActionOptions): Promise<Download> {
    const [download] = await Promise.all([
      this.app.page.waitForEvent("download", { timeout: options?.timeout }),
      this.loc.click(options),
    ]);
    return download;
  }
}

/** Controller for `shiny.ui.download_button()` / `downloadButton()`. */
export class DownloadButton extends DownloadBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `#${id}.btn.shiny-download-link`);
  }
}

/** Controller for `shiny.ui.download_link()` / `downloadLink()`. */
export class DownloadLink extends DownloadBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `#${id}.shiny-download-link:not(.btn)`);
  }
}
