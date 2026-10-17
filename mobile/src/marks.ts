// Each AI account's mark as a PNG (made from web/src/logos.ts by `node scripts/icons.mjs`); Metro needs literal requires.
export const MARKS: Record<string, number> = {
  chatgpt: require('../assets/ai/chatgpt.png'),
  grok: require('../assets/ai/grok.png'),
  copilot: require('../assets/ai/copilot.png'),
  openrouter: require('../assets/ai/openrouter.png'),
  minimax: require('../assets/ai/minimax.png'),
  claude: require('../assets/ai/claude.png'),
  'opencode-go': require('../assets/ai/opencode-go.png'),
};
// The first screen's marks (mock C, made by `node scripts/icons.mjs`): line marks in white, tinted on screen, and Chief's
// critter in each look.
export const WHERE = {
  cloud: require('../assets/where/cloud.png'),
  computer: require('../assets/where/computer.png'),
  phone: require('../assets/where/phone.png'),
  shield: require('../assets/where/shield.png'),
  'chief-day': require('../assets/where/chief-day.png'),
  'chief-night': require('../assets/where/chief-night.png'),
};
