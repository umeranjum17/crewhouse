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
import { fetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import soul from '../../templates/chief/soul.md';
import job from '../../templates/chief/AGENTS.md';
import type { DocPart } from '../../web/src/adapter.ts';

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
// One file, one JSON object per line, appended as the chat happens. A `you` line begins a turn (written
// before the send) and a `chief` line ends it; a `you` with no `chief` before the next `you`, or before the
// end of the file, is a turn that was cut off. crew_document is not idempotent, so a cut-off turn is only
// ever retried by the person (Try again); it never runs itself again on open.
export type PhoneLine = { who: 'you' | 'chief'; text: string; doc?: PhoneDocument;
  /** A turn loaded with no end: its user line is left out of the history that Try again re-sends, and the
   *  Chief line carries the words to send. Both are derived on load and are never written to the file. */
  stopped?: boolean; retry?: string };

const chatFile = () => new File(Paths.document, 'phone-chat.jsonl');

/** Append one line to the phone-only chat. Silent on failure so a chat on a full disk still works. */
function append(line: unknown) {
  try {
    const f = chatFile();
    if (!f.exists) f.create({ intermediates: true });
    f.write(`${JSON.stringify(line)}\n`, { append: true });
  } catch {}
}

/** The turn begins, before the send: the person's words are the start marker. */
export const rememberUser = (text: string) => append({ t: 'you', text });
/** The turn ends: Chief's answer, and the document card he made, if any. */
export const rememberChief = (text: string, doc?: PhoneDocument) => append(doc ? { t: 'chief', text, doc } : { t: 'chief', text });

/** The document card kept with a Chief line: its name and uri (and the parts Read shows). */
function keptDocument(value: unknown): PhoneDocument | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = value as Record<string, unknown>;
  if (typeof d.name !== 'string' || typeof d.uri !== 'string') return undefined;
  return { name: d.name, uri: d.uri, parts: Array.isArray(d.parts) ? d.parts as DocPart[] : [] };
}

/** The chat as it was kept. Every whole line is read; a broken line (a partial write, a corrupt file) is
 *  skipped, and earlier good turns are kept. A turn with a start but no end comes back as a stopped row
 *  with the words Try again re-sends. Never throws. */
export function loadChat(): PhoneLine[] {
  let text = '';
  try { const f = chatFile(); if (f.exists) text = f.textSync(); } catch { return []; }
  const lines: PhoneLine[] = [];
  let open: string | null = null; // the words of a turn whose end has not been seen
  let userAt = -1;                // where its user line sits in `lines`
  const cutOff = () => {
    if (open === null) return;
    if (lines[userAt]) lines[userAt].stopped = true;
    lines.push({ who: 'chief', text: 'Stopped.', stopped: true, retry: open });
    open = null; userAt = -1;
  };
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let rec: unknown;
    try { rec = JSON.parse(raw); } catch { continue; } // skip a broken line, keep the ones around it
    const r = rec as Record<string, unknown>;
    if (!r || typeof r !== 'object' || typeof r.text !== 'string') continue;
    if (r.t === 'you') { cutOff(); lines.push({ who: 'you', text: r.text }); open = r.text; userAt = lines.length - 1; }
    else if (r.t === 'chief' && open !== null) { lines.push({ who: 'chief', text: r.text, doc: keptDocument(r.doc) }); open = null; userAt = -1; }
  }
  cutOff();
  return lines;
}

/** A signed-out phone keeps no chat: the kept file goes. */
export function clearChat() {
  try { const f = chatFile(); if (f.exists) f.delete(); } catch {}
  try { const f = requestIndexFile(); if (f.exists) f.delete(); } catch {}
}

// ---------- the request index: one effect per request ----------
// crew_document writes a real file, so the request that runs it is journalled before the effect and closed
// after it: one line per requestId, the file name it owns, and started|done. A line left `started` on open is
// an effect the phone was killed inside: that turn comes back "Interrupted. Retry?", nothing reruns itself,
// and the person's Try again runs the same requestId once more, so the file it made is reused, not doubled.
export type RequestEntry = { rid: string; fileName: string; state: 'started' | 'done' };

const requestIndexFile = () => new File(Paths.document, 'phone-requests.jsonl');

function appendRequest(entry: RequestEntry) {
  try {
    const f = requestIndexFile();
    if (!f.exists) f.create({ intermediates: true });
    f.write(`${JSON.stringify(entry)}\n`, { append: true });
  } catch {}
}

function loadRequests(): RequestEntry[] {
  let text = '';
  try { const f = requestIndexFile(); if (f.exists) text = f.textSync(); } catch { return []; }
  const entries: RequestEntry[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let rec: unknown;
    try { rec = JSON.parse(raw); } catch { continue; } // a partial line is skipped, the ones around it stay
    const r = rec as Record<string, unknown>;
    if (typeof r.rid === 'string' && (r.state === 'started' || r.state === 'done'))
      entries.push({ rid: r.rid, fileName: typeof r.fileName === 'string' ? r.fileName : '', state: r.state });
  }
  return entries;
}

function rewriteRequests(entries: RequestEntry[]) {
  try {
    const f = requestIndexFile();
    f.create({ intermediates: true, overwrite: true });
    for (const e of entries) f.write(`${JSON.stringify(e)}\n`, { append: true });
  } catch {}
}

/** The effect the phone was killed inside, if there is one: the only request a turn may resume. */
export const interruptedRequest = (): string | null => {
  const e = loadRequests().find((x) => x.state === 'started');
  return e ? e.rid : null;
};

/** Record the effect starting, once per request. */
function startRequest(rid: string) {
  if (loadRequests().some((e) => e.rid === rid)) return;
  appendRequest({ rid, fileName: '', state: 'started' });
}

/** Close the effect with the file it made, under the request's own name. */
function finishRequest(rid: string, fileName: string) {
  rewriteRequests([...loadRequests().filter((e) => e.rid !== rid), { rid, fileName, state: 'done' }]);
}

/** A request nobody is retrying any more (a new turn ran instead) leaves the index. */
function dropRequest(rid: string) { rewriteRequests(loadRequests().filter((e) => e.rid !== rid)); }

function getPendingRequest(requestId: string): { fileName: string } | null {
  const entries = loadRequests();
  const entry = entries.find((e: RequestEntry) => e.rid === requestId && e.state === 'started');
  return entry ? { fileName: entry.fileName } : null;
}

function markRequestDone(requestId: string) {
  rewriteRequests(loadRequests().map((e: RequestEntry) =>
    e.rid === requestId && e.state === 'started' ? { ...e, state: 'done' } : e
  ));
}

function fileExists(filePath: string): boolean {
  try { 
    const f = new File(filePath);
    return f.exists; 
  } catch { return false; }
}

// ---------- the outbox: words sent while this phone is offline ----------
// A message sent with no connection is kept and shown as "queued, not sent yet"; it goes once, under its
// own requestId, when the phone is back online. An entry left `sending` on open is a turn the phone was
// killed inside: it never goes by itself, and comes back stopped, with the person's Try again.
export type OutboxEntry = { rid: string; text: string; state: 'queued' | 'sending' };

const outboxFile = () => new File(Paths.document, 'phone-outbox.jsonl');

function loadOutbox(): OutboxEntry[] {
  let text = '';
  try { const f = outboxFile(); if (f.exists) text = f.textSync(); } catch { return []; }
  const entries: OutboxEntry[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let rec: unknown;
    try { rec = JSON.parse(raw); } catch { continue; }
    const r = rec as Record<string, unknown>;
    if (typeof r.rid === 'string' && typeof r.text === 'string' && (r.state === 'queued' || r.state === 'sending'))
      entries.push({ rid: r.rid, text: r.text, state: r.state });
  }
  return entries;
}

function rewriteOutbox(entries: OutboxEntry[]) {
  try {
    const f = outboxFile();
    f.create({ intermediates: true, overwrite: true });
    for (const e of entries) f.write(`${JSON.stringify(e)}\n`, { append: true });
  } catch {}
}

/** Keep the words for a turn this phone cannot send yet, under a requestId of their own. */
export function queueTurn(text: string): string {
  const rid = randomUUID();
  append({ t: 'you', text });
  rewriteOutbox([...loadOutbox(), { rid, text, state: 'queued' }]);
  return rid;
}

/** The turns waiting for a connection, oldest first. */
export const queuedTurns = (): OutboxEntry[] => loadOutbox().filter((e) => e.state === 'queued');

/** A turn left the outbox: it went, or the person chose to send it again themselves. */
export const sentTurn = (rid: string) => rewriteOutbox(loadOutbox().filter((e) => e.rid !== rid));

/** The turn at the head of the outbox is going now. */
export const sendingTurn = (rid: string) =>
  rewriteOutbox(loadOutbox().map((e) => (e.rid === rid ? { ...e, state: 'sending' as const } : e)));

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

async function documentOf(spec: { name?: unknown; blocks?: unknown }, requestId: string, toolCallId: string): Promise<PhoneDocument> {
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
  // Pack to raw bytes and write them: no Buffer (Hermes has none) and no base64 blow-up on a phone.
  const bytes = new Uint8Array(await Packer.toArrayBuffer(new Document({ creator: 'Crewhouse', sections: [{ children }] })));
  // Use tool-call id for the filename to make it idempotent
  const fileName = `chief-${toolCallId}-${name}.docx`;
  const file = new File(Paths.document, fileName);
  file.create({ overwrite: true });
  file.write(bytes);
  return { name: `${name}.docx`, uri: file.uri, parts };
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

/** Chief's whole turn over a key route: stream the words, run the one tool it asks for, answer again. Bounded. */
export async function askPhone(turns: ChatTurn[], io: { onText: (t: string) => void; onDocument: (d: PhoneDocument) => void }, signal: AbortSignal): Promise<string> {
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
          // Check if this tool call was already started but interrupted
          const pending = getPendingRequest(call.id);
          if (pending && fileExists(pending.fileName)) {
            // File already exists from a previous interrupted run, reuse it
            const existingFile = new File(Paths.document, pending.fileName);
            const existingBytes = existingFile.readAsArrayBuffer();
            // We can't easily reconstruct the DocPart[] from the file, so we'll just use the existing file
            // The user will see "Interrupted. Retry?" in the chat and can choose to retry
            output = `Made ${pending.fileName}. The person can preview it and tap Share.`;
            // We still need to return a PhoneDocument for the io.onDocument call
            // Since we can't easily read back the parts, we'll create a minimal one
            io.onDocument({ name: pending.fileName, uri: existingFile.uri, parts: [] });
            documents++;
            markRequestDone(call.id);
          } else {
            // Write request index entry before the effect
            appendRequest({ rid: call.id, fileName: '', state: 'started' });
            const doc = await documentOf(call.arguments, call.id, call.id);
            documents++;
            io.onDocument(doc);
            output = `Made ${doc.name}. The person can preview it and tap Share.`;
            // Update the request entry with the actual file name and mark done
            const entries = loadRequests();
            const idx = entries.findIndex(e => e.rid === call.id && e.state === 'started');
            if (idx >= 0) {
              entries[idx] = { ...entries[idx], fileName: doc.uri.split('/').pop() || '', state: 'done' };
              rewriteRequests(entries);
            }
          }
        }
      } catch (e) { output = `The document was not made: ${e instanceof Error ? e.message : 'could not write the document'}.`; }
      messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: output }], isError: false, timestamp: Date.now() });
    }
  }
  throw new Error('Chief reached this phone\'s step limit. Try a smaller request, or ask once you have paired a computer.');
}
