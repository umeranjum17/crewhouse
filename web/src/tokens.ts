// Shared web/phone values; styles.css mirrors these as custom properties.
// The Stack look (design C): a warm grey ground by day, black by night, one blue accent (no coral).
export const color = {
  day: {
    bg: '#F4F3EF', surface: '#FFFFFF', sunken: '#E6E4DE', line: '#D9D7D0', line2: '#C4C2BA',
    ink: '#0B0B0B', ink2: '#3D3C38', mute: '#5F5E59', accent: '#3D6FD6', onAccent: '#FFFFFF',
    // The one blue accent, text-safe on paper wherever it is text on paper
    pink: '#3D6FD6', fill: '#3D6FD6', softAccent: '#DBE6F8', green: '#1C9F63', amber: '#B86E00', danger: '#C4372C',
    // a spreadsheet's cells: soft yellow for what the person fills in, soft blue for what works itself out
    cellIn: '#FFEFB8', cellCalc: '#DAE8FB',
  },
  night: {
    bg: '#000000', surface: '#141414', sunken: '#1F1F1F', line: '#262626', line2: '#3A3A38',
    ink: '#F4F3EF', ink2: '#C9C9C5', mute: '#8E8D88', accent: '#0A84FF', onAccent: '#FFFFFF',
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
