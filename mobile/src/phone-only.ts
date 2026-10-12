// Proof-stage phone-only glue: the whole Chief loop over @byokit/accounts with no computer anywhere.
// It moves into BYOKit's kit when the cross-kit phone-first plan (Main2211) defines that surface: no engine,
// no sessions, no providers, no memory, nothing downloaded at runtime (bundled tools only, App Review 4.7).
// The system prompt is Chief's real template files, bundled as words by metro (scripts/markdown.cjs).
// For this proof the account is an API-key route (DeepSeek on OpenRouter, billed per use), which needs no
// human hand-off; the ChatGPT subscription route is the eventual one and is left as an open item.
import { Accounts, IncompleteError, KeyRouteError, ResponseError, portable, secureStore,
  type Context, type Model, type AssistantMessage } from '@byokit/accounts';
import { withKeys } from '@byokit/accounts/keys';
import { nativeStore } from '@byokit/secrets/native';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { fetch } from 'expo/fetch';
import { Directory, File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import soul from '../../templates/chief/soul.md';
import job from '../../templates/chief/AGENTS.md';
import type { DocPart } from '../../web/src/adapter.ts';
import { pendingOf, replayChat, transcriptOf } from './phone-queue.ts';

const MEMBER = 1;
const PROVIDER = 'openrouter';
const MAX_STEPS = 3;
const KEY_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Chief's own sign-in, in the phone's Keychain/Keystore, one entry per install. It never leaves this device.
 *  The key route answers through the `@byokit/accounts/keys` runtime (`withKeys`), loaded lazily on first use. */
export const phoneAccounts = new Accounts({
  offer: [PROVIDER],
  fetch: fetch as typeof globalThis.fetch,
  store: () => secureStore(SecureStore, 'crewhouse.phone-only', KEY_OPTIONS),
  keyStore: () => nativeStore({ prefix: 'crewhouse.phone-only', options: KEY_OPTIONS }),
}, withKeys(portable));

// A tiny marker (in the same secure store as the sign-in) so a relaunch opens straight into phone-only.
const MODE_KEY = 'crewhouse.phone-only.mode';
export async function phoneMode() { return (await SecureStore.getItemAsync(MODE_KEY)) === 'phone'; }
export function setPhoneMode(on: boolean) { return on ? SecureStore.setItemAsync(MODE_KEY, 'phone') : SecureStore.deleteItemAsync(MODE_KEY); }

export type ChatTurn = { who: 'you' | 'chief'; text: string };
export type PhoneDocument = { name: string; uri: string; parts: DocPart[] };

// ---------- sign-in (the person's own API key, billed per use) ----------
export const phoneProviderName = 'OpenRouter';
/** Where a person without a key gets one: the provider's own key page. */
export const phoneKeyUrl = 'https://openrouter.ai/keys';
/** True once the person's key is saved on this phone. */
export async function phoneSignedIn(): Promise<boolean> {
  try { return !!(await phoneAccounts.key(MEMBER, PROVIDER)); } catch { return false; }
}
/** The account line for the header; this provider has no plan, so it names the model. */
export const phonePlan = async (): Promise<string | null> => 'DeepSeek';
/** Save the person's key, having agreed to per-use billing; false when the key could not be kept. */
export async function phoneConnect(key: string) {
  const { state } = await phoneAccounts.saveKey(MEMBER, PROVIDER, key.trim(), { billedPerUse: true });
  if (state === 'failed') throw new Error('This key could not be saved. Try again.');
}
/** Sign out on this phone: the kept chat goes with the key, so a signed-out phone keeps none of it. */
export const phoneSignOut = async () => { clearChat(); return phoneAccounts.logout(MEMBER, PROVIDER); };
/** One plain sentence for a sign-in failure, never a code, path or raw error. */
export function phoneSignInWords(error: unknown) {
  const text = error instanceof Error ? error.message : '';
  return /key/i.test(text) ? 'Check the key and try again.' : (text || 'Could not connect that key. Try again.');
}

export const shareDocument = (doc: PhoneDocument) => shareAsync(doc.uri, {
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  UTI: 'org.openxmlformats.wordprocessingml.document', dialogTitle: doc.name });

/** True when a failure means the sign-in has lapsed, so the app sends the person back to sign in. */
export const phoneExpired = (error: unknown) =>
  error instanceof KeyRouteError && error.code === 'request' ? false
    : error instanceof ResponseError && error.kind === 'signed_out';

/** One plain sentence for any failure a person may meet here, never a code, path or raw error. */
export function phoneWords(error: unknown) {
  if (error instanceof IncompleteError) return "Chief's answer was cut short. Please try again.";
  if (error instanceof KeyRouteError) {
    if (error.code === 'aborted') return 'Stopped.';
    if (error.code === 'needs_keys') return 'This phone cannot run key accounts yet.';
    return 'Could not finish on this phone. Check your internet connection and try again.';
  }
  if (error instanceof ResponseError) {
    if (error.kind === 'network') return 'No internet connection. Reconnect, then try again.';
    if (error.kind === 'rate_limit') return 'The model is at its limit right now. Try again in a little while.';
    if (error.kind === 'signed_out') return 'Your key is no longer working. Connect it again.';
    return error.message;
  }
  return 'Could not finish on this phone. Check your internet connection and try again.';
}

// ---------- the phone-only chat, kept on the phone ----------
// One append-only file per chat, one JSON object per line, written as the chat happens. A `you` line
// begins a turn (written before the send) and a `chief` line ends it. A `you` with no `chief` before the
// next `you`, or before the end of the file, is a turn the phone was cut off inside; with `queued` it is
// only waiting for a connection and goes by itself, otherwise the person retries it (Try again / Retry).
// crew_document writes a real file, so a cut-off turn is never run again by the app on its own.
export type PhoneLine = { who: 'you' | 'chief'; text: string; doc?: PhoneDocument; rid?: string;
  /** A message saved while offline: shown "Queued, not sent yet" and sent by itself when back online. */
  queued?: boolean;
  /** A turn with a start marker and no end: shown with Try again. `retry`/`retryRid` are what it re-sends. */
  stopped?: boolean; retry?: string; retryRid?: string;
  /** The cut-off turn was inside a tool effect (its request is journalled `started`): shown "Interrupted." */
  interrupted?: boolean };

const file = (name: string) => new File(Paths.document, name);
const chatFile = () => file('phone-chat.jsonl');
const requestFile = () => file('phone-requests.jsonl');
const metaFile = () => file('phone-meta.json');

/** Best-effort phone storage: every kept file is a cache, so a failure is dropped (never thrown) and the
 *  chat keeps working without persisting. One helper so the policy reads once, not per call site. */
function keep(fn: () => void) {
  try { fn(); } catch (e) { void e; }
}

/** Read a whole JSON-lines file as records, skipping any broken line so a partial write never loses the rest.
 *  Never throws: a missing or unreadable file is simply empty. */
function readLines(fileOf: () => File): Array<Record<string, unknown>> {
  let text = '';
  keep(() => { const f = fileOf(); if (f.exists) text = f.textSync(); });
  const records: Array<Record<string, unknown>> = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    keep(() => { const r: unknown = JSON.parse(raw); if (r && typeof r === 'object') records.push(r as Record<string, unknown>); });
  }
  return records;
}

/** Append one line, silently: a chat on a full disk still works, it just does not grow. */
function appendLine(fileOf: () => File, line: unknown) {
  keep(() => { const f = fileOf(); if (!f.exists) f.create({ intermediates: true }); f.write(`${JSON.stringify(line)}\n`, { append: true }); });
}

/** Replace a whole JSON-lines file (the request index and the meta record). */
function writeAll(fileOf: () => File, lines: unknown[]) {
  keep(() => { const f = fileOf(); f.create({ intermediates: true, overwrite: true }); for (const line of lines) f.write(`${JSON.stringify(line)}\n`, { append: true }); });
}

/** A fresh id for one turn's request, and the key its tool effects are journalled and retried under. */
export const newRid = () => randomUUID();

/** The turn begins, before the send: the person's words and the request's id are the start marker. */
export const rememberUser = (text: string, rid: string) => appendLine(chatFile, { t: 'you', text, rid });
/** The turn ends: Chief's answer and the document card he made here, if any. */
export const rememberChief = (text: string, doc?: PhoneDocument, rid?: string) =>
  appendLine(chatFile, doc ? { t: 'chief', text, doc, rid } : { t: 'chief', text, rid });

/** The document card kept with a Chief line: its name and uri (and the parts Read shows). */
function keptDocument(value: unknown): PhoneDocument | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = value as Record<string, unknown>;
  if (typeof d.name !== 'string' || typeof d.uri !== 'string') return undefined;
  return { name: d.name, uri: d.uri, parts: Array.isArray(d.parts) ? d.parts as DocPart[] : [] };
}

// ---------- the request index: one effect per request ----------
// crew_document writes a real file, so the request that runs it is journalled before the effect and closed
// after it: one line per requestId, the tool-call id and file name it owns, and started|done. A line left
// `started` on open is an effect the phone was killed inside: that turn comes back "Interrupted.", nothing
// reruns itself, and the person's Retry runs the same requestId once more under the same first tool-call id,
// so the file it made is reused, not doubled.
export type RequestEntry = { rid: string; callId: string; fileName: string; state: 'started' | 'done' };

function loadRequests(): RequestEntry[] {
  return readLines(requestFile).flatMap((r) =>
    typeof r.rid === 'string' && (r.state === 'started' || r.state === 'done')
      ? [{ rid: r.rid, callId: typeof r.callId === 'string' ? r.callId : '', fileName: typeof r.fileName === 'string' ? r.fileName : '', state: r.state as 'started' | 'done' }]
      : []);
}
/** The last journal line for a request, if any. */
function requestFor(rid: string): RequestEntry | undefined {
  const mine = loadRequests().filter((e) => e.rid === rid);
  return mine.length ? mine[mine.length - 1] : undefined;
}
function writeRequest(entry: RequestEntry) {
  writeAll(requestFile, [...loadRequests().filter((e) => e.rid !== entry.rid), entry]);
}
/** Record the effect starting, before it writes anything. */
const startRequest = (rid: string, callId: string, fileName: string) => writeRequest({ rid, callId, fileName, state: 'started' });
/** Close the effect with the file it made, keeping the tool-call id it was named by. */
const finishRequest = (rid: string, fileName: string) => { const prev = requestFor(rid); writeRequest({ rid, callId: prev?.callId ?? '', fileName, state: 'done' }); };

// ---------- offline: what this phone heard last ----------
// A keyless call to the same provider the phone already uses. Any answer means the internet is there; a
// thrown fetch means it is not. Used to show the offline banner and to queue sends instead of failing them.
export async function probeOnline(): Promise<boolean> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Bounded by its own timer too: a fetch with no network can sit in DNS without honouring the abort.
  const late = new Promise<never>((_, no) => { timer = setTimeout(() => { ctrl.abort(); no(new Error('timeout')); }, 4000); });
  try { await Promise.race([fetch('https://openrouter.ai/api/v1/models', { method: 'HEAD', signal: ctrl.signal }), late]); return true; }
  catch { return false; }
  finally { clearTimeout(timer); }
}
/** True when a failure is the internet, not the model: only that queues a message or goes offline. */
export const isOffline = (e: unknown) => e instanceof ResponseError && e.kind === 'network';
/** When the phone last heard the model (a real answer or a probe), for the offline banner. */
export const heardAt = (): number => { const r = readLines(metaFile)[0]; return typeof r?.heardAt === 'number' ? r.heardAt : 0; };
export const markHeard = () => writeAll(metaFile, [{ heardAt: Date.now() }]);

/** The chat as it was kept, with a queued message still waiting and a cut-off turn marked stopped. A broken
 *  line is skipped so earlier good turns survive; never throws. */
export function loadChat(): PhoneLine[] {
  const records = readLines(chatFile).flatMap((r) => typeof r.text === 'string' && (r.t === 'you' || r.t === 'chief')
    ? [{ t: r.t as string, text: r.text as string, rid: typeof r.rid === 'string' ? r.rid : undefined, queued: r.queued === true, doc: keptDocument(r.doc) }]
    : []);
  return replayChat(records, (rid) => requestFor(rid)?.state === 'started') as PhoneLine[];
}

/** A message waiting for a connection: kept under its request id, going by itself when back online. */
export function queueTurn(text: string, rid?: string): string {
  const id = rid ?? newRid();
  appendLine(chatFile, { t: 'you', text, rid: id, queued: true });
  return id;
}

/** Every message still waiting for a connection, oldest first. */
export const pendingTurns = (): { rid: string; text: string }[] => pendingOf(loadChat());

/** The kept chat as one message for Chief on a paired computer, and the one id that moves it (its last turn's, so a
 *  resend after a kill is the same move). Null with nothing said. Paired, no turn here is in flight (leaving phone-only
 *  aborts it), so a queued message moves too, marked not sent yet. */
export function chatToMove(): { text: string; id: string } | null {
  const lines = loadChat();
  if (!lines.some((l) => l.who === 'you')) return null;
  return { text: transcriptOf(lines), id: lines.filter((l) => l.who === 'you' && l.rid).at(-1)?.rid ?? newRid() };
}

/** The chat went to the computer: its kept file and tool index move into one hidden archive (never shown, never
 *  reloaded), so a turn the move trimmed is not destroyed. The documents Chief made here stay on this phone. */
const moved = () => new Directory(Paths.document, 'phone-moved');
export const retireChat = () => keep(() => {
  const dir = moved(), at = Date.now();
  dir.create({ intermediates: true, idempotent: true });
  for (const f of [chatFile(), requestFile()]) if (f.exists) f.moveSync(new File(dir, `${at}-${f.name}`));
});

/** Carry the chat to the computer, and retire the phone copy only once `send` has resolved: a failed or timed-out
 *  move keeps the phone copy, message and all. */
export async function moveChatTo(send: () => Promise<unknown>) {
  await send();
  retireChat();
}

/** A signed-out phone keeps no chat: the kept files go, with every document Chief made here. */
export function clearChat() {
  for (const f of [chatFile, requestFile]) keep(() => { const x = f(); if (x.exists) x.delete(); });
  keep(() => { const x = moved(); if (x.exists) x.delete(); });
  keep(() => { const x = metaFile(); if (x.exists) x.delete(); });
  keep(() => { for (const x of new Directory(Paths.document).list()) if (x instanceof File && x.name.startsWith('chief-')) x.delete(); });
}

// ---------- Chief, phone-sized ----------
const instructions = `${soul}\n${job}

PHONE ONLY. These rules override the computer and crew instructions above.
You are Chief, running by yourself on this phone. There is no computer and no crew of helpers here.
Answer questions and draft things yourself, in chat. Be brief.
You have one tool, crew_document, to make a small Word document the person can open and share.
Before a tool call, stream one short sentence about what you are making. Never claim it is made until the tool returns.
Anything that needs a computer says so plainly, in one line, and offers to do it once the person pairs one:
web browsing, research, coding, files outside this app, connected apps, sending or posting, paying,
hiring helpers, memory and scheduled jobs. Never pretend you did those, and never point at controls that are not here.
Nothing is shared until the person taps Share on the document card. Never claim anything has been sent.`;

/** DeepSeek through OpenRouter, the pinned Pi model the key route answers with. */
const MODEL: Model<'openai-completions'> = {
  id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', api: 'openai-completions', provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 163_840, maxTokens: 8_192,
};

const tool = {
  name: 'crew_document',
  description: 'Make a small Word document on this phone from headings, paragraphs and bullet lists.',
  parameters: { type: 'object', additionalProperties: false, required: ['name', 'blocks'], properties: {
    name: { type: 'string', description: 'A short file name, without an extension.' },
    blocks: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['heading', 'text', 'bullets'], properties: {
        heading: { type: ['string', 'null'], description: 'A section heading, or null.' },
        text: { type: ['string', 'null'], description: 'A paragraph, or null.' },
        bullets: { type: ['array', 'null'], items: { type: 'string' }, description: 'A short bullet list, or null.' },
      } } } } },
};

/** Validate a document spec and pack it to bytes and readable parts, before anything is written. Throws one
 *  plain sentence on a bad spec, so a failed document leaves no request journalled and no file behind. */
async function prepareDocument(spec: { name?: unknown; blocks?: unknown }): Promise<{ name: string; bytes: Uint8Array; parts: DocPart[] }> {
  if (JSON.stringify(spec).length > 60_000) throw new Error('This document is too large for this phone. It needs a computer.');
  const parts: DocPart[] = [], children: Paragraph[] = [];
  if (typeof spec.name !== 'string' || !spec.name.trim() || !Array.isArray(spec.blocks) || !spec.blocks.length || spec.blocks.length > 80)
    throw new Error('The document needs a title and between one and eighty parts.');
  let size = 0;
  const words = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000 || (size += value.length) > 40_000)
      throw new Error('The document has a missing line, or too many words for this phone.');
    return value.replace(/\r?\n/g, ' ');
  };
  for (const block of spec.blocks as Array<Record<string, unknown>>) {
    if (!block || (block.heading == null && block.text == null && block.bullets == null))
      throw new Error('Each document part needs a heading, a paragraph or a bullet list.');
    if (block.heading != null) {
      const text = words(block.heading);
      parts.push({ kind: 'heading', text });
      children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }));
    }
    if (block.text != null) {
      const text = words(block.text);
      parts.push({ kind: 'p', text });
      children.push(new Paragraph({ text }));
    }
    if (block.bullets != null) {
      if (!Array.isArray(block.bullets) || !block.bullets.length || block.bullets.length > 30)
        throw new Error('A phone document list needs between one and thirty lines.');
      for (const item of block.bullets) {
        const text = words(item);
        parts.push({ kind: 'li', text });
        children.push(new Paragraph({ text, bullet: { level: 0 } }));
      }
    }
  }
  const name = spec.name.replace(/\.docx$/i, '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'Document';
  // Pack to raw bytes: no Buffer (Hermes has none) and no base64 blow-up on a phone.
  const bytes = new Uint8Array(await Packer.toArrayBuffer(new Document({ creator: 'Crewhouse', sections: [{ children }] })));
  return { name, bytes, parts };
}

/** Write the one document a turn may make. Its file is named by the request's first tool-call id, so a Retry
 *  reuses the same path instead of doubling the file. The request is journalled `started` before the write and
 *  `done` after, so a kill in between is known and the person (never the app) retries it. */
function writeDocument(rid: string, callId: string, prep: { name: string; bytes: Uint8Array; parts: DocPart[] }): PhoneDocument {
  const prior = requestFor(rid);
  const safeCall = ((prior?.callId || callId).replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'doc');
  const fresh = `chief-${safeCall}-${prep.name}.docx`;
  const reused = !!prior?.fileName && /^chief-[\p{L}\p{N} _-]{1,80}-[\p{L}\p{N} _-]{1,80}\.docx$/u.test(prior.fileName);
  const fileName = reused && prior ? prior.fileName : fresh;
  startRequest(rid, prior?.callId || callId, fileName);
  const out = new File(Paths.document, fileName);
  out.create({ overwrite: true });
  out.write(prep.bytes);
  finishRequest(rid, fileName);
  const display = reused ? fileName.slice(`chief-${safeCall}-`.length, -'.docx'.length) || prep.name : prep.name;
  return { name: `${display}.docx`, uri: out.uri, parts: prep.parts };
}

/** React Native's AbortSignal has no throwIfAborted, which parts of the kit call; give one signal the whole,
 *  standards-shaped surface, without touching the kit. */
function abortSafe(signal: AbortSignal): AbortSignal {
  const s = signal as AbortSignal & { throwIfAborted?: () => void };
  if (typeof s.throwIfAborted !== 'function') s.throwIfAborted = () => { if (signal.aborted) throw signal.reason ?? new Error('Aborted'); };
  return s;
}

type Part = { type: 'text'; text: string } | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> };
type Msg = Record<string, unknown>;
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** Chief's whole turn over a key route: stream the words, run the one tool it asks for, answer again. Bounded.
 *  `rid` is the turn's request id: the key a document effect is journalled and retried under. */
export async function askPhone(turns: ChatTurn[], io: { onText: (t: string) => void; onDocument: (d: PhoneDocument) => void }, signal: AbortSignal, rid: string): Promise<string> {
  const sig = abortSafe(signal);
  const messages: Msg[] = turns.map((turn) => turn.who === 'you'
    ? { role: 'user', content: [{ type: 'text', text: turn.text }], timestamp: Date.now() }
    : { role: 'assistant', content: [{ type: 'text', text: turn.text }], api: MODEL.api, provider: MODEL.provider,
        model: MODEL.id, usage: ZERO_USAGE, stopReason: 'stop', timestamp: Date.now() });
  const context = { systemPrompt: instructions, tools: [tool], messages } as unknown as Context;
  let answer = '', documents = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const head = answer;
    let stepText = '';
    const message = await phoneAccounts.respondKey(MEMBER, {
      account: PROVIDER, model: MODEL, context, options: { signal: sig, maxTokens: 4096 },
      onText: (delta) => { stepText += delta; io.onText(head ? `${head}\n\n${stepText}` : stepText); },
    } as Parameters<typeof phoneAccounts.respondKey>[1]) as unknown as AssistantMessage;
    const parts = (message.content ?? []) as Part[];
    const text = parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('') || stepText;
    answer = head ? `${head}\n\n${text}` : text;
    io.onText(answer);
    messages.push(message as unknown as Msg);
    const calls = parts.filter((p): p is Extract<Part, { type: 'toolCall' }> => p.type === 'toolCall');
    if (!calls.length) return answer;
    for (const call of calls) {
      let output: string;
      try {
        if (call.name !== 'crew_document') output = 'That needs a computer, so it cannot be done on this phone. Only documents are available here.';
        else if (documents) output = 'One document per request on this phone. Tell the person what you made.';
        else {
          // Validate and pack first, then journal the effect started, write its one file, and close the request.
          const prep = await prepareDocument(call.arguments);
          const doc = writeDocument(rid, call.id, prep);
          documents++;
          io.onDocument(doc);
          output = `Made ${doc.name}. The person can preview it and tap Share.`;
        }
      } catch (e) { output = `The document was not made: ${e instanceof Error ? e.message : 'could not write the document'}.`; }
      messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: output }], isError: false, timestamp: Date.now() });
    }
  }
  throw new Error('Chief reached this phone\'s step limit. Try a smaller request, or ask once you have paired a computer.');
}
