from shiny import *

# Import modules for plot rendering
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns


# Import modules for modeling
import pandas as pd
from sklearn.linear_model import LinearRegression, Ridge, Lasso, ElasticNet

# Import custom Python Functions from local file
from compare import compare, sim_data


# data
nsims = 100
sim = [sim_data(n=1000) for i in range(0, nsims)]


# app
app_ui = ui.page_fluid(
    # add head that allows LaTeX to be displayed via MathJax
    ui.head_content(
        ui.tags.script(
            src="https://mathjax.rstudio.com/latest/MathJax.js?config=TeX-AMS-MML_HTMLorMML"
        ),
        ui.tags.script(
            "if (window.MathJax) MathJax.Hub.Queue(['Typeset', MathJax.Hub]);"
        ),
    ),
    # Title
    ui.h1("How Does Regularization Strength Affect Coefficient Estimates?"),
    # input slider
    ui.input_slider("a", "Regularization Strength", 0.000000001, 1, 0.1, step=0.01),
    ui.p(
        "Warning: each time you change the slider input, the simulation may take some time to run."
    ),
    # output plot
    ui.output_plot("plot"),
    # Explanation and Explore text row with two equal-width columns
    ui.row(
        ui.column(
            6,
            ui.h4("Explanation"),
            ui.p(
                """When we train Machine Learning models like linear regressions, logistic regressions,
                or neural networks, we do so by defining a loss function and minimizing that loss function.
                A loss function is a metric for measuring how your model is performing where lower is better.
                For example, Mean Squared Error is a loss function that measures how far (on average) a model's
                guesses are from the true values."""
            ),
            # LaTeX
            ui.p("$$MSE = \\frac{1}{n} \\sum_{i=1}^{n} (Y_i - \hat{Y}_i)^2$$"),
            ui.p(
                """Regularization works by adding a penalty to the loss function in order to penalize
            large model parameters. In Linear Regression, the penalty increases when the size of the
            coefficients increases. Because the loss function is made up of two things: the original
            loss function (the MSE, here) and the penalty, predictors must 'pull their weight' by
            reducing the MSE enough to be 'worth' the penalty. This causes small, unimportant
            predictors to have small or zero coefficients."""
            ),
            ui.p(
                """LASSO (L1) and Ridge (L2) are two common forms of Regularization. LASSO adds a penalty to the
            loss function by taking the absolute value of each parameter/coefficient, and adding them all together.
            Ridge adds a penalty to the loss function by taking the square of each parameter/coefficient,
            and adding them all together."""
            ),
            # LaTeX
            ui.p(
                "$$LASSO = \\frac{1}{n} \\sum_{i=1}^{n} (Y_i - \hat{Y}_i)^2 + \\lambda \\underbrace{\\sum_{j=1}^{p} |\\beta_j|}_\\text{penalty}$$"
            ),
            ui.p(
                "$$Ridge = \\frac{1}{n} \\sum_{i=1}^{n} (Y_i - \hat{Y}_i)^2 + \\lambda \\underbrace{\\sum_{j=1}^{p} \\beta_j^2}_\\text{penalty}$$"
            ),
            ui.p(
                """When using regularization, we must choose the regularization strength (see slider above) which is
            a number that scales how harshly we penalize. If we multiply the penalty
            by 0, that's the same as not having a penalty at all. But if we multiply the penalty
            by 500, that would penalize the parameters a lot more."""
            ),
            ui.p("$$\\lambda \\text{ is the regularization strength.}$$"),
        ),
        ui.column(
            6,
            ui.h4("Explore"),
            ui.h5("Comparing LASSO, Ridge, and Linear Regression"),
            ui.p(
                """With the slider at 0.1 (the default) look at the boxplot at the top of the page. This shows the coefficients from
            1000 simulated data sets. For each data set the 'vowels' (A, E, I, O, U, Y, W) do have some relationship with the outcome (X) that
            our model is predicting. A has the largest effect then E, I, O, U, Y and finally W has the smallest effect on X.
            The Consonants (B,C,D,G,H,J,K) have absolutely no effect on X."""
            ),
            ui.p("Look at the Graph and ask yourself these questions:"),
            ui.HTML(
                "<ul><li>Which model (Linear, LASSO, Ridge) tends to have the highest coefficients? What does this tell you about the various penalties each model has?<li>What happens to the LASSO coefficients for the Consonant predictors (C-K) which have no real effect on X?<li>The Linear and Ridge Coefficients look similar for the Consonants (C-K) but what's slightly different between them? What does that tell you about what Ridge penalties do?<li>Are the larger effects (A-I) affected differently than the smaller effects (O-W) when you increase the Regularization Strength?</ul>"
            ),
            ui.h5("Comparing Different Regularization Strengths"),
            ui.p(
                """Now, using the slider at the top of the page, change the Regularization Strength. Try values that are very low,\
            moderate, and very high."""
            ),
            ui.p("Look at the Graph and ask yourself these questions:"),
            ui.HTML(
                "<ul><li>What happens to the LASSO and Ridge models when the Regularization Strength is almost 0?<li>What happens to the LASSO model's coefficients when the Regularization Strength is very high?<li>Do the Linear Regression coefficients change when you change Regularization Strength? (if so, why, if not, why not?)</ul>"
            ),
        ),
    ),
    # output plots separated by real effects (vowels), and zero-effects (consonants)
    ui.h3("Plots Separated by Vowels and Consonants"),
    ui.output_plot("plotVOWELS"),
    ui.output_plot("plotCONSONANTS"),
)


def server(input: Inputs, output: Outputs, session: Session):

    # reactive Calc that runs LASSO, Ridge, and Linear models on generated data
    @reactive.Calc
    def models():
        sim_alpha = [compare(df, alpha=input.a()) for df in sim]
        sim_alpha = pd.concat(sim_alpha)

        return sim_alpha

    # output plot of all simulation coefficients
    @output
    @render.plot()
    def plot():
        # get data from reactive Calc
        sim_alpha = models()

        # create plot and manage aesthetics
        fig, ax = plt.subplots()
        ax2 = sns.boxplot(
            x="conames",
            y="coefs",
            hue="model",
            data=sim_alpha,
            ax=ax,
            order=[
                "A",
                "E",
                "I",
                "O",
                "U",
                "Y",
                "W",
                "B",
                "C",
                "D",
                "G",
                "H",
                "J",
                "K",
            ],
        )
        tt = "Coefficient Estimates when alpha = " + str(input.a())
        ax2.set(xlabel="", ylabel="Coefficient Value", title=tt)
        return fig

    # output plot of all simulation coefficients (vowels only)
    @output
    @render.plot()
    def plotVOWELS():
        # get data from reactive Calc
        sim_alpha = models()
        vowels = [n in ["A", "E", "I", "O", "U", "Y", "W"] for n in sim_alpha.conames]
        sim_alpha_V = sim_alpha.loc[vowels]

        # create plot and manage aesthetics
        fig, ax = plt.subplots()
        ax2 = sns.boxplot(
            x="conames",
            y="coefs",
            hue="model",
            data=sim_alpha_V,
            ax=ax,
            order=["A", "E", "I", "O", "U", "Y", "W"],
        )
        tt = "VOWEL Coefficient Estimates when alpha = " + str(input.a())
        ax2.set(xlabel="", ylabel="Coefficient Value", title=tt)
        return fig

    # output plot of all simulation coefficients (consonants only)
    @output
    @render.plot()
    def plotCONSONANTS():
        # get data from reactive Calc
        sim_alpha = models()

        consonants = [
            n in ["B", "C", "D", "G", "H", "J", "K"] for n in sim_alpha.conames
        ]
        sim_alpha_C = sim_alpha.loc[consonants]

        # create plot and manage aesthetics
        fig, ax = plt.subplots()
        ax2 = sns.boxplot(
            x="conames",
            y="coefs",
            hue="model",
            data=sim_alpha_C,
            ax=ax,
            order=["B", "C", "D", "G", "H", "J", "K"],
        )
        tt = "CONSONANT Coefficient Estimates when alpha = " + str(input.a())
        ax2.set(xlabel="", ylabel="Coefficient Value", title=tt)
        return fig


app = App(app_ui, server)
