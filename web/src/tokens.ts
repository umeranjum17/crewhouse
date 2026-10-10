// Shared web/phone values; styles.css mirrors these as custom properties.
// The Term look: muxr paper by day, dark canvas by night, one blue accent (no coral).
export const color = {
  day: {
    bg: '#F3EEE3', surface: '#EBE5D7', sunken: '#E0D7C0', line: '#D3C9B0', line2: '#BDB096',
    ink: '#1D1B18', ink2: '#575046', mute: '#6B665D', accent: '#3D6FD6', onAccent: '#FFFFFF',
    // The one blue accent, text-safe on paper wherever it is text on paper
    pink: '#3D6FD6', fill: '#3D6FD6', softAccent: '#DBE6F8', green: '#1C9F63', amber: '#B86E00', danger: '#C4372C',
    // a spreadsheet's cells: soft yellow for what the person fills in, soft blue for what works itself out
    cellIn: '#FFEFB8', cellCalc: '#DAE8FB',
  },
  night: {
    bg: '#0C0C0B', surface: '#131312', sunken: '#060605', line: '#262625', line2: '#3A3A38',
    ink: '#ECECEC', ink2: '#C9C9C5', mute: '#9B9B98', accent: '#0A84FF', onAccent: '#FFFFFF',
    pink: '#0A84FF', fill: '#0A84FF', softAccent: '#16283F', green: '#30D158', amber: '#F2B04B', danger: '#FF6B5E',
    cellIn: '#3A3118', cellCalc: '#1B2B42',
  },
};
export const spacing = [4, 8, 12, 16, 20, 24, 32, 48] as const;
export const radius = { control: 10, card: 14, sheet: 20, pill: 999 };
export const type = {
  display: [28, 34, 600], title: [22, 28, 600], headline: [17, 24, 600], body: [15, 22, 400],
  rowTitle: [15, 22, 500], small: [13, 18, 400], label: [12, 16, 500], micro: [11, 14, 500],
} as const;
export const motion = { fast: 120, base: 200, slow: 280, exit: 160 };
export const font = { ui: "'Inter', system-ui, sans-serif", serif: "'Inter', system-ui, sans-serif", art: "'JetBrains Mono', ui-monospace, monospace" };
