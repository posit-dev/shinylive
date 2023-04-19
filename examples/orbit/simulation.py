import time
from typing import Any

import astropy.constants as c
import numpy as np

# Adapted from Python for Astronomers: An Introduction to Scientific Computing
# by Imad Pasha & Christopher Agostino
# https://prappleizer.github.io/Tutorials/RK4/RK4_Tutorial.html

# Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License
# http://creativecommons.org/licenses/by-nc-sa/4.0/


class Body:
    def __init__(self, mass, x_vec, v_vec, name=None, has_units=True):
        """
        spawn instance of the Body class, which is used in Simulations.

        :param: mass | mass of particle. if has_units=True, an Astropy Quantity, otherwise a float
        :param: x_vec | a vector len(3) containing the x, y, z initial positions of the body.
                     the array can be unitless if has_units=False, or be of the form np.array([0,0,0])*u.km
        :param: v_vec | vector len(3) containing the v_x, v_y, v_z initial velocities of the body.
        :param: name | string containing a name, used for plotting later
        :param: has_units | defines how the code treats the problem, as unit-ed, or unitless.
        """
        self.name = name
        self.has_units = has_units
        if self.has_units:
            self.mass = mass.cgs
            self.x_vec = x_vec.cgs.value
            self.v_vec = v_vec.cgs.value
        else:
            self.mass = mass
            self.x_vec = x_vec
            self.v_vec = v_vec

    def return_vec(self):
        """
        Concatenates the x and v vector into 1 vector 'y' used in RK formalism.
        """
        return np.concatenate((self.x_vec, self.v_vec))

    def return_mass(self):
        """
        handler to strip the mass units if present (after converting to cgs) or return float
        """
        if self.has_units:
            return self.mass.cgs.value
        else:
            return self.mass

    def return_name(self):
        return self.name


class Simulation:
    def __init__(self, bodies, has_units=True):
        """
        Initializes instance of Simulation object.
        -------------------------------------------
        Params:
            bodies (list): a list of Body() objects
            has_units (bool): set whether bodies entered have units or not.
        """
        self.has_units = has_units
        self.bodies = bodies
        self.N_bodies = len(self.bodies)
        self.nDim = 6.0
        self.quant_vec = np.concatenate(np.array([i.return_vec() for i in self.bodies]))
        self.mass_vec = np.array([i.return_mass() for i in self.bodies])
        self.name_vec = [i.return_name() for i in self.bodies]

    def set_diff_eq(self, calc_diff_eqs, **kwargs):
        """
        Method which assigns an external solver function as the diff-eq solver for RK4.
        For N-body or gravitational setups, this is the function which calculates accelerations.
        ---------------------------------
        Params:
            calc_diff_eqs: A function which returns a [y] vector for RK4
            **kwargs: Any additional inputs/hyperparameters the external function requires
        """
        self.diff_eq_kwargs = kwargs
        self.calc_diff_eqs = calc_diff_eqs

    def rk4(self, t, dt):
        """
        RK4 integrator. Calculates the K values and returns a new y vector
        --------------------------------
        Params:
            t: a time. Only used if the diff eq depends on time (gravity doesn't).
            dt: timestep. Non adaptive in this case
        """
        k1 = dt * self.calc_diff_eqs(
            t, self.quant_vec, self.mass_vec, **self.diff_eq_kwargs
        )
        k2 = dt * self.calc_diff_eqs(
            t + 0.5 * dt,
            self.quant_vec + 0.5 * k1,
            self.mass_vec,
            **self.diff_eq_kwargs,
        )
        k3 = dt * self.calc_diff_eqs(
            t + 0.5 * dt,
            self.quant_vec + 0.5 * k2,
            self.mass_vec,
            **self.diff_eq_kwargs,
        )
        k4 = dt * self.calc_diff_eqs(
            t + dt, self.quant_vec + k2, self.mass_vec, **self.diff_eq_kwargs
        )

        y_new = self.quant_vec + ((k1 + 2 * k2 + 2 * k3 + k4) / 6.0)

        return y_new

    def run(self, T, dt, t0=0, progress=None):
        """
        Method which runs the simulation on a given set of bodies.
        ---------------------
        Params:
            T: total time (in simulation units) to run the simulation. Can have units or not, just set has_units appropriately.
            dt: timestep (in simulation units) to advance the simulation. Same as above
            t0 (optional): set a non-zero start time to the simulation.
            progress (optional): A shiny.ui.Progress object which will be used to send progress updates.

        Returns:
            None, but leaves an attribute history accessed via
            'simulation.history' which contains all y vectors for the simulation.
            These are of shape (Nstep,Nbodies * 6), so the x and y positions of particle 1 are
            simulation.history[:,0], simulation.history[:,1], while the same for particle 2 are
            simulation.history[:,6], simulation.history[:,7]. Velocities are also extractable.
        """
        if not hasattr(self, "calc_diff_eqs"):
            raise AttributeError("You must set a diff eq solver first.")
        if self.has_units:
            try:
                _ = t0.unit
            except Exception:
                t0 = (t0 * T.unit).cgs.value
            T = T.cgs.value
            dt = dt.cgs.value

        self.history: Any = [self.quant_vec]
        clock_time = t0
        nsteps = int((T - t0) / dt)
        for step in range(nsteps):
            if progress is not None and step % 5 == 0:
                progress.set(
                    step,
                    message=f"Integrating step = {step} / {nsteps}",
                    detail=f"Elapsed time = {round(clock_time/1e6, 1)}",
                )
            y_new = self.rk4(0, dt)
            self.history.append(y_new)
            self.quant_vec = y_new
            clock_time += dt
        self.history = np.array(self.history)


def nbody_solve(t, y, masses):
    N_bodies = int(len(y) / 6)
    solved_vector = np.zeros(y.size)
    for i in range(N_bodies):
        ioffset = i * 6
        for j in range(N_bodies):
            joffset = j * 6
            solved_vector[ioffset] = y[ioffset + 3]
            solved_vector[ioffset + 1] = y[ioffset + 4]
            solved_vector[ioffset + 2] = y[ioffset + 5]
            if i != j:
                dx = y[ioffset] - y[joffset]
                dy = y[ioffset + 1] - y[joffset + 1]
                dz = y[ioffset + 2] - y[joffset + 2]
                r = (dx**2 + dy**2 + dz**2) ** 0.5
                ax = (-c.G.cgs * masses[j] / r**3) * dx
                ay = (-c.G.cgs * masses[j] / r**3) * dy
                az = (-c.G.cgs * masses[j] / r**3) * dz
                ax = ax.value
                ay = ay.value
                az = az.value
                solved_vector[ioffset + 3] += ax
                solved_vector[ioffset + 4] += ay
                solved_vector[ioffset + 5] += az
    return solved_vector


def spherical_to_cartesian(
    theta: float, phi: float, rho: float
) -> tuple[float, float, float]:
    x = rho * sind(phi) * cosd(theta)
    y = rho * sind(phi) * sind(theta)
    z = rho * cosd(phi)
    return (x, y, z)


def cosd(x):
    return np.cos(x / 180 * np.pi)


def sind(x):
    return np.sin(x / 180 * np.pi)
