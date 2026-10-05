// Real spreadsheets: a helper asks for one and crewd writes the .xlsx itself (exceljs) from the helper's spec, then reads
// it back as JSON for the app. The file, the dropdown, the frozen header and the preview are all checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { setup, settled, task } from './lab.ts';
import { buildWorkbook, readWorkbook } from '../src/workbooks.ts';
import JSZip from 'jszip';
import * as disk from '../src/bots.ts';

const ExcelJS = (await import('exceljs')).default;
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;

/** What the person asks for in the reference bar: one line, and a workbook the front desk can run the day on. */
const spec = {
  name: 'Hotel Guest Reception',
  sheets: [
    { name: 'Daily dashboard', columns: [{ header: 'Today', width: 24 }, { header: 'Number' }, { header: 'Where it comes from' }],
      rows: [['Arrivals', 6, 'Booking log'], ['Rooms ready', 3, "=COUNTIF('Rooms and housekeeping'!B2:B40,\"Ready\")"]] },
    { name: 'Booking and check-in', columns: [{ header: 'Guest' }, { header: 'Room' }, { header: 'Status', options: ['Booked', 'Checked in', 'Due out'] }, { header: 'Paid' }],
      rows: [['Amina Khan', '204', 'Checked in', 'yes'], ['Bilal Sheikh', '108', 'Booked', 'not yet']] },
    { name: 'Rooms and housekeeping', columns: [{ header: 'Room' }, { header: 'State', options: ['Dirty', 'Cleaning', 'Ready'] }, { header: 'Checked by' }],
      rows: [['204', 'Ready', 'Rani']] },
  ],
};

test('the workbook crewd writes is a real .xlsx: its sheets, the dropdown, the frozen bold header, the widths, the formula', async () => {
  const file = join(temp('built'), 'reception.xlsx');
  const built = await buildWorkbook(file, spec);
  assert.deepEqual(built.sheets, ['Daily dashboard', 'Booking and check-in', 'Rooms and housekeeping']);
  assert.equal(readFileSync(file).subarray(0, 2).toString(), 'PK', 'a real xlsx, not a spreadsheet-shaped text file');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.deepEqual(wb.worksheets.map((w: any) => w.name), built.sheets);
  for (const w of wb.worksheets) {
    assert.equal(w.views[0].state, 'frozen', `${w.name}: the header row stays put`);
    assert.equal(w.views[0].ySplit, 1);
    assert.ok(w.getCell('A1').font?.bold, `${w.name}: the header row is bold`);
  }
  const bookings = wb.worksheets[1];
  assert.equal(bookings.getCell('A1').value, 'Guest');
  assert.equal(bookings.getCell('C2').value, 'Checked in');
  const dv = bookings.getCell('C2').dataValidation as any;
  assert.equal(dv?.type, 'list');
  assert.deepEqual(dv?.formulae, ['"Booked,Checked in,Due out"']);
  assert.ok(bookings.getCell('C9').dataValidation, 'the dropdown runs on past the finished rows, so the person can keep typing');
  assert.equal(bookings.getCell('D9').dataValidation, undefined, 'only the column asked for');
  assert.equal(wb.worksheets[2].getColumn(1).width, 10, 'a default width of its own, not Excel of one character');
  assert.equal(wb.worksheets[0].getColumn(1).width, 24, 'the width the helper asked for');
  assert.equal((wb.worksheets[0].getCell('C3').value as any).formula, "COUNTIF('Rooms and housekeeping'!B2:B40,\"Ready\")", 'a formula, not the word "formula"');
  assert.equal((wb.worksheets[0].getCell('A1').fill as any)?.fgColor?.argb, 'FF1F2937', 'the header sits on a dark fill');
  assert.equal(wb.worksheets[0].getCell('A1').font?.color?.argb, 'FFFFFFFF', 'white bold header text');
  assert.equal((wb.worksheets[0].getCell('C3').fill as any)?.fgColor?.argb, 'FFDBEAFE', 'a calculated cell is blue');
  assert.equal((bookings.getCell('B2').fill as any)?.fgColor?.argb, 'FFFFF9C4', 'an input cell is yellow');
  assert.equal((bookings.getCell('C9').fill as any)?.fgColor?.argb, 'FFFFF9C4', 'the empty dropdown rows are inputs too');
  assert.equal((bookings.getCell('D9').fill as any)?.fgColor, undefined, 'only the column asked for');
});

test('styling: dates are real dates, formulas calculate on open, and a plain guide sheet stays plain', async () => {
  const file = join(temp('styled'), 'styled.xlsx');
  const long = 'A note the front desk keeps repeating to every guest at check-in, word for word, every single day';
  await buildWorkbook(file, { name: 'Styled', sheets: [
    { name: 'Bookings', columns: [{ header: 'Guest' }, { header: 'Arrives' }, { header: 'Status', options: ['Booked', 'Checked in'] }, { header: 'Note' }],
      rows: [['Amina Khan', '2026-10-03', 'Checked in', long], ['Bilal Sheikh', 'not a date', 'Booked', 'short']] },
    { name: 'Setup and guide', columns: [{ header: 'How to use this' }],
      rows: [['Type the guest name, the arrival date, and pick a status.']] },
  ] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const bookings = wb.worksheets[0];
  const arrives = bookings.getCell('B2').value;
  assert.ok(arrives instanceof Date, 'a YYYY-MM-DD string is a date, so date maths works');
  assert.equal(arrives.toISOString().slice(0, 10), '2026-10-03');
  assert.equal(bookings.getCell('B2').numFmt, 'yyyy-mm-dd');
  assert.equal(bookings.getCell('B3').value, 'not a date', 'anything else stays words');
  // exceljs writes calcPr but does not read it back, so check the bytes Excel itself will see.
  const xml = await (await JSZip.loadAsync(readFileSync(file))).file('xl/workbook.xml')!.async('string');
  assert.match(xml, /fullCalcOnLoad="1"/, 'Excel calculates the formulas when the person opens it');
  assert.equal(bookings.getCell('D2').alignment?.wrapText, true, 'a long note wraps instead of running off');
  assert.equal(bookings.getCell('A2').alignment?.wrapText, undefined, 'a short name does not');
  const guide = wb.worksheets[1];
  for (const addr of ['A1', 'A2']) {
    const cell = guide.getCell(addr);
    assert.notEqual((cell.fill as any)?.pattern, 'solid', `${addr}: the guide sheet carries no fills`);
  }
});

test('a sheet name Excel would refuse is made usable, and an empty sheet still gets its header', async () => {
  const file = join(temp('odd'), 'odd.xlsx');
  const odd = `Rooms: [clean] *?*${'x'.repeat(40)}`;
  const built = await buildWorkbook(file, { name: 'Odd', sheets: [
    { name: odd, columns: [{ header: 'Room' }], rows: [] },
    { name: odd, columns: [{ header: 'Room' }] },
  ] });
  assert.doesNotMatch(built.sheets[0], /[[\]:*?/\\]/, 'the characters Excel refuses are gone');
  assert.equal(built.sheets[0].length, 31, 'cut to what a sheet name may be');
  assert.equal(built.sheets[1], `${built.sheets[0].slice(0, 27)} 2`, 'the second one of the same name is numbered');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.deepEqual(wb.worksheets.map((w: any) => w.getRow(1).getCell(1).value), ['Room', 'Room']);
});

test('the preview JSON: every sheet, its headings and its first rows, as words and counts only', async () => {
  const file = join(temp('preview'), 'multi.xlsx');
  await buildWorkbook(file, spec);
  const json = await readWorkbook(file);
  assert.deepEqual(json.sheets.map((s: any) => s.name), ['Daily dashboard', 'Booking and check-in', 'Rooms and housekeeping']);
  assert.deepEqual(json.sheets[1].rows[0], ['Guest', 'Room', 'Status', 'Paid']);
  assert.deepEqual(json.sheets[1].rows[1], ['Amina Khan', '204', 'Checked in', 'yes']);
  assert.deepEqual(json.sheets[1].rows.at(-1), ['Bilal Sheikh', '108', 'Booked', 'not yet']);
  assert.equal(json.sheets[1].total, 3, 'the header and the finished rows, not the blank ones under the dropdown');
  assert.equal(json.sheets[0].rows[2][2], '1', 'a fresh formula reads its worked-out value, never "auto" or the formula text');
  for (const s of json.sheets) {
    for (const r of s.rows) for (const c of r) { assert.doesNotMatch(c, /^=/, 'no preview cell ever shows a formula'); assert.doesNotMatch(c, /—/, 'no quiet dash either'); }
    assert.deepEqual(s.nums, s.rows.map((_: any, i: number) => i + 1), 'row numbers run with the rows when none are blank');
    assert.equal(s.roles.length, s.rows.length, 'one role per row');
    for (const r of s.roles) for (const c of r) assert.match(c, /^(head|in|calc|)$/, 'roles are lowercase words only');
  }
  assert.deepEqual(json.sheets[0].roles[0], ['head', 'head', 'head'], 'the heading row');
  assert.deepEqual(json.sheets[0].roles[2], ['', '', 'calc'], 'a formula cell, from the formula not the fill');
  assert.deepEqual(json.sheets[1].roles[1], ['', '', 'in', ''], 'a dropdown cell, from the validation not the fill');

  // A blank row in the spec leaves a gap in the numbers, not a row in the table.
  const gapFile = join(temp('gap'), 'gap.xlsx');
  await buildWorkbook(gapFile, { name: 'Gap', sheets: [{ name: 'S', columns: [{ header: 'A' }], rows: [['one'], [], ['three']] }] });
  const gap = await readWorkbook(gapFile);
  assert.deepEqual(gap.sheets[0].rows, [['A'], ['one'], ['three']]);
  assert.deepEqual(gap.sheets[0].nums, [1, 2, 4], 'the skipped blank row shows as a gap');

  // A file that carries its own computed values (as Excel does) shows them, not auto.
  const dir = temp('cached');
  const cached = new ExcelJS.Workbook();
  const ws = cached.addWorksheet('Maths');
  ws.addRow(['Guests', 6]);
  ws.addRow(['Beds', { formula: 'B1+2', result: 8 }]);
  ws.addRow(['Total', { formula: 'SUM(B1:B2)*2-COUNTIF(A1:A3,"beds")' }, { formula: "IF(B1>5,\"busy\",\"calm\")&\" day\"" }]);
  ws.addRow(['Twice', { formula: 'B3+B3' }, { formula: 'C4' }]);
  await cached.xlsx.writeFile(join(dir, 'cached.xlsx'));
  const again = await readWorkbook(join(dir, 'cached.xlsx'));
  assert.deepEqual(again.sheets[0].rows[1], ['Beds', '8'], 'the computed value, when the file has one');
  assert.deepEqual(again.sheets[0].rows[2], ['Total', '27', 'busy day'], 'a fresh formula is worked out from its cells');
  assert.deepEqual(again.sheets[0].rows[3], ['Twice', '54', '0'], 'a formula read twice counts twice; one that reads itself reads as an empty cell, 0');
  assert.deepEqual(JSON.parse(JSON.stringify(json)), json, 'plain JSON: no dates, no library objects');
});

test('a helper makes one in its own chat: the file lands in files/, is delivered, and only delivered files open', async () => {
  const { cfg, db, crew } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const id = (await crew.post('quill', `create an excel for reception ${call('crew_workbook', spec)}`))!.task;
  await settled(db, id);
  assert.equal(task(db, id).state, 'done');

  const rel = `files/hotel-guest-reception.xlsx`;
  const full = join(disk.botDir(cfg, 'quill'), rel);
  assert.ok(existsSync(full), 'the workbook is in the helper folder');
  const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
  assert.deepEqual(delivered.map((d) => d.path), [rel]);
  assert.equal(delivered[0].task, id);
  assert.match(delivered[0].note, /^3 sheets: Daily dashboard, Booking and check-in, Rooms and housekeeping$/, 'the card line says what is in it');
  assert.ok((db.get("SELECT text FROM messages WHERE bot = 'quill' AND author = 'system' AND text LIKE 'Delivered%'") as any).text.startsWith(`Delivered ${rel}: 3 sheets:`));

  const view = await crew.workbookView('quill', rel);
  assert.deepEqual((view as any).sheets.map((s: any) => s.name), ['Daily dashboard', 'Booking and check-in', 'Rooms and housekeeping']);
  await assert.rejects(() => crew.workbookView('quill', 'work/notes.md'), /not delivered to you/, 'a path nobody delivered is no window into the folder');

  // A delivered file that is not a workbook is not read as one.
  writeFileSync(join(disk.botDir(cfg, 'quill'), 'files', 'notes.txt'), 'a note instead');
  const other = (await crew.post('quill', `and a note ${call('crew_deliver', { path: 'files/notes.txt' })}`))!.task;
  await settled(db, other);
  await assert.rejects(() => crew.workbookView('quill', 'files/notes.txt'), /no such spreadsheet/, 'only a spreadsheet is read as one');
});

test('repeated requests for the same title get separate delivered files that both open', async () => {
  const { db, crew } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const mine = (await crew.post('quill', `a reception sheet ${call('crew_workbook', spec)}`))!.task;
  await settled(db, mine);
  const theirs = (await crew.post('quill', `a reception sheet ${call('crew_workbook', spec)}`, undefined))!.task;
  await settled(db, theirs);
  assert.equal(task(db, mine).state, 'done');
  assert.equal(task(db, theirs).state, 'done');
  const paths = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data).path);
  assert.equal(new Set(paths).size, 2, 'one file per task, no overwrite');
  assert.ok(/[a-z]\.xlsx$/.test(paths[0]) && paths[1] === paths[0].replace('.xlsx', '-2.xlsx'), 'a person reads the title, then -2: never a task id');
  const [a, b] = paths;
  assert.ok(await crew.workbookView('quill', b));
  assert.ok(await crew.workbookView('quill', a));
});

test('the make-spreadsheet skill carries the question, the spec shape and a buildable reception outline', async () => {
  const md = readFileSync(new URL('../skills/make-spreadsheet/SKILL.md', import.meta.url), 'utf8');
  // The frontmatter parses: the skill keeps its name and its two descriptions.
  assert.equal(/^name:\s*(.+)$/m.exec(md)?.[1]?.trim(), 'make-spreadsheet');
  assert.ok(/^description:\s*(.+)$/m.test(md), 'the model description is there');
  assert.ok(/^says:\s*(.+)$/m.test(md), 'the person-facing line is there');
  // Step 1: one question with kinds plus "something else", then stop.
  assert.match(md, /exactly one question/);
  assert.match(md, /something else/);
  // The spec shape the helper fills in, literally.
  assert.ok(md.includes('{name, sheets:[{name, columns:[{header,width?,options?}], rows}]}'));
  // The reception outline builds as-is.
  const json = /```json\r?\n([\s\S]*?)\r?\n```/.exec(md)?.[1];
  assert.ok(json, 'one fenced JSON outline');
  const outline = JSON.parse(json!);
  assert.deepEqual(outline.sheets.map((s: any) => s.name), ['Dashboard', 'Bookings & check-in', 'Rooms & housekeeping', 'Payments', 'Setup & guide']);
  for (const s of outline.sheets) assert.equal(s.rows.length, 1, `${s.name}: one example row`);
  const status = outline.sheets[1].columns.at(-1);
  assert.deepEqual(status.options, ['Booked', 'Checked in', 'Due out'], 'options on status');
  assert.deepEqual(outline.sheets[3].columns[2].options, ['Cash', 'Card', 'Transfer', 'Unpaid'], 'options on payment');
  assert.match(outline.sheets[1].rows[0][2], /^\d{4}-\d{2}-\d{2}$/, 'ISO dates');
  const file = join(temp('skill-outline'), 'reception.xlsx');
  const built = await buildWorkbook(file, outline);
  assert.deepEqual(built.sheets, outline.sheets.map((s: any) => s.name));
  const view = await readWorkbook(file);
  assert.deepEqual(view.sheets[1].rows[1], ['Amina Khan', '204', '2026-10-01', 'Checked in']);
});
