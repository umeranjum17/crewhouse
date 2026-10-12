// Markdown templates bundled as text (metro in the app, the loader hook in test/expo-hooks.mjs under node).
declare module '*.md' {
  const text: string;
  export default text;
}
