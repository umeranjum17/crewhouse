export type QueueWho = 'you' | 'chief';
// Doc is the caller's document card type (PhoneDocument in the app, unknown in tests): generic so the pure
// module keeps no expo or react-native imports yet the app's typed lines flow through unchanged.
export type QueueLine<Doc = unknown> = { who: QueueWho; text: string; rid?: string; queued?: boolean;
  stopped?: boolean; retry?: string; retryRid?: string; interrupted?: boolean; doc?: Doc };
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

export function clearRetryOf<Doc>(lines: QueueLine<Doc>[], retryRid: string): QueueLine<Doc>[] {
  return lines.filter((l) => !(l.stopped && l.who === 'chief' && l.retryRid === retryRid));
}

export function failOffOf<Doc>(lines: QueueLine<Doc>[], rid: string, retryText: string): QueueLine<Doc>[] {
  const mapped = lines.map((l) => {
    if (l.rid === rid && l.who === 'you') return { ...l, queued: false, stopped: true };
    return l;
  });
  const kept = mapped.filter((l) => !(l.stopped && l.who === 'chief' && l.retryRid === rid));
  return [...kept, { who: 'chief', text: 'Stopped.', stopped: true, retry: retryText, retryRid: rid }];
}

export function retrySuffix(line: QueueLine): boolean {
  return line.interrupted === true && line.retry != null;
}

export type StoredRecord<Doc = unknown> = { t: string; text: string; rid?: string; queued?: boolean; doc?: Doc };

export function replayChat<Doc>(records: StoredRecord<Doc>[], isInterrupted: (rid: string) => boolean): QueueLine<Doc>[] {
  const lines: QueueLine<Doc>[] = [];
  let open: { text: string; rid?: string; queued: boolean } | null = null;
  let userAt = -1;
  const cutOff = () => {
    if (!open) return;
    const { text, rid, queued } = open;
    if (queued) { if (lines[userAt]) lines[userAt].queued = true; }
    else {
      if (lines[userAt]) lines[userAt].stopped = true;
      const interrupted = !!rid && isInterrupted(rid);
      lines.push({ who: 'chief', text: interrupted ? 'Interrupted.' : 'Stopped.', stopped: true, retry: text, retryRid: rid, interrupted });
    }
    open = null; userAt = -1;
  };
  for (const r of records) {
    if (typeof r.text !== 'string') continue;
    const rid = typeof r.rid === 'string' ? r.rid : undefined;
    if (r.t === 'you' && rid && open && open.rid === rid) { open.queued = r.queued === true; open.text = r.text; continue; }
    if (r.t === 'you') { cutOff(); lines.push({ who: 'you', text: r.text, rid }); open = { text: r.text, rid, queued: r.queued === true }; userAt = lines.length - 1; }
    else if (r.t === 'chief' && open) { lines.push({ who: 'chief', text: r.text, doc: r.doc }); open = null; userAt = -1; }
  }
  cutOff();
  let out: QueueLine<Doc>[] = lines;
  const seen = new Set<string>();
  for (let i = out.length - 1; i >= 0; i--) {
    const l = out[i];
    if (l.who === 'you' && l.rid) seen.add(l.rid);
    if (l.stopped && l.who === 'chief' && l.retryRid && seen.has(l.retryRid)) out = clearRetryOf(out, l.retryRid);
  }
  return out;
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

/** The phone-only chat as one message to Chief on the computer: who said what, in order, as Chief on the phone heard
 *  it (no stopped or queued turns), a document as its title only. One line per turn: the thread folds blank lines.
 *  Past `max` characters the oldest turns go, said so. */
export function transcriptOf(lines: QueueLine<{ name: string }>[], max = 40_000): string {
  const turns = lines.filter((l) => !l.stopped && !l.queued).map((l) => `${l.who === 'you' ? 'You' : 'Chief'}: ${
    [l.text.trim(), l.doc && `(Chief made a document here, ${l.doc.name}. The file stays on my phone.)`].filter(Boolean).join('\n')}`);
  let left = false;
  while (turns.length > 1 && turns.join('\n').length > max) { turns.shift(); left = true; }
  const said = turns.join('\n');
  return ["I'm continuing our chat from my phone. Here is what we said there:", left && '(Earlier turns left out.)',
    said.length > max ? `…${said.slice(-max)}` : said, 'Please carry on from here.'].filter(Boolean).join('\n');
}
