// Shared web/phone values; styles.css mirrors these as custom properties.
export const color = {
  day: {
    bg: '#FAF9F7', surface: '#FFFFFF', sunken: '#F3F1EE', line: '#E7E4DF', line2: '#D9D5CF',
    ink: '#1B1A1F', ink2: '#56525D', mute: '#8B8792', accent: '#1B1A1F', onAccent: '#FFFFFF',
    pink: '#D23369', green: '#1E9A58', amber: '#B86E00', danger: '#C4372C',
    // a spreadsheet's cells: soft yellow for what the person fills in, soft blue for what works itself out
    cellIn: '#FFEFB8', cellCalc: '#DAE8FB',
  },
  night: {
    bg: '#111014', surface: '#1A191E', sunken: '#151418', line: '#2A2830', line2: '#36333D',
    ink: '#F1EFEA', ink2: '#ABA7B1', mute: '#78747E', accent: '#F1EFEA', onAccent: '#111014',
    pink: '#FF6B9A', green: '#4BD08A', amber: '#F2B04B', danger: '#FF6B5E',
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
export const font = { ui: "'Inter', system-ui, sans-serif", art: "'JetBrains Mono', ui-monospace, monospace" };
/** The office room's flat colours (web/src/office.tsx, mobile/src/office.tsx): one room, day and night. */
export const room = {
  // B1: a paper room drawn in one ink line (desks, sofa and monitor are white or pastel with an ink edge, a night window).
  day: { wall: '#F3F5FA', stripe: '#F3F5FA', skirt: '#141A2A', floor: '#E9ECF3', seam: '#E9ECF3', desk: '#FFFFFF', top: '#141A2A', edge: '#141A2A',
    bezel: '#141A2A', screen: '#FFF3C8', sofa: '#ECE6FF', sofaDark: '#141A2A', window: '#1D2A55', frame: '#141A2A', leaf: '#141A2A', pot: '#FFFFFF' },
  // No B1 night palette was designed: the same shapes, with the app's night contrast (light ink on a dark room).
  night: { wall: '#1F1C2B', stripe: '#1F1C2B', skirt: '#C9C4DA', floor: '#2A2638', seam: '#2A2638', desk: '#2C2839', top: '#C9C4DA', edge: '#C9C4DA',
    bezel: '#C9C4DA', screen: '#4A4532', sofa: '#3A3456', sofaDark: '#C9C4DA', window: '#0F1631', frame: '#C9C4DA', leaf: '#C9C4DA', pot: '#2C2839' },
};
