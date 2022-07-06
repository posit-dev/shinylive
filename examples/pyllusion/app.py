# Demo app for Pyllusion, from
# https://realitybending.github.io/Pyllusion/introduction.html

from shiny import *
import pyllusion


app_ui = ui.page_fluid(
    ui.layout_sidebar(
        ui.panel_sidebar(
            ui.input_select(
                "illusion",
                "Illusion Type",
                [
                    "Delboeuf",
                    "Ebbinghaus",
                    "MullerLyer",
                    "Ponzo",
                    "VerticalHorizontal",
                    "Zollner",
                    "Poggendorff",
                    "Contrast",
                    "White",
                    "Autostereogram",
                    "Pareidolia",
                ],
            ),
            ui.output_ui("controls"),
            # The following dummy slider is needed because the HTML deps for dynamic UI
            # doesn't work.
            ui.div(
                {"style": "display: none"},
                ui.input_slider("XX", "XX", 1, 2, 1, step=1),
            ),
        ),
        ui.panel_main(
            ui.output_plot("plot"),
        ),
    ),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output
    @render.ui
    def controls():
        illusion = input.illusion()
        if illusion in ["Delboeuf", "Ebbinghaus"]:
            return ui.TagList(
                ui.input_slider("strength", "Illusion Strength", 0, 5, 3, step=0.5),
                ui.input_slider("diff", "Difference", -1, 1, 0, step=0.2),
            )
        elif illusion in [
            "MullerLyer",
            "Ponzo",
            "VerticalHorizontal",
            "Zollner",
            "Poggendorff",
            "Contrast",
            "White",
        ]:
            return ui.TagList(
                ui.input_slider("strength", "Illusion Strength", -60, 60, 0, step=5),
                ui.input_slider("diff", "Difference", -1, 1, 0, step=0.2),
            )
        elif illusion in ["Autostereogram"]:
            return ui.TagList(
                ui.input_file("image", "Choose an image to upload:", multiple=True),
                ui.input_select("pattern", "Background pattern", ["Noise", "Circles"]),
            )
        elif illusion in ["Pareidolia"]:
            return ui.TagList(ui.input_text("stimulus", "Stimulus", value="Hello"))

        # if (input.illusion() == "Delboeuf"):

    @output
    @render.plot
    def plot():
        if input.strength() is None or input.diff() is None:
            return None

        strength = input.strength()
        diff = input.diff()
        width = input[".clientdata_output_plot_width"]()
        height = input[".clientdata_output_plot_height"]()

        if input.illusion() == "Delboeuf":
            img = pyllusion.Delboeuf(strength, diff)
        elif input.illusion() == "Ebbinghaus":
            img = pyllusion.Ebbinghaus(strength, diff)
        elif input.illusion() == "MullerLyer":
            img = pyllusion.MullerLyer(strength, diff)
        elif input.illusion() == "Ponzo":
            img = pyllusion.Ponzo(strength, diff)
        elif input.illusion() == "VerticalHorizontal":
            img = pyllusion.VerticalHorizontal(strength, diff)
        elif input.illusion() == "Zollner":
            img = pyllusion.Zollner(strength, diff)
        elif input.illusion() == "Poggendorff":
            img = pyllusion.Poggendorff(strength, diff)
        elif input.illusion() == "Contrast":
            img = pyllusion.Contrast(strength, diff)
        elif input.illusion() == "White":
            img = pyllusion.White(strength, diff)
        elif input.illusion() == "Autostereogram":
            stimulus = input.image()
            if not stimulus:
                return None

            if input.pattern() == "Circles":
                kwargs = {
                    "pattern": pyllusion.image_circles,
                    "color": "blackwhite",
                    "alpha": 0.75,
                    "size_min": 0.01,
                    "size_max": 0.04,
                    "n": 600,
                }
            else:
                kwargs = {
                    "pattern": pyllusion.image_noise,
                    "blackwhite": True,
                }

            img = pyllusion.Autostereogram(stimulus=stimulus[0]["datapath"], **kwargs)
            return img.draw(guide=True)
        else:
            return None

        return img.to_image(width=width, height=height)


app = App(app_ui, server)
