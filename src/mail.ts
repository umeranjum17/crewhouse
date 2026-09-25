// mail-axi: the person's own Gmail, read-only, as one small command-shaped tool in place of Google's hosted Gmail MCP
// server (23 tool schemas, about 8,900 tokens on every turn). crewd runs it on the member's Gmail connection
// (`gmail.readonly`): the token never leaves crewd, and nothing here can send, change or delete mail.
import { axiTool } from './engine.ts';
import { options, table } from './calendar.ts';

export const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

const HELP = [
  'mail                               unread count and the newest in the inbox',
  'mail search "<gmail query>" [--limit 10]   e.g. from:school newer_than:7d',
  'mail read <id> [--full]            a conversation: who wrote, and the latest message',
];
const CUT = 1500, FULL = 8000;
type Token = () => Promise<string | null>;

async function get(token: Token, path: string) {
  const t = await token();
  if (!t) throw new Error('Gmail is not connected any more. Ask the person to connect it again (crew_connect).');
  const res = await fetch(`${GMAIL}${path}`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new Error('No such conversation. Search again for its id.');
  if (!res.ok) throw new Error(`Gmail said ${res.status}. Try again in a moment.`);
  return res.json() as Promise<any>;
}

const header = (m: any, name: string) => String(m?.payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '').replace(/\s+/g, ' ').trim();
export function ageOf(ms: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

/** A message's words: its plain text (or its HTML without tags), without the quoted earlier messages. */
export function bodyOf(payload: any): string {
  const parts: any[] = [];
  const walk = (p: any) => { if (!p) return; parts.push(p); (p.parts ?? []).forEach(walk); };
  walk(payload);
  const pick = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data) ?? parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (!pick) return '';
  let text = Buffer.from(pick.body.data, 'base64url').toString('utf8');
  if (pick.mimeType === 'text/html') {
    text = text.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  const lines = text.replace(/\r/g, '').split('\n');
  const quoted = lines.findIndex((l) => /^On .+ wrote:$/.test(l.trim()) || /^-{2,} ?Original Message ?-{2,}$/i.test(l.trim()));
  return (quoted >= 0 ? lines.slice(0, quoted) : lines).filter((l) => !l.startsWith('>')).join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Threads as rows: who, what, how long ago (from each thread's newest message). */
async function rows(token: Token, threads: { id: string }[]) {
  return Promise.all(threads.map(async ({ id }) => {
    const t = await get(token, `/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    const m = t.messages?.at(-1);
    return { id, from: header(m, 'From').slice(0, 60), subject: header(t.messages?.[0], 'Subject').slice(0, 100) || '(no subject)', age: ageOf(Number(m?.internalDate ?? 0)) };
  }));
}

export async function runMail(token: Token, args: string[]): Promise<string> {
  const [cmd = 'inbox', ...more] = args;
  const { o, rest } = options(more);
  const bad = (why: string) => `error: ${why}\nhelp[${HELP.length}]:\n${HELP.map((h) => '  ' + h).join('\n')}`;
  if (cmd === 'inbox') {
    const [label, list] = await Promise.all([get(token, '/labels/INBOX'), get(token, '/threads?labelIds=INBOX&maxResults=5')]);
    return [`unread: ${label.threadsUnread ?? 0}`, table('newest', ['id', 'from', 'subject', 'age'], await rows(token, list.threads ?? [])),
      `help[${HELP.length}]:`, ...HELP.map((h) => '  ' + h)].join('\n');
  }
  if (cmd === 'search') {
    const q = rest.join(' ').trim();
    if (!q) return bad('mail search "<gmail query>"');
    const limit = Math.min(25, Math.max(1, Number(o.limit) || 10));
    const list = await get(token, `/threads?${new URLSearchParams({ q, maxResults: String(limit) })}`);
    return [table('threads', ['id', 'from', 'subject', 'age'], await rows(token, list.threads ?? [])), `total: ${list.resultSizeEstimate ?? 0}`].join('\n');
  }
  if (cmd === 'read') {
    const id = rest[0] ?? '';
    // A conversation id is Gmail's own (hex); anything else would change the address asked for.
    if (!/^[a-f0-9]{8,32}$/i.test(id)) return bad('mail read <id>, with the id from mail or mail search');
    const t = await get(token, `/threads/${id}?format=full`);
    const msgs: any[] = t.messages ?? [];
    const last = msgs.at(-1);
    const body = bodyOf(last?.payload);
    const cut = more.includes('--full') ? FULL : CUT;
    return [`subject: ${header(msgs[0], 'Subject') || '(no subject)'}`,
      table('messages', ['from', 'age'], msgs.map((m) => ({ from: header(m, 'From').slice(0, 60), age: ageOf(Number(m.internalDate ?? 0)) }))),
      `latest: ${header(last, 'From').slice(0, 60)}`, 'body: |', ...body.slice(0, cut).split('\n').map((l) => '  ' + l),
      ...(body.length > cut ? [`more: ${body.length - cut} more characters${cut === CUT ? `; mail read ${id} --full` : ''}`] : [])].join('\n');
  }
  return bad(`no command "${cmd}"`);
}

export const mailTool = (token: Token) =>
  axiTool('mail', "The person's own Gmail, read-only (mail-axi): what is new, search it, read a conversation. It cannot send, change or delete mail",
    (args) => runMail(token, args).catch((e) => `error: ${e.message}`));
