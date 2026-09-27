// Shared web/phone values; styles.css mirrors these as custom properties.
export const color = {
  day: {
    bg: '#FAF9F7', surface: '#FFFFFF', sunken: '#F3F1EE', line: '#E7E4DF', line2: '#D9D5CF',
    ink: '#1B1A1F', ink2: '#56525D', mute: '#8B8792', accent: '#1B1A1F', onAccent: '#FFFFFF',
    pink: '#D23369', green: '#1E9A58', amber: '#B86E00', danger: '#C4372C',
  },
  night: {
    bg: '#111014', surface: '#1A191E', sunken: '#151418', line: '#2A2830', line2: '#36333D',
    ink: '#F1EFEA', ink2: '#ABA7B1', mute: '#78747E', accent: '#F1EFEA', onAccent: '#111014',
    pink: '#FF6B9A', green: '#4BD08A', amber: '#F2B04B', danger: '#FF6B5E',
  },
};
export const spacing = [4, 8, 12, 16, 20, 24, 32, 48] as const;
export const radius = { control: 10, card: 14, sheet: 20, pill: 999 };
export const type = {
  display: [28, 34, 600], title: [22, 28, 600], headline: [17, 24, 600], body: [15, 22, 400],
  rowTitle: [15, 22, 500], small: [13, 18, 400], label: [12, 16, 500], micro: [11, 14, 500],
} as const;
export const motion = { fast: 120, base: 200, slow: 280, exit: 160 };
export const font = { ui: "'Inter', system-ui, sans-serif", art: "'JetBrains Mono', ui-monospace, monospace" };
