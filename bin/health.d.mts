export function health(cfg: { stateDir: string; port: number; engine: string }): Promise<{ what: string; cause: string; next: string }[]>;
export function databaseProblem(stateDir: string): { what: string; cause: string; next: string } | null;
export function portProblem(cfg: { stateDir: string; port: number }): Promise<{ what: string; cause: string; next: string } | null>;
export function engineFolderProblem(cfg: { stateDir: string; engine: string }): { what: string; cause: string; next: string } | null;
