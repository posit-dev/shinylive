# This app uses a phone or tablet's camera to take a picture and process it. It cannot
# use a desktop computer's webcam. If opened on a desktop computer, it will open up an
# ordinary file chooser dialog.
#
# This particular application uses some memory-intensive libraries, like skimage, and so
# it may not work properly on all phones. However, the camera input part should still
# work on most phones.

from shiny import *
from shiny.types import FileInfo, SilentException, ImgData

import skimage
import numpy as np
from PIL import Image, ImageOps

app_ui = ui.page_fluid(
    ui.input_file(
        "file",
        None,
        button_label="Open camera",
        # This tells it to accept still photos only (not videos).
        accept="image/*",
        # This tells it to use the phone's rear camera. Use "user" for the front camera.
        capture="environment",
    ),
    ui.output_image("image"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output
    @render.image
    async def image() -> ImgData:
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
