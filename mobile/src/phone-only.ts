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
export const phoneSignOut = () => phoneAccounts.logout(MEMBER, PROVIDER);
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

async function documentOf(spec: { name?: unknown; blocks?: unknown }): Promise<PhoneDocument> {
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
  const file = new File(Paths.document, `chief-${Date.now()}-${name}.docx`);
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
        else { const doc = await documentOf(call.arguments); documents++; io.onDocument(doc); output = `Made ${doc.name}. The person can preview it and tap Share.`; }
      } catch (e) { output = `The document was not made: ${e instanceof Error ? e.message : 'could not write the document'}.`; }
      messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: output }], isError: false, timestamp: Date.now() });
    }
  }
  throw new Error('Chief reached this phone’s step limit. Try a smaller request, or ask once you have paired a computer.');
}
