export function health(cfg: { stateDir: string; port: number; engine: string }): Promise<{ what: string; cause: string; next: string }[]>;
export function databaseProblem(stateDir: string): { what: string; cause: string; next: string } | null;
