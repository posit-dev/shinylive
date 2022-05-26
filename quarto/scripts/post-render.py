#!/usr/bin/env python3

import shutil
import os

# Directory with built shinylive assets
BUILD_DIR = "build"
# Directory with static HTML site assets (like examples/index.html)
SITE_DIR = "site"


# Continue past this part only if building entire site.
if not os.getenv("QUARTO_PROJECT_RENDER_ALL"):
    exit()

# This file is here so that GitHub Pages will serve dirs that start with an
# underscore. It is needed for docs/api/_static/.
open("docs/.nojekyll", "a").close()

# It would be more convenient to copy these files using `resources` in
# _quarto.yml, but it doesn't seem to allow choosing the destination directory,
# so the files would end up on docs/prism-experiments/shinylive/ instead of
# docs/shinylive/.
shutil.copyfile(f"../{BUILD_DIR}/serviceworker.js", "docs/serviceworker.js")
os.symlink(f"../../{BUILD_DIR}/shinylive", "docs/shinylive")
shutil.copytree(f"../{SITE_DIR}/examples", "docs/examples")
shutil.copytree(f"../{SITE_DIR}/editor", "docs/editor")
shutil.copytree(f"../{SITE_DIR}/app", "docs/app")
