// mail-axi: the person's own Gmail as one small command-shaped tool in place of Google's hosted Gmail MCP
// server (23 tool schemas, about 8,900 tokens on every turn). crewd runs reads on the person's Gmail connection
// (`gmail.readonly`): the token never leaves crewd. Drafts and labels run on the separate `gmailwrite` grant
// through the guarded MailSend path (src/mail-send.ts); nothing here can send mail.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from './engine.ts';
import { writeBytes } from './files.ts';
import { GMAIL, options, table } from './calendar.ts';
import type { MailSend } from './mail-send.ts';

const HELP = [
  'mail                               unread count and the newest in the inbox', 'mail search "<gmail query>" [--limit 10]   e.g. from:school newer_than:7d',
  'mail read <id> [--full]            a conversation: who wrote, and the latest message', 'mail attachments <id> [<n>]        what it has attached; with n, save it into your files/ folder',
  'mail draft <id> <reply>            write the reply as a Gmail draft you send yourself; nothing is sent', 'mail label <id> <label>            file it under a Gmail label',
], CUT = 1500, FULL = 8000, ATTACH_MAX = 10 * 1024 * 1024; // enough for a statement or a form, and a helper has to read what it saves
type Token = () => Promise<string | null>;

async function get(token: Token, path: string) {
  const t = await token();
  if (!t) throw new Error('Gmail is not connected any more. Ask the person to connect it again (crew_connect).');
  const res = await fetch(`${GMAIL}${path}`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new Error('No such conversation. Search again for its id.');
  if (!res.ok) throw new Error(`Gmail said ${res.status}. Try again in a moment.`);
  return res.json() as Promise<any>;
}

const header = (m: any, name: string) => String(m?.payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '').replace(/\s+/g, ' ').trim(), parts = (p: any): any[] => (p ? [p, ...(p.parts ?? []).flatMap(parts)] : []), sizeWords = (n: number) => n < 1024 ? `${n}B` : n < 1_048_576 ? `${Math.round(n / 1024)}KB` : `${(n / 1_048_576).toFixed(1)}MB`;

/** An attachment's own name, made safe: no folders, no hidden file, no control characters, a sane length. */
function safeName(raw: unknown) {
  const name = String(raw ?? '').replace(/[\\/]/g, '-').replace(/[\x00-\x1f<>:"|?*]/g, '').trim().slice(-120).replace(/^\.+/, '').replace(/[. ]+$/, '');
  return name || 'attachment';
}

/** A conversation's attachments, in order, with the number the helper names in `mail attachments`. */
const attachments = (t: any): { message: string; id: string; name: string; type: string; size: number }[] => (t?.messages ?? []).flatMap((m: any) => parts(m.payload)
  .filter((p: any) => p.body?.attachmentId)
  .map((p: any) => ({ message: String(m.id), id: String(p.body.attachmentId), name: safeName(p.filename), type: String(p.mimeType ?? ''), size: Number(p.body.size ?? 0) })));
export function ageOf(ms: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

/** A message's words: its plain text (or its HTML without tags), without the quoted earlier messages. */
export function bodyOf(payload: any): string {
  const all = parts(payload), pick = all.find((p) => p.mimeType === 'text/plain' && p.body?.data) ?? all.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (!pick) return '';
  let text = Buffer.from(pick.body.data, 'base64url').toString('utf8');
  if (pick.mimeType === 'text/html') {
    text = text.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  const lines = text.replace(/\r/g, '').split('\n'), quoted = lines.findIndex((l) => /^On .+ wrote:$/.test(l.trim()) || /^-{2,} ?Original Message ?-{2,}$/i.test(l.trim()));
  return (quoted >= 0 ? lines.slice(0, quoted) : lines).filter((l) => !l.startsWith('>')).join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Threads as rows: who, what, how long ago (from each thread's newest message). */
async function rows(token: Token, threads: { id: string }[]) {
  return Promise.all(threads.map(async ({ id }) => {
    const t = await get(token, `/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`), m = t.messages?.at(-1);
    return { id, from: header(m, 'From').slice(0, 60), subject: header(t.messages?.[0], 'Subject').slice(0, 100) || '(no subject)', age: ageOf(Number(m?.internalDate ?? 0)), at: Number(m?.internalDate ?? 0) };
  }));
}

export async function newThreads(token: Token, after: number, limit = 25) {
  const list = await get(token, `/threads?${new URLSearchParams({ q: 'in:inbox', maxResults: String(limit) })}`);
  return (await rows(token, list.threads ?? [])).filter((m) => m.at > after);
}

export async function runMail(token: Token, args: string[], root?: string, filing?: MailSend, bot = 'chief'): Promise<string> {
  const [cmd = 'inbox', ...more] = args, { o, rest } = cmd === 'draft' || cmd === 'label' ? { o: {} as Record<string, string>, rest: more } : options(more), bad = (why: string) => `error: ${why}\nhelp[${HELP.length}]:\n${HELP.map((h) => '  ' + h).join('\n')}`, idOf = (id: string, use: string) => (/^[a-f0-9]{8,32}$/i.test(id) ? null : bad(use));
  if (cmd === 'inbox') {
    const [label, list] = await Promise.all([get(token, '/labels/INBOX'), get(token, '/threads?labelIds=INBOX&maxResults=5')]);
    return [`unread: ${label.threadsUnread ?? 0}`, table('newest', ['id', 'from', 'subject', 'age'], await rows(token, list.threads ?? [])),
      `help[${HELP.length}]:`, ...HELP.map((h) => '  ' + h)].join('\n');
  }
  if (cmd === 'search') {
    const q = rest.join(' ').trim();
    if (!q) return bad('mail search "<gmail query>"');
    const limit = Math.min(25, Math.max(1, Number(o.limit) || 10)), list = await get(token, `/threads?${new URLSearchParams({ q, maxResults: String(limit) })}`);
    return [table('threads', ['id', 'from', 'subject', 'age'], await rows(token, list.threads ?? [])), `total: ${list.resultSizeEstimate ?? 0}`].join('\n');
  }
  if (cmd === 'read') {
    const id = rest[0] ?? '';
    // A conversation id is Gmail's own (hex); anything else would change the address asked for.
    if (!/^[a-f0-9]{8,32}$/i.test(id)) return bad('mail read <id>, with the id from mail or mail search');
    const t = await get(token, `/threads/${id}?format=full`), msgs: any[] = t.messages ?? [], last = msgs.at(-1), body = bodyOf(last?.payload), cut = more.includes('--full') ? FULL : CUT, list = attachments(t);
    return [`subject: ${header(msgs[0], 'Subject') || '(no subject)'}`,
      table('messages', ['from', 'age'], msgs.map((m) => ({ from: header(m, 'From').slice(0, 60), age: ageOf(Number(m.internalDate ?? 0)) }))),
      `latest: ${header(last, 'From').slice(0, 60)}${list.length ? `, ${list.length} attached (mail attachments ${id})` : ''}`,
      'body: |', ...body.slice(0, cut).split('\n').map((l) => '  ' + l),
      ...(body.length > cut ? [`more: ${body.length - cut} more characters${cut === CUT ? `; mail read ${id} --full` : ''}`] : [])].join('\n');
  }
  if (cmd === 'attachments') {
    const id = rest[0] ?? '', n = Number(rest[1] ?? 0);
    if (!/^[a-f0-9]{8,32}$/i.test(id) || !Number.isInteger(n) || n < 0) return bad('mail attachments <id> [<n>], with the id from mail or mail search');
    const list = attachments(await get(token, `/threads/${id}?format=full`));
    if (!n) return list.length ? table('attachments', ['n', 'name', 'type', 'size'], list.map((a, i) => ({ n: i + 1, name: a.name, type: a.type, size: sizeWords(a.size) }))) : 'No attachments on this conversation.';
    if (!root) return bad('saving an attachment writes into a helper’s own files folder; only a helper can do it');
    if (!list.length) return bad('No attachments on this conversation.');
    const pick = list[n - 1];
    if (!pick) return bad(`this conversation has ${list.length} attachment${list.length === 1 ? '' : 's'}; n is 1 to ${list.length}`);
    if (pick.size > ATTACH_MAX) return bad(`“${pick.name}” is ${sizeWords(pick.size)}, over the ${sizeWords(ATTACH_MAX)} crewd will save for you`);
    const got = await get(token, `/messages/${pick.message}/attachments/${pick.id}`), bytes = Buffer.from(String(got?.data ?? ''), 'base64url');
    if (!bytes.length) return bad('Gmail would not hand that attachment over. Try again in a moment.');
    // A name already in files/ is kept: the new one is numbered, never written over the top of it.
    const ext = pick.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '', stem = pick.name.slice(0, pick.name.length - ext.length);
    let name = pick.name;
    for (let i = 2; existsSync(join(root, 'files', name)); i++) name = `${stem} (${i})${ext}`;
    writeBytes(root, `files/${name}`, bytes);
    return `saved: {file: files/${name}, name: ${pick.name}, type: ${pick.type}, size: ${sizeWords(bytes.length)}}\nRead it with your own file tools.`;
  }
  if (cmd === 'draft') {
    const err = idOf(rest[0] ?? '', 'mail draft <id> <reply>, with the id from mail or mail search');
    if (err) return err;
    const body = rest.slice(1).join(' ').trim();
    if (!body) return bad('mail draft <id> <reply>: write the reply after the id');
    if (!filing) return bad('Connect Gmail drafts & labels in Settings first (crew_connect). Reading Gmail alone cannot draft.');
    return filing.draftReply(rest[0], body, bot);
  }
  if (cmd === 'label') {
    const err = idOf(rest[0] ?? '', 'mail label <id> <label>, with the id from mail or mail search');
    if (err) return err;
    const label = rest.slice(1).join(' ').trim();
    if (!label) return bad('mail label <id> <label>: name the label after the id');
    if (!filing) return bad('Connect Gmail drafts & labels in Settings first (crew_connect). Reading Gmail alone cannot file.');
    return filing.applyLabel(rest[0], label, bot);
  }
  return bad(`no command "${cmd}"`);
}

export const mailTool = (token: Token, root?: string, filing?: MailSend, bot = 'chief') =>
  tool('mail', "The person's own Gmail (mail-axi): what is new, search it, read a conversation, save an attachment into your own files, write a reply as a Gmail draft you send yourself, or file it under a label. It cannot send mail. Pass the command's arguments as a list, without the program name.",
    { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false },
    (p) => runMail(token, (p.args ?? []).map(String), root, filing, bot).catch((e) => `error: ${e.message}`));
