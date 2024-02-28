"""Body Shiny module

A Shiny module that represents a body (i.e. planet/moon) in the simulation. This allows
us to have multiple bodies in the simulation, each sharing similar UI and server logic,
without having to repeat the code.

Learn more about Shiny modules at: https://shiny.posit.co/py/docs/workflow-modules.html
"""

import astropy.units as u
import numpy as np
from shiny import module, reactive, ui
from simulation import Body, spherical_to_cartesian


@module.ui
def body_ui(enable, mass, speed, theta, phi):
    return ui.TagList(
        ui.input_checkbox("enable", "Enable", enable),
        ui.panel_conditional(
            "input.enable",
            ui.input_numeric(
                "mass",
                "Mass (10^22 kg)",
                mass,
            ),
            ui.input_slider(
                "speed",
                "Speed (km/s)",
                0,
                1,
                value=speed,
                step=0.001,
            ),
            ui.input_slider("theta", "Angle (𝜃)", 0, 360, value=theta),
            ui.input_slider("phi", "𝜙", 0, 180, value=phi),
        ),
    )


@module.server
def body_server(input, output, session, label, start_vec):
    @reactive.calc
    def body_result():
        if not input.enable():
            return None

        v = spherical_to_cartesian(input.theta(), input.phi(), input.speed())

        return Body(
            mass=input.mass() * 1e22 * u.kg,
            x_vec=np.array(start_vec) * u.km,
            v_vec=np.array(v) * u.km / u.s,
            name=label,
        )

    return body_result
