import type { Completion } from "@codemirror/autocomplete";
import { snippetCompletion } from "@codemirror/autocomplete";

type ShinySnippet = { label: string; code: string[] };

const shinySnippets: {
  [key: string]: ShinySnippet[];
} = {
  r: [
    {
      label: "shinyapp",
      code: [
        "library(shiny)",
        "library(bslib)",
        "",
        "ui <- page_${1:fluid}(",
        "  ${0}",
        ")",
        "",
        "server <- function(input, output, session) {",
        "",
        "}",
        "",
        "shinyApp(ui, server)",
      ],
    },
    {
      label: "shinymod",
      code: [
        "${1:name}UI <- function(id) {",
        "  ns <- NS(id)",
        "  tagList(",
        "    ${0}",
        "  )",
        "}",
        "",
        "${1:name}Server <- function(id) {",
        "  moduleServer(id, function(input, output, session) {",
        "    ",
        "  })",
        "}",
      ],
    },
  ],
  python: [
    {
      label: "shinyapp",
      code: [
        "from shiny import App, reactive, render, req, ui",
        "",
        "app_ui = ui.page_fluid(",
        '\tui.input_slider("n", "N", 0, 100, 20),',
        '\tui.output_text_verbatim("txt"),',
        ")",
        "",
        "",
        "def server(input, output, session):",
        "\t@render.text",
        "\tdef txt():",
        '\t\treturn f"n*2 is {input.n() * 2}"',
        "",
        "",
        "app = App(app_ui, server)",
        "",
      ],
    },
    {
      label: "shinyexpress",
      code: [
        "from shiny.express import input, render, ui",
        "",
        'ui.input_slider("n", "N", 0, 100, 20)',
        "",
        "",
        "@render.text",
        "def txt():",
        '\treturn f"n*2 is {input.n() * 2}"',
        "",
      ],
    },
    {
      label: "shinymod",
      code: [
        "from shiny import module, reactive, render, ui",
        "",
        "# ============================================================",
        "# Module: ${1:modname}",
        "# ============================================================",
        "",
        "@module.ui",
        'def $1_ui(label = "Increment counter"):',
        "\treturn ui.div(",
        '\t\t{"style": "border: 1px solid #ccc; border-radius: 5px; margin: 5px 0;"},',
        '\t\tui.h2("This is " + label),',
        '\t\tui.input_action_button(id="button", label=label),',
        '\t\tui.output_text_verbatim(id="out"),',
        "\t)",
        "",
        "",
        "@module.server",
        "def $1_server(input, output, session, starting_value = 0):",
        "\tcount = reactive.value(starting_value)",
        "",
        "\t@reactive.effect",
        "\t@reactive.event(input.button)",
        "\tdef _():",
        "\t\tcount.set(count() + 1)",
        "",
        "\t@render.text",
        "\tdef out() -> str:",
        '\t\treturn f"Click count is {count()}"',
        "",
      ],
    },
  ],
};

export function getShinySnippets(filetype: string): Completion[] | undefined {
  if (!(filetype in shinySnippets)) return;

  return shinySnippets[filetype].map((snippet: ShinySnippet): Completion => {
    return snippetCompletion(snippet.code.join("\n"), {
      label: snippet.label,
    });
  });
}
