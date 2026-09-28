// Each AI account's mark as a PNG (made from web/src/logos.ts by `node scripts/icons.mjs`); Metro needs literal requires.
export const MARKS: Record<string, number> = {
  chatgpt: require('../assets/ai/chatgpt.png'),
  grok: require('../assets/ai/grok.png'),
  copilot: require('../assets/ai/copilot.png'),
  openrouter: require('../assets/ai/openrouter.png'),
  minimax: require('../assets/ai/minimax.png'),
  claude: require('../assets/ai/claude.png'),
};
