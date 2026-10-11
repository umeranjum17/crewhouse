// Bundle Chief's actual template files as words, never downloaded code: turn a .md file into an ES module that
// exports its text, then hand every file (md or not) to Expo's own babel transformer. `@expo/metro-config` is
// nested under `expo/node_modules`, so resolve it from there rather than by bare name.
const path = require('path');
const inner = require(require.resolve('@expo/metro-config/babel-transformer', {
  paths: [path.dirname(require.resolve('expo/package.json'))],
}));
exports.transform = (args) => inner.transform(args.filename.endsWith('.md')
  ? { ...args, src: `export default ${JSON.stringify(args.src)};` } : args);
exports.getCacheKey = inner.getCacheKey;
