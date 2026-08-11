// Stub for asset imports (`import skull from "./skull.svg"`). esbuild resolves
// these to a URL at build time; under jest they resolve here instead, via
// `moduleNameMapper` in the `jest` key of package.json.
module.exports = "test-file-stub";
