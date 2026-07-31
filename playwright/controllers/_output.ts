// Text, plot, table, data frame and UI outputs.
// Port of shiny/playwright/controller/_output.py

import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { ActionOptions, PatternOrStr, ShinyApp } from "./_base";
import {
  UiBase,
  UiWithContainer,
  expectAttributeToHaveValue,
  expectStyleToHaveValue,
} from "./_base";

/** Shared behaviour of the text-shaped outputs. */
class OutputTextValue extends UiBase {
  /** Expect the rendered text. */
  async expectValue(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.loc).toHaveText(value, options);
  }

  /** Expect the tag the output is rendered into. */
  async expectContainerTag(
    value: "span" | "div" | "pre",
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.loc.locator(`xpath=self::${value}`)).toHaveCount(
      1,
      options,
    );
  }
}

/** Controller for `shiny.ui.output_text()` / `textOutput()`. */
export class OutputText extends OutputTextValue {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `#${id}.shiny-text-output`);
  }

  /** Expect the output to be rendered inline (a `span`), or not. */
  async expectInline(value: boolean, options?: ActionOptions): Promise<void> {
    await this.expectContainerTag(value ? "span" : "div", options);
  }
}

/** Controller for `shiny.ui.output_code()`. */
export class OutputCode extends OutputTextValue {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `pre#${id}.shiny-text-output`);
  }
}

/**
 * Controller for `shiny.ui.output_text_verbatim()` / `verbatimTextOutput()`.
 */
export class OutputTextVerbatim extends OutputTextValue {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `pre#${id}.shiny-text-output`);
  }

  /** Expect the output to show its placeholder when it has no value. */
  async expectHasPlaceholder(
    value: boolean,
    options?: ActionOptions,
  ): Promise<void> {
    if (value) {
      await expect(this.loc).not.toHaveClass(/noplaceholder/, options);
    } else {
      await expect(this.loc).toHaveClass(/noplaceholder/, options);
    }
  }
}

class OutputImageBase extends UiBase {
  /** Playwright `Locator` of the rendered `<img>`. */
  readonly locImg: Locator;

  constructor(app: ShinyApp, id: string, locClass: string) {
    super(app, id, `#${id}${locClass}`);
    this.locImg = this.loc.locator("img");
  }

  /** Expect the `src` of the rendered image. */
  async expectImgSrc(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.locImg, "src", value, options);
  }

  /** Expect the `alt` text of the rendered image. */
  async expectImgAlt(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.locImg, "alt", value, options);
  }

  /** Expect the height the app asked for. */
  async expectHeight(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectStyleToHaveValue(this.loc, "height", value, options);
  }

  /** Expect the width the app asked for. */
  async expectWidth(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectStyleToHaveValue(this.loc, "width", value, options);
  }
}

/** Controller for `shiny.ui.output_image()` / `imageOutput()`. */
export class OutputImage extends OutputImageBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, ".shiny-image-output");
  }
}

/** Controller for `shiny.ui.output_plot()` / `plotOutput()`. */
export class OutputPlot extends OutputImageBase {
  /**
   * py-shiny keys on `.shiny-image-output.shiny-plot-output`, which only holds
   * for Shiny for Python. R's `plotOutput()` emits `.shiny-plot-output` alone.
   */
  constructor(app: ShinyApp, id: string) {
    super(app, id, ".shiny-plot-output");
  }

  /**
   * Expect that a plot was actually drawn.
   *
   * Both engines render matplotlib and base R plots to an inline base64 PNG, so
   * a visible `<img>` with a data URL means the plot round-tripped through the
   * app rather than the element merely existing.
   */
  async expectRendered(options?: ActionOptions): Promise<void> {
    await expect(this.locImg).toBeVisible(options);
    await this.expectImgSrc(/^data:image\/[a-z+]+;base64,/, options);
  }
}

/** Controller for `shiny.ui.output_ui()` / `uiOutput()`. */
export class OutputUi extends UiBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `#${id}`);
  }

  /** Expect the output to be empty, or not. */
  async expectEmpty(value: boolean, options?: ActionOptions): Promise<void> {
    if (value) {
      await expect(this.loc).toBeEmpty(options);
    } else {
      await expect(this.loc).not.toBeEmpty(options);
    }
  }

  /** Expect the rendered text. */
  async expectValue(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.loc).toHaveText(value, options);
  }
}

/** Controller for `shiny.ui.output_table()` / `tableOutput()`. */
export class OutputTable extends UiBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `#${id}`);
  }

  /** Expect the text of one cell. `row` and `col` are 1-based. */
  async expectCell(
    value: PatternOrStr,
    position: { row: number; col: number },
    options?: ActionOptions,
  ): Promise<void> {
    const { row, col } = position;
    await expect(
      this.loc.locator(
        `xpath=./table/tbody/tr[${row}]/td[${col}] | ./table/tbody/tr[${row}]/th[${col}]`,
      ),
    ).toHaveText(value, options);
  }

  /** Expect the column headers. Pass `null` for a table with no header. */
  async expectColumnLabels(
    value: string[] | null,
    options?: ActionOptions,
  ): Promise<void> {
    const labels = this.loc.locator("xpath=./table/thead/tr/th");
    if (value === null || value.length === 0) {
      await expect(labels).toHaveCount(0, options);
      return;
    }
    await expect(labels).toHaveText(value, options);
  }

  /** Expect the text of every cell in a 1-based column. */
  async expectColumnText(
    col: number,
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    await expect(
      this.loc.locator(`xpath=./table/tbody/tr/td[${col}]`),
    ).toHaveText(value, options);
  }

  /** Expect the number of columns. */
  async expectNcol(value: number, options?: ActionOptions): Promise<void> {
    await expect(
      this.loc.locator("xpath=./table/thead/tr[1]/td | ./table/thead/tr[1]/th"),
    ).toHaveCount(value, options);
  }

  /** Expect the number of body rows. */
  async expectNrow(value: number, options?: ActionOptions): Promise<void> {
    await expect(this.loc.locator("xpath=./table/tbody/tr")).toHaveCount(
      value,
      options,
    );
  }
}

/** Controller for `shiny.ui.output_data_frame()`. */
export class OutputDataFrame extends UiWithContainer {
  /** Playwright `Locator` of the `<table>` inside the grid. */
  readonly locTable: Locator;
  /** Playwright `Locator` of the table head. */
  readonly locHead: Locator;
  /** Playwright `Locator` of the table body. */
  readonly locBody: Locator;
  /** Playwright `Locator` of the column headers. */
  readonly locColumnLabel: Locator;

  constructor(app: ShinyApp, id: string) {
    super(app, id, "> div > div.shiny-data-grid", `#${id}.html-fill-item`);
    this.locTable = this.loc.locator("> table");
    this.locHead = this.locTable.locator("> thead");
    this.locBody = this.locTable.locator("> tbody");
    this.locColumnLabel = this.locHead.locator(
      "> tr:not(.filters) > th:not(.table-corner)",
    );
  }

  /** Locator for a single cell. `row` and `col` are 0-based. */
  cellLocator(row: number, col: number): Locator {
    return this.locBody
      .locator(`> tr[data-index="${row}"]`)
      .locator("> td, > th")
      .nth(col);
  }

  /** Expect the text of one cell. `row` and `col` are 0-based. */
  async expectCell(
    value: PatternOrStr,
    position: { row: number; col: number },
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.cellLocator(position.row, position.col)).toHaveText(
      value,
      options,
    );
  }

  /** Expect the column headers. */
  async expectColumnLabels(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locColumnLabel).toHaveText(value, options);
  }

  /** Expect the number of columns. */
  async expectNcol(value: number, options?: ActionOptions): Promise<void> {
    await expect(this.locColumnLabel).toHaveCount(value, options);
  }

  /**
   * Expect the number of rows the grid reports.
   *
   * Reads `aria-rowcount` rather than counting `<tr>`s, because the grid
   * virtualises long tables and only renders the rows on screen.
   */
  async expectNrow(value: number, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(
      this.locTable,
      "aria-rowcount",
      String(value),
      options,
    );
  }
}
