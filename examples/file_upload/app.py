from math import ceil
from shiny import *

app_ui = ui.page_fluid(
    ui.input_file("file1", "Choose a file to upload:", multiple=True),
    ui.input_radio_buttons("type", "Type:", ["Text", "Binary"]),
    ui.output_text_verbatim("file_content"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output
    @render.text
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
            out_str += "====== " + file_info["name"] + " (showing max 32kB) ======\n"
            if input.type() == "Text":
                with open(file_info["datapath"], "r") as f:
                    out_str += f.read(32768)  # Read in at most 32kB
            else:
                with open(file_info["datapath"], "rb") as f:
                    data = f.read(32768)
                    out_str += format_hexdump(data)

        return out_str


def format_hexdump(data: bytes) -> str:
    hex_vals = ["{:02x}".format(b) for b in data]
    hex_vals = group_into_blocks(hex_vals, 16)
    hex_vals = [" ".join(row) for row in hex_vals]
    hex_vals = "\n".join(hex_vals)
    return hex_vals


def group_into_blocks(x: list[str], blocksize: int):
    """
    Given a list, return a list of lists, where the inner lists each have `blocksize`
    elements.
    """
    return [
        x[i * blocksize : (i + 1) * blocksize] for i in range(ceil(len(x) / blocksize))
    ]


app = App(app_ui, server)
