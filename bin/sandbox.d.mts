export function sandbox(): { ok: true } | { ok: false; cause: string; next: string; fixable?: boolean };
export function wallDown(): string;
export function piRefusal(repo: string): string;
export function piWall(paths: { folder: string; home: string; repo: string; extensions: string[] }): string[];
