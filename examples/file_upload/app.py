from shiny import *

app_ui = ui.page_fluid(
    ui.input_file("file1", "Choose a text file to upload:", multiple=True),
    ui.output_text_verbatim("file_content"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output()
    @render.text()
    def file_content():
        file_infos = input.file1()
        if not file_infos:
            return

        # file_infos is a list of dicts; each dict represents one file. Example:
        # [
        #   {
        #     'name': 'data.csv',
        #     'size': 2601,
        #     'type': 'text/csv',
        #     'datapath': '/tmp/fileupload-1wnx_7c2/tmpga4x9mps/0.csv'
        #   }
        # ]
        out_str = ""
        for file_info in file_infos:
            out_str += "====== " + file_info["name"] + " ======\n"
            with open(file_info["datapath"], "r") as f:
                out_str += f.read()

        return out_str


app = App(app_ui, server, debug=True)
