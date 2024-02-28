from pathlib import Path

import astropy.units as u
import matplotlib.pyplot as plt
import numpy as np
from body import body_server, body_ui
from faicons import icon_svg
from shiny import App, reactive, render, ui
from simulation import Simulation, nbody_solve

# This application adapted from RK4 Orbit Integrator tutorial in Python for Astronomers
# https://prappleizer.github.io/


app_ui = ui.page_sidebar(
    ui.sidebar(
        ui.img(
            src="coords.png", style="width: 100%; max-width: 225px;", class_="border"
        ),
        ui.accordion(
            ui.accordion_panel(
                "Settings",
                ui.input_slider("days", "Simulation duration (days)", 0, 200, value=60),
                ui.input_slider(
                    "step_size",
                    "Simulation time step (hours)",
                    0,
                    24,
                    value=4,
                    step=0.5,
                ),
            ),
            ui.accordion_panel(
                "Earth",
                body_ui(
                    "earth", enable=True, mass=597.216, speed=0.0126, theta=270, phi=90
                ),
            ),
            ui.accordion_panel(
                "Moon",
                body_ui("moon", enable=True, mass=7.347, speed=1.022, theta=60, phi=90),
            ),
            ui.accordion_panel(
                "Planet X",
                body_ui(
                    "planetx", enable=True, mass=7.347, speed=1.022, theta=270, phi=60
                ),
            ),
            # mt-4: margin top 4; adds a bit of space above the accordion
            class_="mt-4",
            # Give the accordion the same background color as the sidebar
            style="--bs-accordion-bg: --bslib-sidebar-bg;",
        ),
        position="right",
        open="always",
        # In mobile mode, let the sidebar be as tall as it wants
        max_height_mobile="auto",
    ),
    ui.div(
        ui.input_action_button(
            "run", "Run simulation", icon=icon_svg("play"), class_="btn-primary"
        )
    ),
    ui.output_plot("orbits"),
)


def server(input, output, session):
    earth_body = body_server("earth", "Earth", [0, 0, 0])
    moon_body = body_server("moon", "Moon", [3.84e5, 0, 0])
    planetx_body = body_server("planetx", "Planet X", [-3.84e5, 0, 0])

    @reactive.calc()
    def simulation():
        bodies = [
            x for x in [earth_body(), moon_body(), planetx_body()] if x is not None
        ]

        sim = Simulation(bodies)
        sim.set_diff_eq(nbody_solve)

        n_steps = input.days() * 24 / input.step_size()
        with ui.Progress(min=1, max=n_steps) as p:
            sim.run(input.days() * u.day, input.step_size() * u.hr, progress=p)

        return sim.history

    @render.plot
    # ignore_none=False is used to instruct Shiny to render this plot even before the
    # input.run button is clicked for the first time. We do this because we want to
    # render the empty 3D space on app startup, to give the user a sense of what's about
    # to happen when they run the simulation.
    @reactive.event(input.run, ignore_none=False)
    def orbits():
        fig = plt.figure()
        ax = plt.axes(projection="3d")

        if input.run() > 0:
            sim_hist = simulation()
            end_idx = len(sim_hist) - 1

            n_bodies = int(sim_hist.shape[1] / 6)
            for i in range(0, n_bodies):
                ax.scatter3D(
                    sim_hist[end_idx, i * 6],
                    sim_hist[end_idx, i * 6 + 1],
                    sim_hist[end_idx, i * 6 + 2],
                    s=50,
                )
                ax.plot3D(
                    sim_hist[:, i * 6],
                    sim_hist[:, i * 6 + 1],
                    sim_hist[:, i * 6 + 2],
                )

        ax.view_init(30, 20)
        set_axes_equal(ax)

        return fig


www_dir = Path(__file__).parent / "www"
app = App(app_ui, server, static_assets=www_dir)


# https://stackoverflow.com/a/31364297/412655
def set_axes_equal(ax):
    """Make axes of 3D plot have equal scale so that spheres appear as spheres,
    cubes as cubes, etc..  This is one possible solution to Matplotlib's
    ax.set_aspect('equal') and ax.axis('equal') not working for 3D.

    Input
      ax: a matplotlib axis, e.g., as output from plt.gca().
    """

    x_limits = ax.get_xlim3d()
    y_limits = ax.get_ylim3d()
    z_limits = ax.get_zlim3d()

    x_range = abs(x_limits[1] - x_limits[0])
    x_middle = np.mean(x_limits)
    y_range = abs(y_limits[1] - y_limits[0])
    y_middle = np.mean(y_limits)
    z_range = abs(z_limits[1] - z_limits[0])
    z_middle = np.mean(z_limits)

    # The plot bounding box is a sphere in the sense of the infinity
    # norm, hence I call half the max range the plot radius.
    plot_radius = 0.5 * max([x_range, y_range, z_range])

    ax.set_xlim3d([x_middle - plot_radius, x_middle + plot_radius])
    ax.set_ylim3d([y_middle - plot_radius, y_middle + plot_radius])
    ax.set_zlim3d([z_middle - plot_radius, z_middle + plot_radius])
