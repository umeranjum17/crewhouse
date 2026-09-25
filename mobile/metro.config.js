// The app shares the web app's api, adapter, tokens and art (../web/src). Metro watches those folders and resolves
// their imports as if from this app. @byokit/link's libsodium resolves to sodium-javascript through its browser field.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const repo = path.resolve(__dirname, '..');
const shared = [path.join(repo, 'src'), path.join(repo, 'web', 'src')]; // web/src/demo.ts reads ../../src/routines.ts
config.watchFolders = shared;
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
config.resolver.resolveRequest = (context, name, platform) => {
  // b4a's Node build needs Buffer, which Hermes lacks; its browser build is plain Uint8Array.
  if (name === 'b4a') return { type: 'sourceFile', filePath: path.join(__dirname, 'node_modules', 'b4a', 'browser.js') };
  const fromShared = shared.some((dir) => context.originModulePath.startsWith(dir + path.sep));
  const bare = !name.startsWith('.') && !path.isAbsolute(name);
  const ctx = fromShared && bare ? { ...context, originModulePath: path.join(__dirname, 'index.ts') } : context;
  return ctx.resolveRequest(ctx, name, platform);
};
module.exports = config;
