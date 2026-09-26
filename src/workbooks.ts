// Real spreadsheets, made by crewd itself: a helper fills in a plain spec and exceljs (MIT, pinned in package.json)
// writes the .xlsx into the bot's folder; the same library reads one back as JSON for the app's read-only preview.
// The model never hand-writes the binary, and the app never parses it.
// The shape a helper fills in: one sheet per tab, one column per A/B/C…, rows are the finished rows (an example row included).
type Cell = string | number | boolean | null | undefined;
export type ColumnSpec = { header: string; width?: number; options?: string[] };
export type SheetSpec = { name: string; columns: ColumnSpec[]; rows?: Cell[][] };
export type WorkbookSpec = { name: string; sheets: SheetSpec[] };

// Bounds on what a model can ask for: a sheet with 10,000 columns is a mistake, not a spreadsheet.
const MAX = { sheets: 12, columns: 24, rows: 500, options: 40, dropdown: 200, width: 60 };
/** Excel's own limits on a sheet's name, plus ours on uniqueness. */
function sheetName(raw: string, taken: Set<string>, n: number) {
  const base = (raw.replace(/[[\]:*?/\\]/g, ' ').trim() || `Sheet ${n + 1}`).slice(0, 31);
  let name = base, i = 2;
  while (taken.has(name.toLowerCase())) name = `${base.slice(0, 27)} ${i++}`;
  taken.add(name.toLowerCase());
  return name;
}

/** exceljs is CommonJS, and only worth loading for the seconds it is used. */
const excel = () => import('exceljs').then((m: any) => m.default ?? m);

/** Write a workbook the person can open and use: bold frozen headers, sensible widths, dropdowns where they help. */
export async function buildWorkbook(file: string, spec: WorkbookSpec) {
  const ExcelJS = await excel();
  const sheets = Array.isArray(spec?.sheets) ? spec.sheets.slice(0, MAX.sheets) : [];
  if (!sheets.length) throw new Error('say what the workbook should have: at least one sheet with columns');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Crewhouse';
  wb.created = new Date();
  const taken = new Set<string>();
  sheets.forEach((s, n) => {
    const cols = (Array.isArray(s.columns) ? s.columns : []).slice(0, MAX.columns);
    if (!cols.length) throw new Error(`“${s.name ?? 'that sheet'}” has no columns: give each one a header`);
    const ws = wb.addWorksheet(sheetName(String(s.name ?? ''), taken, n));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const rows = (Array.isArray(s.rows) ? s.rows : []).slice(0, MAX.rows).map((r) => (Array.isArray(r) ? r : [r]).slice(0, MAX.columns));
    ws.columns = cols.map((c, i) => {
      const header = String(c?.header ?? '').trim().slice(0, 80) || `Column ${i + 1}`;
      const widest = Math.max(header.length, ...rows.map((r) => String(r[i] ?? '').length), 0);
      return { header, width: Math.min(MAX.width, Math.max(10, Number(c?.width) || Math.min(widest + 2, 42))) };
    });
    ws.getRow(1).font = { bold: true };
    for (const row of rows) {
      ws.addRow(row.map((v) => (typeof v === 'string' && v.startsWith('=') ? { formula: v.slice(1) } : v ?? null)));
    }
    cols.forEach((c, i) => {
      const options = (Array.isArray(c?.options) ? c.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, MAX.options);
      if (!options.length) return;
      // Fill the dropdowns down past the finished rows, so the person can keep typing in it.
      const until = Math.min(Math.max(rows.length + 10, 12), MAX.dropdown);
      for (let r = 2; r <= until; r++) ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${options.join(',')}"`] };
    });
  });
  await wb.xlsx.writeFile(file);
  return { sheets: wb.worksheets.map((w: any) => w.name) };
}

/** What a cell says, whatever kind of cell it is: one string for the preview's table. A formula shows its computed
 *  value when the file has one cached, or a quiet dash — never the formula text; the downloaded file keeps the real thing. */
function text(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => text(t.text)).join('');
    if ('result' in v || 'formula' in v) return v.result == null ? '—' : text(v.result);
    if ('text' in v) return text(v.text);
    if ('hyperlink' in v) return text(v.text ?? v.hyperlink);
    return '';
  }
  return typeof v === 'number' || typeof v === 'boolean' ? String(v) : String(v).replace(/\r?\n/g, ' ');
}

/**
 * Read a workbook back as JSON for the app: at most this many rows and columns of each sheet, header row first.
 * Nothing but words and counts leaves here, so a workbook cannot smuggle a path or a command onto a screen.
 */
export async function readWorkbook(file: string, max = { rows: 40, cols: 14 }) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = wb.worksheets.slice(0, MAX.sheets).map((ws: any) => {
    const rows: string[][] = [];
    let total = 0;
    ws.eachRow({ includeEmpty: false }, (row: any) => {
      const cells: string[] = [];
      for (let c = 1; c <= max.cols; c++) cells.push(text(row.getCell(c).value).slice(0, 120));
      while (cells.length && !cells.at(-1)) cells.pop(); // the table ends where the words do
      if (!cells.some((c) => c)) return; // a blank row under the dropdowns is not a row of a sheet
      total++;
      if (rows.length < max.rows) rows.push(cells);
    });
    return { name: String(ws.name), total, rows };
  });
  return { sheets };
}
