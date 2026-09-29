// The Studio's floor plan: one 2:1 isometric room on a 1000 × 690 stage. scripts/office.mjs draws the still room
// from it into mobile/assets/office/, and mobile/src/office.tsx stands the crew in it, so the two never drift apart.
export const STAGE = { w: 1000, h: 690 };
export const HW = 44, HH = 22, OX = 412, OY = 185, GX = 13, GY = 9, WALL = 172;
/** A floor point (grid x, grid y, height) on the stage. */
export const P = (gx: number, gy: number, z = 0): [number, number] => [OX + (gx - gy) * HW, OY + (gx + gy) * HH - z];
/** Painter's order: further forward draws later. */
export const depth = (gx: number, gy: number, bias = 0) => Math.round(100 + (gx + gy) * 20 + bias);
/** Desk centres in the order helpers take them: four under the windows, each with a partition in its colour, then
 *  two on the floor (the first takes the sofa's place). */
export const SLOTS: [number, number][] = [[2.6, 2.0], [5.4, 2.0], [8.2, 2.0], [11.0, 2.0], [3.0, 5.3], [6.6, 8.0]];
export const WALLED = 4;
/** Where a helper stands: behind its desk, to the left. */
export const standAt = ([cx, cy]: [number, number]): [number, number] => [cx - 1.1, cy - 0.95];
/** Chief's armchair on the raised nook by the door (his feet sit `CHIEF_LIFT` up, on the platform). */
export const CHIEF: [number, number] = [1.25, 7.45];
export const CHIEF_LIFT = 26;
export const TRAY: [number, number] = [10.0, 7.6];
