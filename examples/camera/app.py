# This app uses a phone or tablet's camera to take a picture and process it.
# It cannot use a computer's webcam.

from typing import Optional
from shiny import *
from shiny.types import FileInfo, SilentException
import skimage
import numpy as np
from PIL import Image, ImageOps

# Customize input_file to open the camera
def input_camera(id: str, label: Optional[str]):
    x = ui.input_file(id, label)
    x.children[1].children[0].children[0].children[0] = "Open camera"
    x.children[1].children[0].children[0].children[1].attrs.update(
        {"capture": "user", "accept": "image/*"}
    )
    return x


app_ui = ui.page_fluid(
    input_camera("file", None),
    ui.output_image("image"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output()
    @render.image()
    async def image():
        file_infos: list[FileInfo] = input.file()
        if not file_infos:
            raise SilentException()

        file_info = file_infos[0]
        img = Image.open(file_info["datapath"])

        # Resize to 1000 pixels wide
        basewidth = 1000
        wpercent = basewidth / float(img.size[0])
        hsize = int((float(img.size[1]) * float(wpercent)))
        img = img.resize((basewidth, hsize), Image.ANTIALIAS)

        # Convert to grayscale
        img = ImageOps.grayscale(img)

        # Rotate image based on EXIF tag
        img = ImageOps.exif_transpose(img)

        # Convert to numpy array for skimage processing
        image_data = np.array(img)

        # Apply thresholding
        val = skimage.filters.threshold_otsu(image_data)
        mask = image_data < val

        # Save for render.image
        skimage.io.imsave("small.png", skimage.util.img_as_ubyte(mask))
        return {"src": "small.png", "width": "100%"}


app = App(app_ui, server)
