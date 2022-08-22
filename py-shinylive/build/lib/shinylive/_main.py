import copy
import importlib
import importlib.util
import os
import re
import shutil
import sys
import types
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

import click

from . import _deploy


@click.group()  # pyright: ignore[reportUnknownMemberType]
def main() -> None:
    pass


stop_shortcut = "Ctrl+C"


@main.command(
    help="""Turn a Shiny app into a statically deployable bundle.

APPDIR is the directory containing the Shiny application.

DESTDIR is the destination directory where the output files will be written to. This
directory can be deployed as a static web site.

This will not deploy the contents of venv/ or any files that start with '.'

After writing the output files, you can serve them locally with the following command:

    python3 -m http.server --directory DESTDIR 8008
"""
)
@click.argument("appdir", type=str)
@click.argument("destdir", type=str)
@click.option(
    "--verbose",
    is_flag=True,
    default=False,
    help="Print debugging information when copying files.",
    show_default=True,
)
@click.option(
    "--subdir",
    type=str,
    default=None,
    help="Subdir in which to put the app.",
    show_default=True,
)
@click.option(
    "--full-shinylive",
    is_flag=True,
    default=False,
    help="Include the full Shinylive bundle, including all Pyodide packages. Without this flag, only the packages needed to run the application are included.",
    show_default=True,
)
def deploy(
    appdir: str,
    destdir: str,
    subdir: Union[str, None],
    verbose: bool,
    full_shinylive: bool,
) -> None:
    _static.deploy(
        appdir,
        destdir,
        subdir=subdir,
        verbose=verbose,
        full_shinylive=full_shinylive,
    )


@main.command(
    help="""Manage local copy of assets for static app deployment.

    \b
    Commands:
        download: Download assets from the remote server.
        remove: Remove local copies of assets.
        info: Print information about the local assets.
        copy: Copy shinylive assets from a local directory. Must be used with --source.

"""
)
@click.argument("command", type=str)
@click.option(
    "--version",
    type=str,
    default=None,
    help="Shinylive version to download or remove.",
    show_default=True,
)
@click.option(
    "--url",
    type=str,
    default=_deploy._SHINYLIVE_DOWNLOAD_URL,
    help="URL to download from.",
    show_default=True,
)
@click.option(
    "--dir",
    type=str,
    default=None,
    help="Directory to store shinylive assets (if not using the default)",
)
@click.option(
    "--source",
    type=str,
    default=None,
    help="Directory where shinylive assets will be copied from. Must be used with 'copy' command.",
)
def assets(
    command: str, version: str, url: str, dir: str, source: Optional[str]
) -> None:
    if dir is None:
        dir = _static.get_default_shinylive_dir()

    if command == "download":
        if version is None:
            version = _static._SHINYLIVE_DEFAULT_VERSION
        print(f"Downloading shinylive-{version} from {url} to {dir}")
        _static.download_shinylive(destdir=dir, version=version, url=url)
    elif command == "remove":
        if version is None:
            print(f"Removing {dir}")
        else:
            print(f"Removing shinylive-{version} from {dir}")
        _static.remove_shinylive_local(shinylive_dir=dir, version=version)
    elif command == "info":
        _static.print_shinylive_local_info()
    elif command == "copy":
        if source is None:
            raise click.UsageError("Must specify --source")
        if version is None:
            version = _static._SHINYLIVE_DEFAULT_VERSION
        print(f"Copying shinylive-{version} from {source} to {dir}/shinylive-{version}")
        _static.copy_shinylive_local(source_dir=source, destdir=dir, version=version)
    else:
        raise click.UsageError(f"Unknown command: {command}")
