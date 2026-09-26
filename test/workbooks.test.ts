// Real spreadsheets: a helper asks for one and crewd writes the .xlsx itself (exceljs) from the helper's spec, then reads
// it back as JSON for the app. The file, the dropdown, the frozen header and the preview are all checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { setup, settled, task } from './lab.ts';
import { buildWorkbook, readWorkbook } from '../src/workbooks.ts';
import * as disk from '../src/bots.ts';

const ExcelJS = (await import('exceljs')).default;
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;

/** What the person asks for in the reference bar: one line, and a workbook the front desk can run the day on. */
const spec = {
  name: 'Hotel Guest Reception',
  sheets: [
    { name: 'Daily dashboard', columns: [{ header: 'Today', width: 24 }, { header: 'Number' }, { header: 'Where it comes from' }],
      rows: [['Arrivals', 6, 'Booking log'], ['Rooms ready', 3, '=COUNTIF(Rooms!D2:D40,"Ready")']] },
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
  assert.equal((wb.worksheets[0].getCell('C3').value as any).formula, 'COUNTIF(Rooms!D2:D40,"Ready")', 'a formula, not the word "formula"');
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
  assert.equal(json.sheets[0].rows[2][2], '—', 'a formula with no computed value is a quiet dash, never the formula text');
  for (const s of json.sheets) for (const r of s.rows) for (const c of r) assert.doesNotMatch(c, /^=/, 'no preview cell ever shows a formula');

  // A file that carries its own computed values (as Excel does) shows them, not the dash.
  const dir = temp('cached');
  const cached = new ExcelJS.Workbook();
  const ws = cached.addWorksheet('Maths');
  ws.addRow(['Guests', 6]);
  ws.addRow(['Beds', { formula: 'B1+2', result: 8 }]);
  await cached.xlsx.writeFile(join(dir, 'cached.xlsx'));
  const again = await readWorkbook(join(dir, 'cached.xlsx'));
  assert.deepEqual(again.sheets[0].rows[1], ['Beds', '8'], 'the computed value, when the file has one');
  assert.deepEqual(JSON.parse(JSON.stringify(json)), json, 'plain JSON: no dates, no library objects');
});

test('a helper makes one in its own chat: the file lands in files/, is delivered, and only its member may read it', async () => {
  const { cfg, db, crew } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const id = (await crew.post('quill', `create an excel for reception ${call('crew_workbook', spec)}`))!.task;
  await settled(db, id);
  assert.equal(task(db, id).state, 'done');

  const rel = 'files/hotel-guest-reception.xlsx';
  const full = join(disk.botDir(cfg, 'quill'), rel);
  assert.ok(existsSync(full), 'the workbook is in the helper folder');
  const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
  assert.deepEqual(delivered.map((d) => d.path), [rel]);
  assert.equal(delivered[0].task, id);
  assert.match(delivered[0].note, /^3 sheets: Daily dashboard, Booking and check-in, Rooms and housekeeping$/, 'the card line says what is in it');
  assert.ok((db.get("SELECT text FROM messages WHERE bot = 'quill' AND author = 'system' AND text LIKE 'Delivered%'") as any).text.startsWith(`Delivered ${rel}: 3 sheets:`));

  const view = await crew.workbookView('quill', rel, 1);
  assert.deepEqual((view as any).sheets.map((s: any) => s.name), ['Daily dashboard', 'Booking and check-in', 'Rooms and housekeeping']);
  await assert.rejects(() => crew.workbookView('quill', rel, 2), /not delivered to you/, 'another member screen never sees it');
  await assert.rejects(() => crew.workbookView('quill', 'work/notes.md', 1), /not delivered to you/, 'a path nobody delivered is no window into the folder');

  // A delivered file that is not a workbook is not read as one.
  writeFileSync(join(disk.botDir(cfg, 'quill'), 'files', 'notes.txt'), 'a note instead');
  const other = (await crew.post('quill', `and a note ${call('crew_deliver', { path: 'files/notes.txt' })}`))!.task;
  await settled(db, other);
  await assert.rejects(() => crew.workbookView('quill', 'files/notes.txt', 1), /no such spreadsheet/, 'only a spreadsheet is read as one');
});
