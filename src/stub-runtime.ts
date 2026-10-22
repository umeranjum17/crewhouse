import type { AgentRuntime, RunEnd, RunEvent, RunSpec, ToolHost } from './runtime.ts';

function calls(text: string) {
  const found: { name: string; input: Record<string, unknown> }[] = [];
  for (const match of text.matchAll(/\[tool (\w+) \{/g)) {
    const from = match.index + match[0].length - 1;
    let depth = 0, quoted = false, escaped = false, end = from;
    for (; end < text.length; end++) {
      const c = text[end];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) break;
    }
    found.push({ name: match[1], input: JSON.parse(text.slice(from, end + 1)) });
  }
  return found;
}

const GOLDEN: Record<string, string> = {
  hi: 'Hi. What would you like to work on?',
  'how do i pair my computer with you?': 'Open Add a phone on your computer and scan its code with your phone.',
  'i want to market my app': 'I can help market it. Send the site so I can see the product and audience before drafting a plan.',
  'https://trymuxr.com/': 'muxr lets developers manage coding agents from their phone. I’ll map the audience, focus on developer communities and founder posts, then ask Research Rae and Writer Will for first drafts. Nothing will be posted.',
  'I need someone to sort out my invoices': `I'll take on someone to keep your invoices in order. [tool crew_create {"name": "Invoice Ivy", "role": "Keeps your invoices in order", "job": {"does": "Sorts your invoices: who sent each, how much, when it is due, and whether it is paid.", "aim": "Nothing you owe slips past its due date.", "gets": "Invoices you share or point to.", "how": "Reads each invoice, puts it in one sheet by due date and flags what is due soon.", "great": "One sheet you can trust at a glance; for example, two due this week, flagged first."}, "personality": "You are Invoice Ivy. Tidy, calm and quick with numbers.", "first": "Sort out my invoices"}]`,
  'Sort out my invoices': `Your invoices are in one sheet by due date: two are due this week. [tool crew_workbook {"name": "Your invoices", "sheets": [{"name": "Invoices", "columns": [{"header": "From"}, {"header": "Amount"}, {"header": "Due"}, {"header": "Paid?", "options": ["Yes", "No"]}], "rows": [["Water board", 42.5, "Oct 8", "No"], ["Dentist", 120, "Oct 10", "No"], ["Phone", 35, "Oct 21", "Yes"]]}]}]`,
  'I need someone to keep track of my subscriptions': `Invoice Ivy already keeps your invoices in order, so I'll ask Invoice Ivy to take this on too. [tool crew_create {"bot": "invoice-ivy", "role": "Keeps your invoices and subscriptions in order", "job": {"does": "Sorts your invoices and subscriptions: who charges you, how much, when it is due or renews, and whether it is paid.", "aim": "Nothing you owe or renew slips past you.", "gets": "Invoices and subscription emails you share or point to.", "how": "Reads each one, keeps them in one sheet by date and flags what is due or renewing soon.", "great": "One sheet you can trust at a glance; for example, a renewal next week, flagged first."}, "first": "Keep track of my subscriptions"}]`,
  'Keep track of my subscriptions': `Your subscriptions are in one sheet by renewal date: one renews next week. [tool crew_workbook {"name": "Your subscriptions", "sheets": [{"name": "Subscriptions", "columns": [{"header": "Service"}, {"header": "Price"}, {"header": "Renews"}, {"header": "Every", "options": ["Month", "Year"]}], "rows": [["Music", 10.99, "Oct 12", "Month"], ["Cloud storage", 2.99, "Oct 30", "Month"], ["News", 79, "Feb 3", "Year"]]}]}]`,
  'From now on, Invoice Ivy should look after my warranty receipts too': `Invoice Ivy already keeps your invoices in order, so from now on Invoice Ivy keeps your warranty receipts too: what you bought, when, and until when it is covered. [tool crew_create {"bot": "invoice-ivy", "role": "Keeps your invoices and warranty receipts in order", "job": {"does": "Sorts your invoices and warranty receipts: who sent each, how much, when it is due or paid, and until when a purchase is covered.", "aim": "Nothing you owe slips past its due date, and no warranty runs out unnoticed.", "gets": "Invoices and receipts you share or point to.", "how": "Reads each one, keeps invoices by due date and receipts by warranty end, and flags what is due or running out soon.", "great": "Two sheets you can trust at a glance; for example, a washing machine whose cover ends next month, flagged first."}, "first": "Sort my warranty receipts"}]`,
  'Sort my warranty receipts': `Your warranty receipts are in one sheet by when the cover ends: the washing machine's runs out next month. [tool crew_workbook {"name": "Your warranties", "sheets": [{"name": "Warranties", "columns": [{"header": "Item"}, {"header": "Bought"}, {"header": "Price"}, {"header": "Covered until"}], "rows": [["Washing machine", "Nov 2024", 499, "Nov 2026"], ["Laptop", "Mar 2025", 1199, "Mar 2027"], ["Headphones", "Jul 2026", 149, "Jul 2028"]]}]}]`, 'Please remember this for me: I prefer weekend plans before Thursday.': 'Noted — I’ll keep that in mind. [tool crew_profile {"text":"Prefers weekend plans before Thursday"}]',
  '• ⟦LOCI315: reply needed by Oct 8⟧ — ⟦Bank <alerts@bank.example>⟧ (https://mail.google.com/mail/u/0/#inbox/18c0000000000011)':'Bank replied about LOCI315: they forwarded your insurance questions to the relevant team and need a reply by Oct 8. The policy expiry we have is October 23; October 8 is the deadline for the independent policy, which the bank has not confirmed. Confirm the cover there: https://mail.google.com/mail/u/0/#inbox/18c0000000000011 [tool crew_case {"thread": "18c0000000000011", "facts": "LOCI315, reply by Oct 8, expiry Oct 23, confirmed: nothing yet"}]',
  '• ⟦LOCI315: reply needed by Oct 8⟧ — ⟦Bank <alerts@bank.example>⟧ (https://mail.google.com/mail/u/0/#inbox/18c0000000000011) — a case you hold: ⟦LOCI315, reply by Oct 8, expiry Oct 23, confirmed: nothing yet⟧':'Bank has now confirmed the LOCI315 cover until October 23. October 8 stays the deadline you hold for the independent policy; the premium is still not confirmed. Read the confirmation: https://mail.google.com/mail/u/0/#inbox/18c0000000000011 [tool mail {"args": ["read", "18c0000000000011"]}] [tool crew_case {"thread": "18c0000000000011", "facts": "LOCI315, cover confirmed until Oct 23, deadline Oct 8, confirmed: cover, not premium"}]', '• ⟦LOCI315: reply needed by Oct 8⟧ — ⟦Bank <alerts@bank.example>⟧ (https://mail.google.com/mail/u/0/#inbox/18c0000000000011) — a case you hold: ⟦LOCI315, cover confirmed until Oct 23, deadline Oct 8, confirmed: cover, not premium⟧': 'ALL-CLEAR', '• ⟦LOCI315: cover confirmed⟧ — ⟦Bank <alerts@bank.example>⟧ (https://mail.google.com/mail/u/0/#inbox/18c0000000000013) — cases you hold with this sender: ⟦LOCI315, cover confirmed until Oct 23, deadline Oct 8, confirmed: cover, not premium⟧': 'Bank confirmed the LOCI315 cover until October 23 on this new thread too. October 8 stays the deadline you hold; the premium is still not confirmed.', '• ⟦LOCI400: reply needed by Nov 2⟧ — ⟦Bank <alerts@bank.example>⟧ (https://mail.google.com/mail/u/0/#inbox/18c0000000000015) — cases you hold with this sender: ⟦LOCI315, cover confirmed until Oct 23, deadline Oct 8, confirmed: cover, not premium⟧': 'Bank has a new case, LOCI400: reply by Nov 2, nothing confirmed yet. [tool crew_case {"thread": "18c0000000000015", "facts": "LOCI400, reply by Nov 2, confirmed: nothing yet"}]', '• ⟦Your monthly statement is ready⟧ — ⟦Bank <alerts@bank.example>⟧ (https://mail.google.com/mail/u/0/#inbox/18c0000000000016) — cases you hold with this sender: ⟦LOCI400, reply by Nov 2, confirmed: nothing yet⟧ ⟦LOCI315, cover confirmed until Oct 23, deadline Oct 8, confirmed: cover, not premium⟧': 'ALL-CLEAR', '• ⟦Daily headlines⟧ — ⟦News <news@news.example>⟧ (https://mail.google.com/mail/u/0/#inbox/18c0000000000012)':'ALL-CLEAR [tool crew_case {"thread": "18c0000000000011", "facts": "mis-copied thread"}]',
  '• ⟦LOCI500: reply needed by Dec 1⟧ — ⟦Bank  <alerts@bank.example>⟧ (https://mail.google.com/mail/u/0/#inbox/18c0000000000017) — cases you hold with this sender: ⟦LOCI400, reply by Nov 2, confirmed: nothing yet⟧': 'Bank has a new case, LOCI500: reply by Dec 1, nothing confirmed yet. [tool crew_case {"thread": "18c0000000000017", "facts": "LOCI500, reply by Dec 1, confirmed: nothing yet"}]',};

/** Fast product-rule fixture. Security/engine acceptance runs the actual pinned Gateway on the HTTP stub (src/stub.ts).
 *  All state is per instance: tests run several crews side by side with the same session keys. */
export class StubRuntime implements AgentRuntime {
  readonly identity = { name: 'Stub', version: 'scripted' };
  private host?: ToolHost;
  private holds = new Map<string, (reply?: string) => void>();
  private cancelled = new Set<string>();
  private tired = new Map<string, Set<string>>(); // "hit every limit": each account rests once on that key, two minutes
  private transcripts = new Map<string, string>();
  private specs = new Map<string, RunSpec>();
  private steered = new Map<string, string>();
  holding(key: string) { return this.holds.has(key); }
  release(key: string, reply?: string) { this.holds.get(key)?.(reply); this.holds.delete(key); }
  /** What the run's tools said, in order: the run's own view of its work (tests read it; no session file exists). */
  transcript(key: string) { return this.transcripts.get(key) ?? ''; }
  /** The last RunSpec a key ran with: what the model actually saw (tests read it; no session file exists). */
  specOf(key: string) { return this.specs.get(key); }
  /** The last steer a key was given (tests read it; the engine keeps the conversation itself). */
  steerOf(key: string) { return this.steered.get(key); }
  async start(host: ToolHost) { this.host = host; }
  async stop() { this.host = undefined; this.holds.clear(); this.transcripts.clear(); this.specs.clear(); this.steered.clear(); this.cancelled.clear(); this.tired.clear(); }
  // Grok stands in for an account that must be signed in first; the rest the person has.
  async signedIn(account: string) { return account !== 'grok'; }
  signIn(_account: string, via: 'browser' | 'code', on: (step: any) => void) {
    // Grok stands in for an account that must be signed in first: the code shows, then it succeeds.
    if (via === 'code') on({ waiting: true, code: 'CREW-2026', url: 'https://example.test/xai/device' });
    const timer = setTimeout(() => on({ waiting: false, done: true }), 100);
    return { paste: () => {}, cancel: () => { clearTimeout(timer); on({ waiting: false, error: 'The sign-in was cancelled.' }); } };
  }
  async signOut() {}
  async composioBegin() { return { url: 'https://connect.composio.dev/oauth/authorize?stub=1' }; }
  async composioDone() {}
  async composioSignOut() {}
  async models(account: string) { return ['grok', 'opencode-go'].includes(account) ? [] : [{ id: 'strong-1', name: 'Strong 1' }, { id: 'quick-1', name: 'Quick 1' }]; }
  async run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd> {
    if (!this.host) throw new Error('Stub not started');
    this.specs.set(spec.key, spec); on({ type: 'started' });
    const said = spec.message;
    let result = '';
    const last = said.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('[Crewhouse')).at(-1) ?? '', scripted = process.env.CREWHOUSE_STUB_GOLDEN ? GOLDEN[last.replace(/^The person says: /, '')] : undefined, seen = calls(said + (scripted ?? ''));
    if (spec.bot === 'chief' && /\[first words\]/.test(said)) on({ type: 'text', text: 'I’ll start by checking the next step.' });
    for (const { name, input } of seen) {
      on({ type: 'tool', name, phase: 'start' });
      const gate = await this.host.gate(spec, name, input);
      if (!gate.allow) { result = gate.reason; continue; }
      result = await this.host.call(spec, name, input, new AbortController().signal);
      on({ type: 'tool', name, phase: 'end' });
      this.transcripts.set(spec.key, `${this.transcript(spec.key)}${name}: ${result}\n`);
    }
    if (/link is down/i.test(said)) return { ok: false, kind: 'network', message: 'fetch failed' };
    const every = /hit every limit/i.test(said) ? this.tired.set(spec.key, new Set()).get(spec.key) : this.tired.get(spec.key);
    if (/hit the limit/i.test(said) && spec.account === 'chatgpt' || every && !every.has(spec.account) && every.add(spec.account))
      return { ok: false, kind: 'resting', message: 'You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.', until: Date.now() + (every ? 120_000 : 1_800_000) };
    if (/no helpers in plan/i.test(said) && spec.account === 'chatgpt')
      return { ok: false, kind: 'plan', message: "Your plan doesn't include this model." };
    if (/sign me out/i.test(said)) return { ok: false, kind: 'signed-out', message: '401 Unauthorized: your sign-in has expired' };
    let text = result ? `stub ${spec.bot}: ${seen.at(-1)?.name} said ${result.slice(0, 300)}` : `stub ${spec.bot}: done with "${last.slice(0, 60)}"`;
    if (/\[two-fare-backtest\]/.test(said))
      text = 'I recommend the lower fare from Fareboard. I checked Fareboard and Narrowfare; I didn\'t check baggage fees or live inventory.';
    text = scripted?.replace(/\s*\[tool [\s\S]*$/, '') ?? (process.env.CREWHOUSE_STUB_GOLDEN && !result ? '' : text); // golden: unscripted gets no reply
    if (/ask permission/i.test(said)) {
      text = await new Promise<string>((resolve) => { on({ type: 'thinking' }); this.holds.set(spec.key, (reply) => resolve(reply ?? text)); });
      if (this.cancelled.delete(spec.key)) return { ok: false, aborted: true }; // stopped on purpose, not finished
    }
    on({ type: 'usage', tokens: Math.max(1, Math.round((said.length + text.length) / 4)) });
    on({ type: 'text', text });
    return { ok: true, text };
  }
  async steer(key: string, text: string) { this.steered.set(key, text); }
  async abort(key: string) { this.cancelled.add(key); this.release(key); }
  async learned() { return []; }
  async forget(_id: string) {}
  async setLearning() {}
}
