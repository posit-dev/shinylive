from pathlib import Path

import pandas
from shiny import render

# We need to import something from express to activate express mode
import shiny.express


@render.table
def data_frame():
    infile = Path(__file__).parent / "mtcars.csv"
    return pandas.read_csv(infile)
