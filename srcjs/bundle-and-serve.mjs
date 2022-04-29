// Live-reload script taken from https://github.com/evanw/esbuild/issues/802#issuecomment-819578182
import esbuild from "esbuild";
import { createServer, request } from "http";
import { spawn } from "child_process";
import buildExamples from "./examples/build_examples_json.mjs";
import process from "process";

const clients = [];

esbuild
  .build({
    bundle: true,
    entryPoints: ["src/Components/App.tsx"],
    outdir: "./shinylive/Components/",
    format: "esm",
    banner: {
      js: ` (() => {
        if (window.location.host.includes("localhost")) {
          console.log('%c~~~~~ Live Reload Enabled ~~~~~~', 'font-weight:bold;font-size:20px;color:white;display:block;background-color:green;padding:4px;border-radius:5px;');
          new EventSource("/esbuild").onmessage = () => location.reload();
        }
      })();`,
    },
    watch: {
      onRebuild(error, result) {
        clients.forEach((res) => res.write("data: update\n\n"));
        clients.length = 0;
        console.log(error ? error : "...");
      },
    },
    plugins: [
      {
        name: "example-builder",
        setup(build) {
          build.onStart(() => {
            // On every rebuild make sure the examples are up to date.
            // One issue is this won't force esbuild to watch for the changes
            // of the example files themselves so live-reloading won't work
            buildExamples();
          });
        },
      },
    ],
  })
  .catch(() => process.exit(1));

esbuild.serve({ servedir: "site/", port: 3001 }, {}).then(() => {
  createServer((req, res) => {
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
      request(
        { hostname: "0.0.0.0", port: 3001, path: url, method, headers },
        (prxRes) => {
          res.writeHead(prxRes.statusCode, prxRes.headers);
          prxRes.pipe(res, { end: true });
        }
      ),
      { end: true }
    );
  }).listen(3000);

  setTimeout(() => {
    const op = {
      darwin: ["open"],
      linux: ["xdg-open"],
      win32: ["cmd", "/c", "start"],
    };
    const ptf = process.platform;
    if (clients.length === 0)
      spawn(op[ptf][0], [`http://localhost:3000/examples`]);
  }, 1000); //open the default browser only if it is not opened yet
});
