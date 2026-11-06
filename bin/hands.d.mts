export type Hands = {
  where: string;
  shell: (input: { command?: unknown }, signal?: AbortSignal) => Promise<unknown>;
  browser: (args: string[], signal?: AbortSignal, cap?: number) => Promise<string>;
};
export function handsOf(far: unknown, root: string, here: Omit<Hands, 'where'>): Hands;
