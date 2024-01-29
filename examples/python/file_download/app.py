import asyncio
import io
from datetime import date
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from shiny.express import ui, input, render

with ui.layout_columns():
    with ui.card():
        ui.card_header("Download a pre-existing file, using its existing name on disk.")

        @render.download(label="Download CSV", filename="mtcars.csv")
        def download1():
            # This is the simplest case. The implementation simply returns the path to a
            # file on disk.
            path = Path(__file__).parent / "mtcars.csv"
            return str(path)

    with ui.card():
        ui.card_header("Download a PNG that is generated dynamically.")
        ui.input_text("title", "Plot title", "Random scatter plot")
        ui.input_slider("num_points", "Number of data points", 1, 100, 50)

        @render.download(label="Download PNG", filename="image.png")
        def download2():
            # Another way to implement a file download is by yielding bytes; either all at
            # once, like in this case, or by yielding multiple times. When using this
            # approach, you should pass a filename argument to @session.download, which
            # determines what the browser will name the downloaded file.
            x = np.random.uniform(size=input.num_points())
            y = np.random.uniform(size=input.num_points())
            plt.figure()
            plt.scatter(x, y)
            plt.title(input.title())
            with io.BytesIO() as buf:
                plt.savefig(buf, format="png")
                yield buf.getvalue()

    with ui.card():
        ui.card_header("Download a file with name that is generated dynamically.")

        @render.download(
            label="Dynamic file name",
            filename=lambda: f"data-{date.today().isoformat()}-{np.random.randint(100,999)}.csv",
        )
        async def download3():
            # This version uses a function to generate the filename. It also yields data
            # multiple times.
            await asyncio.sleep(0.25)
            yield "one,two,three\n"
            yield "新,1,2\n"
            yield "型,4,5\n"
