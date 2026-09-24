// Design tokens from the Crewhouse board. Plain values so the Expo app can import this file unchanged.
export const color = {
  paper: '#F7F4EF', soft: '#FAF8F4', card: '#FFFFFF', line: '#EAE4DA', line2: '#F2EDE6',
  ink: '#1E1A16', ink2: '#5C554C', ink3: '#958C80',
  sea: '#1F6F66', sea2: '#175A52', seaSoft: '#E0EFEB', seaLine: '#BFDDD6',
  amber: '#AD5F0A', amberSoft: '#FFF1DA', amberLine: '#F1D5A7',
  green: '#2C774A', greenSoft: '#E3F2E8', blue: '#3355C2', blueSoft: '#E8EDFB', red: '#B1382B', redSoft: '#FBE6E2',
};
export const radius = { sm: 10, md: 14, lg: 20, xl: 28 };
export const font = {
  display: "'Fraunces', ui-serif, Georgia, 'Times New Roman', serif",
  ui: "'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};
/** Plain words for states; the UI never shows internal names. */
export const stateWords: Record<string, string> = {
  queued: 'Waiting its turn', working: 'Working', needs_you: 'Needs you', done: 'Done', failed: 'Stopped',
  off: 'Resting', idle: 'Ready', blocked: 'Needs you', unknown: 'Working',
};
