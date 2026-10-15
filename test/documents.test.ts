// Real documents: a helper asks for one and crewd writes the .docx itself (docx, pinned) from the helper's spec, then
// reads it back as plain parts for the app. The file, the preview and who may see it are all checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { setup, settled, task } from './lab.ts';
import { buildDocument, readDocument } from '../src/documents.ts';
import { buildDeck, readDeck } from '../src/slides.ts';
import * as disk from '../src/bots.ts';
import * as A from '../web/src/adapter.ts';

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

test('the document reader preserves a long paragraph and source URL', async () => {
  const file = join(temp('long-doc'), 'brief.docx');
  const paragraph = 'Claude Code and Codex ' + 'a'.repeat(591);
  assert.equal(paragraph.length, 613);
  const citation = 'Rates: [SEC](https://www.sec.gov/x)';
  await buildDocument(file, { name: 'Brief', blocks: [{ text: paragraph }, { text: 'Source: https://www.sec.gov/rules/' }, { text: citation }] });
  const read = await readDocument(file);
  assert.equal(read.parts[0].text, paragraph);
  assert.equal(read.parts[1].text, 'Source: https://www.sec.gov/rules/');
  assert.equal(read.parts[2].text, citation, 'a written citation survives the .docx verbatim, ready to render as a link');
});

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

test('a helper makes one in its own chat: the file lands in files/, is delivered, and only delivered files open', async () => {
  const { cfg, db, crew } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const id = (await crew.post('quill', `write the desk rules as a word document ${call('crew_document', spec)}`))!.task;
  await settled(db, id);
  assert.equal(task(db, id).state, 'done');

  const rel = `files/front-desk-handbook.docx`;
  const full = join(disk.botDir(cfg, 'quill'), rel);
  assert.ok(existsSync(full), 'the document is in the helper folder');
  const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
  assert.deepEqual(delivered.map((d) => d.path), [rel]);
  assert.match(delivered[0].note, /^The Front-desk handbook is ready: /, 'the card line names the result, not a section count');
  assert.doesNotMatch(delivered[0].note, /A document in|\b\d+ sections?\b/);

  const view = await crew.documentView('quill', rel);
  assert.equal((view as any).parts.length, 9);
  await assert.rejects(() => crew.documentView('quill', 'work/draft.md'), /not delivered to you/, 'a path nobody delivered is no window into the folder');

  // A delivered .md leaves as its own words for the app's shared safe renderer — never opened as the raw file.
  writeFileSync(join(disk.botDir(cfg, 'quill'), 'files', 'weekly-dinners.md'),
    '# This week\'s dinners\n\n- [x] Basmati rice\n- [ ] Yoghurt\n');
  const listed = (await crew.post('quill', `and the dinners list ${call('crew_deliver', { path: 'files/weekly-dinners.md' })}`))!.task;
  await settled(db, listed);
  const md = await crew.documentView('quill', 'files/weekly-dinners.md') as any;
  assert.equal(md.text, "# This week's dinners\n\n- [x] Basmati rice\n- [ ] Yoghurt\n");

  // A delivered file that is not a readable page is still not read as one.
  writeFileSync(join(disk.botDir(cfg, 'quill'), 'files', 'table.csv'), 'a,b\n1,2');
  const other = (await crew.post('quill', `and a table ${call('crew_deliver', { path: 'files/table.csv' })}`))!.task;
  await settled(db, other);
  await assert.rejects(() => crew.documentView('quill', 'files/table.csv'), /no such document/, 'only a page is read as one');

  // Quill's shelf (Details, "What Quill made") is exactly what it delivered, newest first: never the undelivered draft.
  assert.deepEqual(A.made(crew.snapshot(), 'quill').map((f) => A.fileSource(f.url)?.path), ['files/table.csv', 'files/weekly-dinners.md', rel]);
});


/** A deck the reference bar asks for: a stand-up someone can actually run. */
const deckSpec = {
  name: 'Weekend away',
  slides: [
    { title: 'Weekend away', bullets: ['Two nights by the sea', 'Train leaves at 09:12 on Saturday'] },
    { title: 'What to pack', bullets: ['Warm coat', 'Trainers for the coastal path', 'The paper tickets'] },
    { title: 'Costs', bullets: ['Train £42', 'B&B £120'] },
  ],
};

test('the deck crewd writes is a real .pptx: the parts PowerPoint needs, its slides read back as slides and as parts', async () => {
  const file = join(temp('deck'), 'weekend-away.pptx');
  const built = await buildDeck(file, deckSpec);
  assert.deepEqual(built.slides, ['Weekend away', 'What to pack', 'Costs']);
  assert.equal(readFileSync(file).subarray(0, 2).toString(), 'PK', 'a real pptx, not a deck-shaped text file');

  // Every part a presentation needs is there, and the presentation reaches every slide through the layout.
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(readFileSync(file));
  for (const part of ['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/presProps.xml', 'ppt/viewProps.xml', 'ppt/tableStyles.xml',
    'ppt/theme/theme1.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slides/slide3.xml']) {
    assert.ok(zip.file(part), `${part} is missing`);
  }
  assert.equal((await zip.file('ppt/presentation.xml')!.async('string')).match(/<p:sldId /g)?.length, 3, 'one slide id per slide');
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
  assert.match(rels, /Target="slides\/slide1\.xml"/, 'the presentation reaches the first slide');
  assert.match(rels, /Target="slideMasters\/slideMaster1\.xml"/);
  const slide = await zip.file('ppt/slides/slide2.xml')!.async('string');
  assert.match(slide, /<a:t>What to pack<\/a:t>/, 'the slide title is the title');
  assert.match(slide, /<a:t>Warm coat<\/a:t>/, 'and its lines are its lines');
  await assert.rejects(() => buildDeck(join(temp('empty-deck'), 'empty.pptx'), { name: 'Empty', slides: [] }), /at least one slide/, 'an empty deck is a plain refusal, no file');

  // The preview JSON: one entry per slide, words only, plus the same words flattened as document parts.
  const json = await readDeck(file) as any;
  assert.deepEqual(json.slides.map((s: any) => s.title), ['Weekend away', 'What to pack', 'Costs']);
  assert.deepEqual(json.slides[1].lines, ['Warm coat', 'Trainers for the coastal path', 'The paper tickets']);
  assert.deepEqual(json.parts[0], { kind: 'heading', text: 'Weekend away' });
  assert.deepEqual(json.parts.filter((p: any) => p.kind === 'li').map((p: any) => p.text), deckSpec.slides.flatMap((s) => s.bullets));
  for (const s of json.slides) for (const w of [s.title, ...s.lines]) assert.doesNotMatch(w, /<p:|<\/a:|&lt;/, 'no raw markup in the preview');
  assert.doesNotMatch(JSON.stringify(json), /xref|\/media\//, 'no machinery either');
  assert.deepEqual(JSON.parse(JSON.stringify(json)), json, 'plain JSON: no library objects');
});

test('a helper makes a deck in its own chat: the .pptx lands in files/, is delivered, and only delivered files open', async () => {
  const { cfg, db, crew } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const id = (await crew.post('quill', `make the weekend a slide deck ${call('crew_slides', deckSpec)}`))!.task;
  await settled(db, id);
  assert.equal(task(db, id).state, 'done');

  const rel = 'files/weekend-away.pptx';
  assert.ok(existsSync(join(disk.botDir(cfg, 'quill'), rel)), 'the deck is in the helper folder');
  const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
  assert.deepEqual(delivered.map((d: any) => d.path), [rel]);
  assert.equal(delivered[0].note, '3 slides: Weekend away, What to pack, Costs', 'the card line says what is in it');

  const view = await crew.documentView('quill', rel) as any;
  assert.deepEqual(view.slides.map((s: any) => s.title), ['Weekend away', 'What to pack', 'Costs'], 'the same endpoint reads a deck, after delivery');
  await assert.rejects(() => crew.documentView('quill', 'work/draft.pptx'), /not delivered to you/, 'a path nobody delivered is no window into the folder');

  // The app's own reading of it: a written page the app opens in its panel, and a deck the panel draws as slides.
  const f = A.fileView('quill', rel);
  assert.ok(A.deckFile(f), 'a .pptx is a deck, not a document');
  assert.equal(A.fileTarget(f)?.href, `#/f/quill/${encodeURIComponent(rel)}`, 'a deck opens the read-only panel, never the raw file');
  assert.deepEqual(A.deck(view, f.name).slides.map((s) => s.title), ['Weekend away', 'What to pack', 'Costs']);
  assert.equal(A.slideWords(3), '3 slides');
});

test('repeated requests for the same title get separate delivered files that both open', async () => {
  const { db, crew } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const mine = (await crew.post('quill', `the desk rules ${call('crew_document', spec)}`))!.task;
  await settled(db, mine);
  const theirs = (await crew.post('quill', `the desk rules ${call('crew_document', spec)}`, undefined))!.task;
  await settled(db, theirs);
  assert.equal(task(db, mine).state, 'done');
  assert.equal(task(db, theirs).state, 'done');
  const paths = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data).path);
  assert.equal(new Set(paths).size, 2, 'one file per task, no overwrite');
  assert.ok(/[a-z]\.docx$/.test(paths[0]) && paths[1] === paths[0].replace('.docx', '-2.docx'), 'a person reads the title, then -2: never a task id');
  const [a, b] = paths;
  assert.ok(await crew.documentView('quill', b));
  assert.ok(await crew.documentView('quill', a));
});
