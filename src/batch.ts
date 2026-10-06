// Batch research: one helper fans a single question out over many items in parallel, then merges the answers
// into one spreadsheet with crew_workbook. Each item runs as its own engine session for the same task,
// so the gate and the account failover apply unchanged — there is no new agent loop here.
export const MAX_PARALLEL = 8;
export const MAX_ITEMS = 24;

export type BatchAnswer = { item: string; ok: boolean; text: string };

/** The one-shot prompt each item runs with: the shared question, told to answer small (the parent merges the rows). */
export function subMessage(question: string, item: string) {
  return `[Crewhouse] Research this one item and nothing else: ${item}\n${question}\n` +
    'Answer in a few short lines, each claim with its source. End with one line "Sources: ..." naming the pages you read.';
}

