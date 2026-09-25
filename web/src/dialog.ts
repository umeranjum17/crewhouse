// One dialog owns the keyboard while it's open: focus starts inside, Tab stays inside, Escape leaves, and when the
// dialog closes, focus goes back to whatever had it before. The move itself is decided here, framework-free, so it
// can be checked without a browser; web/src/parts.tsx's useDialogOwn does the focusing.
export type Focused = { focus(): void };

/** Where Tab moves next among the dialog's focusable elements, wrapping at the ends. When the focus isn't in the list
 *  (the dialog itself, or nothing yet), Tab in goes to the first and Shift+Tab to the last. */
export function cycle(list: Focused[], now: Focused | null, back = false): Focused | null {
  if (!list.length) return null;
  const i = now ? list.indexOf(now) : -1;
  if (i < 0) return list[back ? list.length - 1 : 0];
  return list[(i + (back ? -1 : 1) + list.length) % list.length];
}
