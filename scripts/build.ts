import { spawn } from "child_process";
import esbuild from "esbuild";
import * as fs from "fs";
import http from "http";
import process from "process";
import packageJson from "../package.json";
import buildExamples from "./build_examples_json";

const EXAMPLES_SOURCE_DIR = "./examples";
const BUILD_DIR = "./build";
const SITE_DIR = "./site";

const SHINYLIVE_VERSION = packageJson.version;
const currentYear = new Date().getFullYear();
const banner = {
  js: `// Shinylive ${SHINYLIVE_VERSION}\n// Copyright ${currentYear} RStudio, PBC`,
  css: `/* Shinylive ${SHINYLIVE_VERSION}\n// Copyright ${currentYear} RStudio, PBC */`,
};

const clients: http.ServerResponse[] = [];

let watch = false;
let serve = false;
let openBrowser = true;
let minify = false;
let reactProductionMode = false;
// Set this to true to generate a metadata file that can be analyzed for size of
// modules in the bundle, like with Bundle-Buddy.
const metafile = process.argv.includes("--metafile");

if (process.argv.includes("--watch")) {
  watch = true;
}
if (process.argv.includes("--serve")) {
  watch = true;
  serve = true;
}
if (process.argv.includes("--prod")) {
  minify = true;
  reactProductionMode = true;
}
if (process.argv.includes("--test-server")) {
  serve = true;
  watch = false;
  openBrowser = false;
}

function createRebuildLoggerPlugin(label: string) {
  return {
    name: "rebuild-logger",
    setup(build: esbuild.PluginBuild) {
      build.onStart(() => {
        console.log(
          `[${new Date().toISOString()}] Rebuilding JS files for ${label}...`
        );
      });
    },
  };
}

const metafilePlugin = {
  name: "metafile",
  setup(build: esbuild.PluginBuild) {
    build.onEnd((result) => {
      if (metafile) {
        console.log("metafile");
        fs.writeFileSync(
          "esbuild-metadata.json",
          JSON.stringify(result.metafile)
        );
      }
    });
  },
};

const buildmap = {
  app: esbuild.context({
    bundle: true,
    entryPoints: {
      shinylive: "src/Components/App.tsx",
      Editor: "src/Components/Editor.tsx",
    },
    outdir: `${SITE_DIR}/shinylive/`,
    // All of these are dynamic imports in pyodide.mjs (which we copied to
    // src/pyodide/pyodide.js). It will never actually do these imports, so
    // we'll mark them as external so esbuild doesn't try to bundle them.
    external: [
      "node-fetch",
      "path",
      "fs",
      "vm",
      "crypto",
      "child_process",
      "url",
      "ws",
    ],
    format: "esm",
    target: "es2020",
    splitting: true,
    // It would be more organized to put the chunks in "chunks/[name]", but this
    // causes problems when ../pyodide/pyodide.js loads "pyodide_py.tar" -- it
    // looks in /shinylive/chunks/pyodide/pyodide_py.tar, which doesn't exist.
    // This probably has something to do with how pyodide.js specifies the path.
    chunkNames: "[name]-[hash]",
    minify: minify,
    banner: banner,
    metafile: metafile,
    define: {
      "process.env.NODE_ENV": reactProductionMode
        ? '"production"'
        : '"development"',
    },
    loader: {
      ".svg": "dataurl",
    },
    plugins: [
      createRebuildLoggerPlugin("shinylive and Editor"),
      metafilePlugin,
      {
        // This removes previously-built chunk-[hash].js files so that they
        // don't clutter up the build directory.
        name: "chunk-cleaner",
        setup(build) {
          build.onStart(async () => {
            fs.readdirSync(`${BUILD_DIR}/shinylive/`)
              .filter((file) => file.startsWith("chunk-"))
              .forEach((file) => {
                fs.unlinkSync(`${BUILD_DIR}/shinylive/${file}`);
              });
          });
        },
      },
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
  }),
  worker: esbuild.context({
    bundle: true,
    entryPoints: [
      "src/pyodide-worker.ts",
      "src/load-shinylive-sw.ts",
      "src/run-python-blocks.ts",
    ],
    outdir: `${BUILD_DIR}/shinylive`,
    // See note in esbuild.build() call above about why these are external.
    external: [
      "node-fetch",
      "path",
      "fs",
      "vm",
      "crypto",
      "child_process",
      "url",
      // shinylive.js is used in run-python-blocks.ts, but we don't want to
      // bundle it.
      "./shinylive.js",
    ],
    format: "esm",
    target: "es2020",
    minify: minify,
    banner: banner,
    plugins: [createRebuildLoggerPlugin("worker")],
  }),
  "codeblock-to-json": esbuild.context({
    bundle: true,
    entryPoints: ["src/scripts/codeblock-to-json.ts"],
    outdir: `${BUILD_DIR}/scripts`,
    format: "esm",
    target: "es2022",
    minify: minify,
    banner: banner,
    plugins: [createRebuildLoggerPlugin("codeblock-to-json")],
  }),
  // Compile src/shinylive-inject-socket.ts to
  // src/assets/shinylive-inject-socket.txt. That file is in turn ingested into
  // shinylive-sw.js.
  "shinylive-inject-socket": esbuild.context({
    bundle: true,
    entryPoints: ["src/shinylive-inject-socket.ts"],
    outfile: "src/assets/shinylive-inject-socket.txt",
    format: "esm",
    target: "es2020",
    // Don't minify, because the space savings are minimal, and the it will lead
    // to spurious diffs when building for dev vs. prod.
    minify: false,
    plugins: [createRebuildLoggerPlugin("shinylive-inject-socket")],
  }),
  "shinylive-sw": esbuild.context({
    bundle: true,
    entryPoints: ["src/shinylive-sw.ts"],
    outdir: `${BUILD_DIR}`,
    format: "esm",
    target: "es2020",
    minify: minify,
    banner: banner,
    plugins: [createRebuildLoggerPlugin("shinylive-sw")],
  }),
};

Object.values(buildmap).forEach((build) =>
  build
    .then((context) => {
      if (watch) {
        context.watch();
      } else {
        context.rebuild();
        context.dispose();
      }
    })
    .catch(() => process.exit(1))
);

if (serve) {
  buildmap["app"]
    .then((context) => {
      context.serve({ servedir: SITE_DIR, port: 3001 }).then(() => {
        http
          .createServer((req, res) => {
            const { url, method, headers } = req;
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
                        new EventSource('/esbuild').addEventListener('change', () => location.reload())
                      }
                    })();`;

                    const newHeaders = {
                      ...proxyRes.headers,
                      "content-length":
                        parseInt(proxyRes.headers["content-length"]!, 10) +
                        jsReloadCode.length,
                    };

                    res.writeHead(proxyRes.statusCode!, newHeaders);
                    res.write(jsReloadCode);
                  } else {
                    const client = res.writeHead(
                      proxyRes.statusCode!,
                      proxyRes.headers
                    );
                    if (req.url === "/esbuild") clients.push(client);
                  }
                  proxyRes.pipe(res, { end: true });
                }
              ),
              { end: true }
            );
          })
          .listen(3000);

        if (openBrowser) {
          setTimeout(() => {
            const op = {
              darwin: ["open"],
              linux: ["xdg-open"],
              win32: ["cmd", "/c", "start"],
            };
            if (clients.length === 0) {
              // @ts-expect-error: `process.platform` could have many other
              // values, like aix, android, haiku, openbsd, freebsd, etc.
              spawn(op[process.platform][0], [
                `http://localhost:3000/examples`,
              ]);
            }
          }, 1000); //open the default browser only if it is not opened yet
        }
      });
    })
    .catch(() => process.exit(1));
}
