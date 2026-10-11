// Proof-stage phone-only glue: move this into BYOKit's kit when the cross-kit phone-first plan
// (Main2211) defines that surface. No engine, sessions, providers, memory or downloaded tools.
import { Accounts, IncompleteError, ResponseError, isFunctionCall, secureStore, type ResponseInputItem, type ResponseTool } from '@byokit/accounts';
import * as SecureStore from 'expo-secure-store';
import { fetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import soul from '../../templates/chief/soul.md';
import job from '../../templates/chief/AGENTS.md';
import type { DocPart } from '../../web/src/adapter.ts';

export const phoneAccounts = new Accounts({ offer: ['chatgpt'], fetch: fetch as typeof globalThis.fetch,
  store: () => secureStore(SecureStore, 'crewhouse.phone-only', { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }) });
const mode = new File(Paths.document, 'phone-only');
export const phoneMode = () => mode.exists;
export function setPhoneMode(on: boolean) { if (on) mode.write('phone'); else if (mode.exists) mode.delete(); }
export type PhoneDocument = { name: string; uri: string; parts: DocPart[] };
export const shareDocument = (doc: PhoneDocument) => shareAsync(doc.uri, {
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', UTI: 'org.openxmlformats.wordprocessingml.document', dialogTitle: doc.name });
export function phoneWords(error: unknown) {
  if (error instanceof IncompleteError) return "Chief's answer was cut short. Please try again.";
  if (error instanceof ResponseError) return error.kind === 'network' ? 'No internet connection. Reconnect, then try again.' : error.message;
  return 'Could not finish on this phone. Check your internet connection and try again.';
}
const instructions = `${soul}\n${job}\n\nPHONE ONLY: These rules override computer and crew instructions above.
You are Chief running on this phone, with no computer or helpers. Answer and draft here yourself.
Only crew_document is available. Use it to make a document; stream a short sentence before the call.
Browser work, coding, files outside this app, connected apps, sending, recruiting, memory and scheduled work need a computer.
For those asks say plainly that you need a computer; never claim you did them or suggest unavailable controls.
Nothing is shared until the person taps Share. Never claim anything has been sent.`;
const tool: ResponseTool = { type: 'function', name: 'crew_document', description: 'Make a small Word document on this phone. Use headings, paragraphs and bullet lists.', strict: true,
  parameters: { type: 'object', additionalProperties: false, required: ['name', 'blocks'], properties: {
    name: { type: 'string' }, blocks: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['heading', 'text', 'bullets'], properties: { heading: { type: ['string', 'null'] }, text: { type: ['string', 'null'] },
        bullets: { type: ['array', 'null'], items: { type: 'string' } } } } } } } };

async function documentOf(args: string): Promise<PhoneDocument> {
  if (args.length > 60_000) throw new Error('This document is too large for phone-only mode. It needs a computer.');
  const spec = JSON.parse(args), parts: DocPart[] = [], children: Paragraph[] = [];
  if (typeof spec.name !== 'string' || !spec.name.trim() || !Array.isArray(spec.blocks) || !spec.blocks.length || spec.blocks.length > 80)
    throw new Error('The document needs a title and between one and 80 parts.');
  let size = 0;
  const words = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000 || (size += value.length) > 40_000)
      throw new Error('The document has a missing line or too many words for this phone.');
    return value.replace(/\r?\n/g, ' ');
  };
  for (const block of spec.blocks) {
    if (!block || [block.heading, block.text, block.bullets].filter((v) => v != null).length !== 1)
      throw new Error('Each document part needs one heading, paragraph or bullet list.');
    if (block.heading != null) {
      const text = words(block.heading); parts.push({ kind: 'heading', text }); children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }));
    } else if (block.text != null) {
      const text = words(block.text); parts.push({ kind: 'p', text }); children.push(new Paragraph({ text }));
    } else {
      if (!Array.isArray(block.bullets) || !block.bullets.length || block.bullets.length > 30) throw new Error('A phone document list needs between one and 30 lines.');
      for (const item of block.bullets) { const text = words(item); parts.push({ kind: 'li', text }); children.push(new Paragraph({ text, bullet: { level: 0 } })); }
    }
  }
  const name = spec.name.replace(/\.docx$/i, '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'Document';
  const data = await Packer.toBase64String(new Document({ creator: 'Crewhouse', sections: [{ children }] }));
  const file = new File(Paths.document, `chief-${Date.now()}-${name}.docx`);
  file.write(data, { encoding: 'base64' });
  return { name: `${name}.docx`, uri: file.uri, parts };
}

export async function askPhone(input: ResponseInputItem[], onText: (text: string) => void, onDocument: (doc: PhoneDocument) => void, signal: AbortSignal) {
  const turns = [...input]; let text = '', documents = 0;
  for (let step = 0; step < 3; step++) {
    const before = text;
    const result = await phoneAccounts.respond(1, { instructions, input: turns, tools: [tool], parallelToolCalls: false, signal,
      onText: (delta) => { text += delta; onText(text); } });
    text = before + result.text; onText(text);
    turns.push(...result.output as ResponseInputItem[]);
    const calls = result.output.filter(isFunctionCall);
    if (!calls.length) return text;
    text += '\n\n';
    for (const call of calls) {
      if (!call.call_id) throw new Error('Chief could not finish the document. Please ask again.');
      let output: string;
      try {
        if (call.name !== 'crew_document') output = 'This needs a computer. Only documents are available on this phone.';
        else if (documents) output = 'One document per request on this phone. Tell the person what you made.';
        else { const doc = await documentOf(call.arguments); documents++; onDocument(doc); output = `Made ${doc.name}. The person can preview it and tap Share.`; }
      } catch (e) { output = `Document not made: ${e instanceof SyntaxError ? 'The document description could not be read.' : e instanceof Error ? e.message : 'Could not write the document.'}`; }
      turns.push({ type: 'function_call_output', call_id: call.call_id, output });
    }
  }
  throw new Error('Chief reached the phone’s step limit. Try a smaller request, or use a computer.');
}
