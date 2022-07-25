from pathlib import Path
from simulation import Body, Simulation, nbody_solve, spherical_to_cartesian
import matplotlib.pyplot as plt
import astropy.units as u
import numpy as np

from shiny import App, reactive, render, ui

# This application adapted from RK4 Orbit Integrator tutorial in Python for Astronomers
# https://prappleizer.github.io/


def panel_box(*args, **kwargs):
    return ui.div(
        ui.div(*args, class_="card-body"),
        **kwargs,
        class_="card mb-3",
    )


app_ui = ui.page_fluid(
    {"class": "p-4"},
    ui.row(
        ui.column(
            4,
            panel_box(
                ui.input_slider("days", "Simulation duration (days)", 0, 200, value=60),
                ui.input_slider(
                    "step_size",
                    "Simulation time step (hours)",
                    0,
                    24,
                    value=4,
                    step=0.5,
                ),
                ui.input_action_button(
                    "run", "Run simulation", class_="btn-primary w-100"
                ),
            ),
            ui.navset_tab_card(
                ui.nav(
                    "Earth",
                    ui.input_checkbox("earth", "Enable", True),
                    ui.output_ui("earth_controls"),
                ),
                ui.nav(
                    "Moon",
                    ui.input_checkbox("moon", "Enable", True),
                    ui.output_ui("moon_controls"),
                ),
                ui.nav(
                    "Planet X",
                    ui.input_checkbox("planetx", "Enable", False),
                    ui.output_ui("planetx_controls"),
                ),
            ),
        ),
        ui.column(
            8,
            ui.output_plot("orbits", width="500px", height="500px"),
            ui.img(src="coords.png", style="width: 100%; max-width: 250px;"),
        ),
    ),
)


def server(input, output, session):
    @output(suspend_when_hidden=False)
    @render.ui
    def earth_controls():
        if not input.earth():
            return None

        return ui.TagList(
            ui.input_numeric(
                "earth_mass",
                "Mass (10^22 kg)",
                597.216,
            ),
            ui.input_slider(
                "earth_speed", "Speed (km/s)", 0, 1, value=0.0126, step=0.001
            ),
            ui.input_slider("earth_theta", "Angle (𝜃)", 0, 360, value=270),
            ui.input_slider("earth_phi", "𝜙", 0, 180, value=90),
        )

    @output(suspend_when_hidden=False)
    @render.ui
    def moon_controls():
        if not input.moon():
            return None

        return ui.TagList(
            ui.input_numeric("moon_mass", "Mass (10^22 kg)", 7.347),
            ui.input_slider(
                "moon_speed", "Speed (km/s)", 0, 2, value=1.022, step=0.001
            ),
            ui.input_slider("moon_theta", "Angle (𝜃)", 0, 360, value=90),
            ui.input_slider("moon_phi", "𝜙", 0, 180, value=90),
        )

    @output(suspend_when_hidden=False)
    @render.ui
    def planetx_controls():
        if not input.planetx():
            return None

        return ui.TagList(
            ui.input_numeric("planetx_mass", "Mass (10^22 kg)", 7.347),
            ui.input_slider(
                "planetx_speed", "Speed (km/s)", 0, 2, value=1.022, step=0.001
            ),
            ui.input_slider("planetx_theta", "Angle (𝜃)", 0, 360, 270),
            ui.input_slider("planetx_phi", "𝜙", 0, 180, 90),
        )

    def earth_body():
        v = spherical_to_cartesian(
            input.earth_theta(), input.earth_phi(), input.earth_speed()
        )

        return Body(
            mass=input.earth_mass() * 10e21 * u.kg,
            x_vec=np.array([0, 0, 0]) * u.km,
            v_vec=np.array(v) * u.km / u.s,
            name="Earth",
        )

    def moon_body():
        v = spherical_to_cartesian(
            input.moon_theta(), input.moon_phi(), input.moon_speed()
        )

        return Body(
            mass=input.moon_mass() * 10e21 * u.kg,
            x_vec=np.array([3.84e5, 0, 0]) * u.km,
            v_vec=np.array(v) * u.km / u.s,
            name="Moon",
        )

    def planetx_body():
        v = spherical_to_cartesian(
            input.planetx_theta(), input.planetx_phi(), input.planetx_speed()
        )

        return Body(
            mass=input.planetx_mass() * 10e21 * u.kg,
            x_vec=np.array([-3.84e5, 0, 0]) * u.km,
            v_vec=np.array(v) * u.km / u.s,
            name="Planet X",
        )

    def simulation():
        bodies = []
        if input.earth():
            bodies.append(earth_body())
        if input.moon():
            bodies.append(moon_body())
        if input.planetx():
            bodies.append(planetx_body())

        simulation_ = Simulation(bodies)
        simulation_.set_diff_eq(nbody_solve)

        return simulation_

    has_run = False

    @output
    @render.plot
    def orbits():
        # A little awkwardness to run the plot on load, and then each time the button is
        # clicked. In the future, slightly different action button behavior will
        # hopefully make this unnecessary.
        input.run()
        nonlocal has_run
        if has_run == False:
            has_run = True
            return make_orbit_plot()
        else:
            with reactive.isolate():
                return make_orbit_plot()

    def make_orbit_plot():
        sim = simulation()
        n_steps = input.days() * 24 / input.step_size()
        with ui.Progress(min=1, max=n_steps) as p:
            sim.run(input.days() * u.day, input.step_size() * u.hr, progress=p)

        sim_hist = sim.history
        end_idx = len(sim_hist) - 1

        fig = plt.figure()

        ax = plt.axes(projection="3d")

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
