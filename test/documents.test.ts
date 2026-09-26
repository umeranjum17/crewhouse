// Real documents: a helper asks for one and crewd writes the .docx itself (docx, pinned) from the helper's spec, then
// reads it back as plain parts for the app. The file, the preview and who may see it are all checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { setup, settled, task } from './lab.ts';
import { buildDocument, readDocument } from '../src/documents.ts';
import * as disk from '../src/bots.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;

/** The document the reference bar asks for: one line, then a handbook the desk can actually use. */
const spec = {
  name: 'Front-desk handbook',
  blocks: [
    { heading: 'Front-desk handbook', level: 1 },
    { text: 'How the desk runs on an ordinary day.', italic: true },
    { heading: 'Opening the day' },
    { bullets: ['Count the till', 'Walk the free rooms', 'Print the arrivals'] },
    { heading: 'Today' },
    { table: { head: ['Shift', 'On the desk'], rows: [['Morning', 'Rani'], ['Evening', 'Yusuf']] } },
    { text: 'Say the word to change anything.', bold: true },
  ],
};

test('the document crewd writes is a real .docx: its headings, lists, table and bold, read back as plain parts', async () => {
  const file = join(temp('doc'), 'handbook.docx');
  const built = await buildDocument(file, spec);
  assert.equal(built.parts, spec.blocks.length);
  assert.equal(readFileSync(file).subarray(0, 2).toString(), 'PK', 'a real docx, not a document-shaped text file');

  // The parts crewd reads out of it, and nothing else: no markup, no machinery, no formula-looking words.
  const json = await readDocument(file);
  assert.deepEqual(json.parts[0], { kind: 'heading', text: 'Front-desk handbook' });
  assert.deepEqual(json.parts.filter((p) => p.kind === 'li').map((p) => p.text), ['Count the till', 'Walk the free rooms', 'Print the arrivals']);
  assert.deepEqual(json.parts.find((p) => p.kind === 'table'), { kind: 'table', head: ['Shift', 'On the desk'], rows: [['Morning', 'Rani'], ['Evening', 'Yusuf']] });
  assert.equal(json.parts.at(-1)?.bold, true, 'bold comes through as a flag, not markup');
  for (const p of json.parts) {
    assert.doesNotMatch(p.text ?? '', /^=/, 'no cell of a preview starts with a formula');
    assert.doesNotMatch(p.text ?? '', /<w:|<\/[a-z]/, 'no raw markup in the preview');
    assert.equal((p as any).formula, undefined);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(json)), json, 'plain JSON: no library objects');

  // And the file itself keeps the real document structure: a heading style, a numbering definition, a table.
  const JSZip = (await import('jszip')).default;
  const xml = await JSZip.loadAsync(readFileSync(file)).then((z: any) => z.file('word/document.xml').async('string'));
  assert.match(xml, /w:val="Heading1"/, 'the title is a real heading, not a big bold line');
  assert.match(xml, /<w:tbl>/, 'the table is a real table');
  assert.match(xml, /<w:numPr>/, 'the bullets are real list items');
});

test('a helper makes one in its own chat: the file lands in files/, is delivered, and only its member may read it', async () => {
  const { cfg, db, crew } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const id = (await crew.post('quill', `write the desk rules as a word document ${call('crew_document', spec)}`))!.task;
  await settled(db, id);
  assert.equal(task(db, id).state, 'done');

  const rel = 'files/front-desk-handbook.docx';
  const full = join(disk.botDir(cfg, 'quill'), rel);
  assert.ok(existsSync(full), 'the document is in the helper folder');
  const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
  assert.deepEqual(delivered.map((d) => d.path), [rel]);
  assert.match(delivered[0].note, /^A document in 3 sections: Front-desk handbook$/, 'the card line says what is in it');

  const view = await crew.documentView('quill', rel, 1);
  assert.equal((view as any).parts.length, 9);
  await assert.rejects(() => crew.documentView('quill', rel, 2), /not delivered to you/, 'another member screen never sees it');
  await assert.rejects(() => crew.documentView('quill', 'work/draft.md', 1), /not delivered to you/, 'a path nobody delivered is no window into the folder');

  // A delivered file that is not a document is not read as one.
  writeFileSync(join(disk.botDir(cfg, 'quill'), 'files', 'notes.txt'), 'a note instead');
  const other = (await crew.post('quill', `and a note ${call('crew_deliver', { path: 'files/notes.txt' })}`))!.task;
  await settled(db, other);
  await assert.rejects(() => crew.documentView('quill', 'files/notes.txt', 1), /no such document/, 'only a document is read as one');
});
