// Live-reload script taken from https://github.com/evanw/esbuild/issues/802#issuecomment-819578182
import buildExamples from "./build_examples_json.mjs";
import { spawn } from "child_process";
import esbuild from "esbuild";
import * as fs from "fs";
import http from "http";
import process from "process";

const EXAMPLES_SOURCE_DIR = "./examples";
const BUILD_DIR = "./build";

const clients = [];

let watch = false;
let serve = false;
let minify = false;
// Set this to true to generate a metadata file that can be analyzed for size of
// modules in the bundle.
let metafile = false;

if (process.argv.some((x) => x === "--watch")) {
  watch = true;
}
if (process.argv.some((x) => x === "--serve")) {
  watch = true;
  serve = true;
}
if (process.argv.some((x) => x === "--minify")) {
  minify = true;
}

const onRebuild = (error, result) => {
  clients.forEach((res) => res.write("data: update\n\n"));
  clients.length = 0;

  console.log(
    `[${new Date().toISOString()}]` +
      (error ? error : " Rebuilding JS files...")
  );
};

let watchProp = {};
if (watch) {
  watchProp = { watch: { onRebuild } };
}

esbuild
  .build({
    bundle: true,
    entryPoints: ["src/Components/App.tsx"],
    outfile: `${BUILD_DIR}/shinylive/shinylive.js`,
    format: "esm",
    target: "es2020",
    minify: minify,
    metafile: metafile,
    ...watchProp,
    loader: { ".svg": "dataurl" },
    plugins: [
      {
        name: "example-builder",
        setup(build) {
          build.onStart(() => {
            // On every rebuild make sure the examples are up to date.
            // One issue is this won't force esbuild to watch for the changes
            // of the example files themselves so live-reloading won't work
            buildExamples(EXAMPLES_SOURCE_DIR, BUILD_DIR);
          });
        },
      },
    ],
  })
  .then((result) => {
    if (metafile) {
      fs.writeFileSync("esbuild-meta.json", JSON.stringify(result.metafile));
    }
  })
  .catch(() => process.exit(1));

esbuild
  .build({
    bundle: true,
    entryPoints: ["src/pyodide-worker.ts", "src/inject-socket.ts"],
    outdir: `${BUILD_DIR}/shinylive`,
    format: "esm",
    target: "es2020",
    minify: minify,
    ...watchProp,
  })
  .catch(() => process.exit(1));

esbuild
  .build({
    bundle: false,
    entryPoints: ["src/run-python-blocks.ts"],
    outdir: `${BUILD_DIR}/shinylive`,
    format: "esm",
    target: "es2020",
    minify: minify,
    ...watchProp,
  })
  .catch(() => process.exit(1));

esbuild
  .build({
    bundle: true,
    entryPoints: ["src/serviceworker.ts"],
    outdir: `${BUILD_DIR}`,
    format: "esm",
    target: "es2020",
    minify: minify,
    ...watchProp,
  })
  .catch(() => process.exit(1));

if (serve) {
  esbuild.serve({ servedir: "site/", port: 3001 }, {}).then(() => {
    http
      .createServer((req, res) => {
        const { url, method, headers } = req;

        if (req.url === "/esbuild")
          return clients.push(
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            })
          );

        req.pipe(
          http.request(
            { hostname: "0.0.0.0", port: 3001, path: url, method, headers },
            (proxyRes) => {
              if (url === "/shinylive/shinylive.js") {
                // JS code for does auto-reloading. We'll inject it into
                // shinylive.js as it's sent.
                const jsReloadCode = `(() => {
                  if (window.location.host.includes("localhost")) {
                    console.log('%c~~~~~ Live Reload Enabled ~~~~~~', 'font-weight:bold;font-size:20px;color:white;display:block;background-color:green;padding:4px;border-radius:5px;');
                    new EventSource("/esbuild").onmessage = () => location.reload();
                  }
                })();`;

                const newHeaders = {
                  ...proxyRes.headers,
                  "content-length":
                    parseInt(proxyRes.headers["content-length"], 10) +
                    jsReloadCode.length,
                };

                res.writeHead(proxyRes.statusCode, newHeaders);
                res.write(jsReloadCode);
              } else {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
              }
              proxyRes.pipe(res, { end: true });
            }
          ),
          { end: true }
        );
      })
      .listen(3000);

    setTimeout(() => {
      const op = {
        darwin: ["open"],
        linux: ["xdg-open"],
        win32: ["cmd", "/c", "start"],
      };
      const platform = process.platform;
      if (clients.length === 0)
        spawn(op[platform][0], [`http://localhost:3000/examples`]);
    }, 1000); //open the default browser only if it is not opened yet
  });
}
