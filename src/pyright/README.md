This is a special build of Pyright that can run in a Web Worker in a browser.

Built from sources at: https://github.com/posit-dev/pyright/ from branch `pyright-browser`
Commit 4a9135964b680d0a2d5120f4b0910b9a4cffc807

## Local testing with a local copy of pyright

In order to test a local copy of shinylive with a local copy of pyright, do the following:

- Build shinylive
- Build pyright, as described in https://github.com/posit-dev/pyright/blob/pyright-browser/THIS_FORK.md
- In the shinylive directory, do the following (and change `/path/to/pyright` as appropriate):

    ```
    cd build/shinylive/pyright
    rm pyright.worker.js pyright.worker.js.map
    (
        PYRIGHTPATH=/path/to/pyright
        ln -s $PYRIGHTPATH/pyright.worker.js
        ln -s $PYRIGHTPATH/pyright.worker.js.map
        ln -s $PYRIGHTPATH/pyright-internal
        ln -s $PYRIGHTPATH/browser-pyright pyright
    )
    ```

- Run `make serve`


The .js symlink will make it so that the web browser will load the copy of pyright that is built from the repo, and .js.map and the directory symlinks will make it so the source .ts files will show in the browser's JS debugger.
