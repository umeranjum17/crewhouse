export function sandbox(): { ok: true } | { ok: false; cause: string; next: string; fixable?: boolean };
export function wallDown(): string;
export function piBuiltIn(repo: string): string[];
export const CEILING_MB: number;
export function bus(): { XDG_RUNTIME_DIR: string };
export function piRoom(unit: string): string[];
export function roomFull(unit: string): Promise<boolean>;
export function piWall(paths: { folder: string; home: string; repo: string; extensions: string[]; door: string }): string[];
