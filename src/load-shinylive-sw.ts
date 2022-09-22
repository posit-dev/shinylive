import { dirname, currentScriptDir } from "./utils";

const localhostNames = ["localhost", "127.0.0.1", "[::1]"];

if (
  window.location.protocol !== "https:" &&
  !localhostNames.includes(window.location.hostname)
) {
  const errorMessage =
    "Shinylive uses a Service Worker, which requires either a connection to localhost, or a connection via https.";
  document.body.innerText = errorMessage;
  throw Error(errorMessage);
}

// Figure out path to shinylive-sw.js. This can be provided with a <meta> tag:
//   <meta name="shinylive:serviceworker_dir" content="./" />
// In that case, the path is relative to the current _page_, not this script.
//
// If that meta tag isn't present, assume shinylive-sw.js is in the parent of
// this script's directory.
let serviceWorkerDir: string;
const shinyliveMetaTag = document.querySelector(
  'meta[name="shinylive:serviceworker_dir"]'
);
if (shinyliveMetaTag !== null) {
  serviceWorkerDir = (shinyliveMetaTag as HTMLMetaElement).content;
} else {
  serviceWorkerDir = dirname(currentScriptDir());
}
// Remove trailing slash, if present.
serviceWorkerDir = serviceWorkerDir.replace(/\/$/, "");

const serviceWorkerPath = serviceWorkerDir + "/shinylive-sw.js";

// Start the service worker as soon as possible, to maximize the
// resources it will be able to cache on the first run.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(serviceWorkerPath, { type: "module" })
    .then(() => console.log("Service Worker registered"))
    .catch(() => console.log("Service Worker registration failed"));

  navigator.serviceWorker.ready.then(() => {
    if (!navigator.serviceWorker.controller) {
      // For Shift+Reload case; navigator.serviceWorker.controller will
      // never appear until a regular (not Shift+Reload) page load.
      window.location.reload();
    }
  });
}
