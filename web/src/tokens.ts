// Design tokens for direction C, "Pocket Pals", with A's night mode. Plain values so the Expo app imports this
// file unchanged; web/src/styles.css mirrors them as CSS variables.
export const color = {
  day: {
    ink: '#2e2a40', ink2: '#4d4760', mute: '#7a7490', card: '#ffffffd9', solid: '#ffffff', line: '#eee6f6', soft: '#f8f4fc',
    pink: '#ff7aa2', pinkInk: '#e2487a', peach: '#ffb199', amber: '#ffc27a', sky: '#a9cbff', mint: '#b5ecc4', lilac: '#d9c2ff',
    ok: '#3ccf7e', okInk: '#239a5c', wait: '#ffae3c', bg: '#fff7f2',
  },
  // A · Night Shift: ink #0d0b14, phosphor, amber, pink, violet.
  night: {
    ink: '#efe9dc', ink2: '#cfc8dc', mute: '#8a83a3', card: '#1d1929e6', solid: '#15121f', line: '#2e2842', soft: '#221d31',
    pink: '#ff5f87', pinkInk: '#ff7aa2', peach: '#ff8a5c', amber: '#ffb45c', sky: '#6aa8ff', mint: '#8dffc0', lilac: '#b58cff',
    ok: '#8dffc0', okInk: '#8dffc0', wait: '#ffb45c', bg: '#0d0b14',
  },
};
export const radius = { chip: 999, card: 24, sheet: 32, icon: 14 };
export const font = {
  // Nunito for everything people read. The mono face draws ASCII art only, never text to read.
  ui: "'Nunito', ui-rounded, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  art: "'JetBrains Mono', ui-monospace, monospace",
};
/** The splash banner's gradient, amber → pink → violet. */
export const bannerStops = ['#ffb45c', '#ff5f87', '#b58cff'];
