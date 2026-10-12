export type QueueWho = 'you' | 'chief';
export type QueueLine = { who: QueueWho; text: string; rid?: string; queued?: boolean;
  stopped?: boolean; retry?: string; retryRid?: string; interrupted?: boolean };
export type QueueTurn = { rid: string; text: string };
export type QueueHistory = { who: QueueWho; text: string };

export function pendingOf(lines: QueueLine[]): QueueTurn[] {
  return lines
    .filter((l): l is QueueLine & { rid: string } => l.who === 'you' && l.queued === true && typeof l.rid === 'string' && l.rid.length > 0)
    .map((l) => ({ rid: l.rid, text: l.text }));
}

export function historyOf(lines: QueueLine[], rid: string, text: string): QueueHistory[] {
  const out: QueueHistory[] = [];
  for (const l of lines) {
    if (l.stopped || l.queued || (l.who === 'you' && l.rid === rid)) continue;
    out.push({ who: l.who, text: l.text });
  }
  out.push({ who: 'you', text });
  return out;
}

export function clearRetryOf(lines: QueueLine[], retryRid: string): QueueLine[] {
  return lines.map((l) => (l.stopped && l.who === 'chief' && l.retryRid === retryRid
    ? { ...l, retry: undefined, interrupted: undefined }
    : l));
}

export function failOffOf(lines: QueueLine[], rid: string, retryText: string): QueueLine[] {
  const mapped = lines.map((l) => {
    if (l.rid === rid && l.who === 'you') return { ...l, queued: false, stopped: true };
    if (l.rid === rid && l.queued) return { ...l, queued: false };
    return l;
  });
  return [...mapped, { who: 'chief', text: 'Stopped.', stopped: true, retry: retryText, retryRid: rid }];
}

export function retrySuffix(line: QueueLine): boolean {
  return line.interrupted === true && line.retry != null;
}

export async function drainPending(
  pending: QueueTurn[],
  run: (turn: QueueTurn) => Promise<boolean>,
): Promise<{ sent: number; remaining: QueueTurn[] }> {
  let sent = 0;
  for (const turn of pending) {
    if (!(await run(turn))) break;
    sent++;
  }
  return { sent, remaining: pending.slice(sent) };
}
