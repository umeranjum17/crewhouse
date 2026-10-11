// Bundle the Chief's actual template files as words, never downloaded code.
const transformer = require('@expo/metro-config/babel-transformer');
exports.transform = (args) => transformer.transform(args.filename.endsWith('.md')
  ? { ...args, src: `export default ${JSON.stringify(args.src)};` } : args);
