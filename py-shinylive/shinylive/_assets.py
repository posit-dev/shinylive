from typing import List, Union, Optional
import os
from pathlib import Path
import re
import shutil
import sys

from . import _version

SHINYLIVE_DOWNLOAD_URL = "https://pyshiny.netlify.app/shinylive"


def download_shinylive(
    destdir: Union[str, Path, None] = None,
    version: str = _version.version,
    url: str = SHINYLIVE_DOWNLOAD_URL,
) -> None:
    import tarfile
    import urllib.request

    if destdir is None:
        destdir = shinylive_assets_dir()

    destdir = Path(destdir)
    tmp_name = None

    try:
        bundle_url = f"{url}/shinylive-{version}.tar.gz"
        print(f"Downloading {bundle_url}...")
        tmp_name, _ = urllib.request.urlretrieve(bundle_url)

        print(f"Unzipping to {destdir}")
        with tarfile.open(tmp_name) as tar:
            tar.extractall(destdir)
    finally:
        if tmp_name is not None:
            # Can simplify this block after we drop Python 3.7 support.
            if sys.version_info >= (3, 8):
                Path(tmp_name).unlink(missing_ok=True)
            else:
                if os.path.exists(tmp_name):
                    os.remove(tmp_name)


def shinylive_assets_dir() -> str:
    import appdirs

    return os.path.join(appdirs.user_cache_dir("shiny"), "shinylive")


def copy_shinylive_local(
    source_dir: Union[str, Path],
    destdir: Optional[Union[str, Path]] = None,
    version: str = _version.version,
):
    if destdir is None:
        destdir = Path(shinylive_assets_dir())

    destdir = Path(destdir)

    target_dir = destdir / ("shinylive-" + version)

    if target_dir.exists():
        shutil.rmtree(target_dir)

    shutil.copytree(source_dir, target_dir)


def _ensure_shinylive_local(
    destdir: Union[Path, None] = None,
    version: str = _version.version,
    url: str = SHINYLIVE_DOWNLOAD_URL,
) -> Path:
    """Ensure that there is a local copy of shinylive."""

    if destdir is None:
        destdir = Path(shinylive_assets_dir())

    if not destdir.exists():
        print("Creating directory " + str(destdir))
        destdir.mkdir(parents=True)

    shinylive_bundle_dir = destdir / f"shinylive-{version}"
    if not shinylive_bundle_dir.exists():
        print(f"{shinylive_bundle_dir} does not exist.")
        download_shinylive(url=url, version=version, destdir=destdir)

    return shinylive_bundle_dir


def remove_shinylive_local(
    shinylive_dir: Union[str, Path, None] = None,
    version: Optional[str] = None,
) -> None:
    """Removes local copy of shinylive.

    Parameters
    ----------
    shinylive_dir
        The directory where shinylive is stored. If None, the default directory will
        be used.

    version
        If a version is specified, only that version will be removed.
        If None, all local versions of shinylive will be removed.
    """

    if shinylive_dir is None:
        shinylive_dir = shinylive_assets_dir()

    shinylive_dir = Path(shinylive_dir)

    target_dir = shinylive_dir
    if version is not None:
        target_dir = target_dir / f"shinylive-{version}"

    if target_dir.exists():
        shutil.rmtree(target_dir)
    else:
        print(f"{target_dir} does not exist.")


def _installed_shinylive_versions(shinylive_dir: Optional[Path] = None) -> List[str]:
    if shinylive_dir is None:
        shinylive_dir = Path(shinylive_assets_dir())

    shinylive_dir = Path(shinylive_dir)
    subdirs = shinylive_dir.iterdir()
    subdirs = [re.sub("^shinylive-", "", str(s)) for s in subdirs]
    return subdirs


def print_shinylive_local_info() -> None:

    print(
        f"""    Local shinylive dir:
        {shinylive_assets_dir()}

    Installed versions:
        {", ".join(_installed_shinylive_versions())}"""
    )
