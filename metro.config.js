const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Enable WebAssembly asset resolution in Metro for SQLite web support
config.resolver.assetExts.push('wasm');

// Inject SharedArrayBuffer headers required by SQLite's web browser WASM driver
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return middleware(req, res, next);
  };
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
