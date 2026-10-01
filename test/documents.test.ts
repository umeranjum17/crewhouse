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

  const rel = JSON.parse(db.get("SELECT data FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') = ?", id)!.data).path;
  const full = join(disk.botDir(cfg, 'quill'), rel);
  assert.ok(existsSync(full), 'the document is in the helper folder');
  const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
  assert.deepEqual(delivered.map((d) => d.path), [rel]);
  assert.equal(delivered[0].title, spec.name);
  assert.equal(crew.fileFor('quill', rel)?.title, spec.name);
  assert.match(delivered[0].note, /^The Front-desk handbook is ready: /, 'the card line names the result, not a section count');
  assert.doesNotMatch(delivered[0].note, /A document in|\b\d+ sections?\b/);

  const view = await crew.documentView('quill', rel);
  assert.equal((view as any).parts.length, 9);
  await assert.rejects(() => crew.documentView('quill', 'work/draft.md'), /not delivered to you/, 'a path nobody delivered is no window into the folder');

  // A delivered .md leaves as its own words for the app's shared safe renderer — never opened as the raw file.
  writeFileSync(join(disk.botDir(cfg, 'quill'), 'files', 'weekly-dinners.md'),
    '# This week\'s dinners\n\n- [x] Basmati rice\n- [ ] Yoghurt\n');
  const listed = (await crew.post('quill', `and the dinners list ${call('crew_deliver', { path: 'files/weekly-dinners.md', title: "This week's dinners — Maya" })}`))!.task;
  await settled(db, listed);
  const md = await crew.documentView('quill', 'files/weekly-dinners.md') as any;
  assert.equal(md.text, "# This week's dinners\n\n- [x] Basmati rice\n- [ ] Yoghurt\n");
  assert.equal(md.title, "This week's dinners — Maya");

  // A delivered file that is not a readable page is still not read as one.
  writeFileSync(join(disk.botDir(cfg, 'quill'), 'files', 'table.csv'), 'a,b\n1,2');
  const other = (await crew.post('quill', `and a table ${call('crew_deliver', { path: 'files/table.csv' })}`))!.task;
  await settled(db, other);
  await assert.rejects(() => crew.documentView('quill', 'files/table.csv'), /no such document/, 'only a page is read as one');
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
  assert.ok(paths.every((p: string) => /^files\/[a-f0-9]{64}\.docx$/.test(p)), 'opaque storage names contain no human title or task suffix');
  const [a, b] = paths;
  assert.ok(await crew.documentView('quill', b));
  assert.ok(await crew.documentView('quill', a));
});


test('producer titles survive registration, previews and core metadata without becoming storage paths', async () => {
  const { cfg, db, crew } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const JSZip = (await import('jszip')).default;
  const { xml2js } = await import('xml-js');
  const titles = [
    'Refund follow-up — stroller return',
    'Babyzen YOYO2 vs Bugaboo Butterfly for a four-year-old',
    'Why Dubai evenings get so humid in autumn',
    'Thank-you to Maya — case, punctuation & café',
    '../../outside/Refund \\ Maya: follow-up',
    'Refund follow-up — stroller return',
  ];
  for (const tool of ['crew_document', 'crew_workbook']) {
    const paths = new Set<string>();
    for (const [n, title] of titles.entries()) {
      const body = `result ${n}`;
      const input = tool === 'crew_document' ? { name: title, blocks: [{ text: body }] }
        : { name: title, sheets: [{ name: 'Answer', columns: [{ header: 'Result' }], rows: [[body]] }] };
      const id = (await crew.post('quill', `Make this ${call(tool, input)}`))!.task;
      await settled(db, id);
      assert.equal(task(db, id).state, 'done');
      const delivery = JSON.parse(db.get("SELECT data FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') = ?", id)!.data);
      assert.equal(delivery.title, title, 'authoritative human title is verbatim, not a slug or free-form note');
      assert.match(delivery.path, /^files\/[a-f0-9]{64}\.(docx|xlsx)$/);
      assert.ok(!paths.has(delivery.path), 'same title in another task must not overwrite its predecessor');
      paths.add(delivery.path);
      const full = disk.insideBot(cfg, 'quill', delivery.path);
      assert.ok(full.startsWith(join(disk.botDir(cfg, 'quill'), 'files') + '/'));
      const core = await (await JSZip.loadAsync(readFileSync(full))).file('docProps/core.xml')!.async('string');
      assert.equal((xml2js(core, { compact: true }) as any)['cp:coreProperties']['dc:title']._text, title);
      const view = tool === 'crew_document' ? await crew.documentView('quill', delivery.path) : await crew.workbookView('quill', delivery.path);
      assert.equal(view.title, title);
      assert.ok(JSON.stringify(view).includes(body), 'the delivered body belongs to this task');
      assert.equal(crew.snapshot().tasks.find((t: any) => t.id === id)!.fileTitles[delivery.path], title);
      assert.equal(crew.botPage('quill').files.find((f: any) => 'files/' + f.path === delivery.path)!.title, title);
      assert.equal(crew.fileFor('chief', delivery.path), undefined, 'another bot cannot open this file');
      await assert.rejects(() => crew.documentView('quill', '../../outside.docx'), /not delivered/);
      await assert.rejects(() => crew.workbookView('quill', '../../outside.xlsx'), /not delivered/);
    }
    // Every earlier task still opens with its own body and title after later duplicate-title requests.
    const deliveries = db.all("SELECT data FROM events WHERE kind = 'file.delivered' ORDER BY seq").map((e: any) => JSON.parse(e.data)).filter((d: any) => paths.has(d.path));
    for (const [n, d] of deliveries.entries()) {
      const view = tool === 'crew_document' ? await crew.documentView('quill', d.path) : await crew.workbookView('quill', d.path);
      assert.equal(view.title, titles[n]);
      assert.ok(JSON.stringify(view).includes(`result ${n}`));
    }
  }
});
