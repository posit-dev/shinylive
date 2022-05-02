#!/usr/bin/env python3

import shutil
import os

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
shutil.copyfile("../site/serviceworker.js", "docs/serviceworker.js")
shutil.copytree("../site/examples", "docs/examples")
shutil.copytree("../site/app", "docs/app")
os.symlink("../shinylive", "docs/shinylive")
