// Stub for CSS-ish imports (`import "./Editor.css"`). esbuild bundles these at
// build time; jest has no loader for them, so `moduleNameMapper` in the `jest`
// key of package.json points every .css/.less/.sass/.scss import here.
module.exports = {};
