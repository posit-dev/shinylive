from shiny import *
from shiny.types import FileInfo

app_ui = ui.page_fluid(
    ui.input_file("file1", "Choose file", multiple=True),
    ui.output_text_verbatim("file_content"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output()
    @render_text()
    def file_content():
        file_infos: list[FileInfo] = input.file1()
        if not file_infos:
            return

        out_str = ""
        for file_info in file_infos:
            out_str += "====== " + file_info["name"] + " ======\n"
            with open(file_info["datapath"], "r") as f:
                out_str += f.read()

        return out_str


app = App(app_ui, server, debug=True)
