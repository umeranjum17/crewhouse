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

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Dark header, blue for a calculated cell, yellow for an input cell. */
const FILL = {
  header: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } },
  formula: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } },
  input: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } },
} as const;

/** YYYY-MM-DD becomes a real UTC-midnight date; null when the calendar says otherwise. */
function dateOf(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null;
}
/** exceljs is CommonJS, and only worth loading for the seconds it is used. */
const excel = () => import('exceljs').then((m: any) => m.default ?? m);

/** Write a workbook the person can open and use: bold frozen headers, sensible widths, dropdowns where they help. */
export async function buildWorkbook(file: string, spec: WorkbookSpec) {
  const ExcelJS = await excel();
  const sheets = Array.isArray(spec?.sheets) ? spec.sheets.slice(0, MAX.sheets) : [];
  if (!sheets.length) throw new Error('say what the workbook should have: at least one sheet with columns');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Crewhouse'; wb.title = spec.name; wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
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
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    // Only a sheet the person works in gets colours: one with dropdowns or formulas. A plain guide sheet stays plain.
    const lively =
      cols.some((c) => (Array.isArray(c?.options) ? c.options : []).some((o) => String(o).trim())) ||
      rows.some((r) => r.some((v) => typeof v === 'string' && v.startsWith('=')));
    if (lively) ws.getRow(1).fill = { ...FILL.header };
    for (const row of rows) {
      const added = ws.addRow(row.map((v) => {
        if (typeof v === 'string' && v.startsWith('=')) return { formula: v.slice(1) };
        if (typeof v === 'string' && DATE.test(v)) return dateOf(v) ?? v;
        return v ?? null;
      }));
      added.eachCell((cell: any) => {
        const v = cell.value;
        const formula = !!v && typeof v === 'object' && 'formula' in v;
        if (v instanceof Date) cell.numFmt = 'yyyy-mm-dd';
        else if (typeof v === 'string' && v.length > 60) cell.alignment = { wrapText: true };
        if (lively) cell.fill = { ...FILL[formula ? 'formula' : 'input'] };
      });
    }
    cols.forEach((c, i) => {
      const options = (Array.isArray(c?.options) ? c.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, MAX.options);
      if (!options.length) return;
      // Fill the dropdowns down past the finished rows, so the person can keep typing in it.
      const until = Math.min(Math.max(rows.length + 10, 12), MAX.dropdown);
      for (let r = 2; r <= until; r++) {
        const cell = ws.getCell(r, i + 1);
        cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${options.join(',')}"`] };
        cell.fill = { ...FILL.input };
      }
    });
  });
  await wb.xlsx.writeFile(file);
  return { sheets: wb.worksheets.map((w: any) => w.name) };
}

/** What a cell says, whatever kind of cell it is: one string for the preview's table. A formula shows its computed
 *  value when the file has one cached, or "auto" — never the formula text; the downloaded file keeps the real thing. */
function text(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => text(t.text)).join('');
    if ('result' in v || 'formula' in v) return v.result == null ? 'auto' : text(v.result);
    if ('text' in v || 'hyperlink' in v) return text(v.text ?? v.hyperlink);
    return '';
  }
  return typeof v === 'number' || typeof v === 'boolean' ? String(v) : String(v).replace(/\r?\n/g, ' ');
}

/** Read a workbook back as JSON for the app: header row first, at most this many rows and columns of each sheet,
 *  plus row numbers (`nums`, gaps where blanks were skipped) and cell roles (`roles`: head/in/calc/empty, from
 *  formulas and validation only). Nothing but words and counts leaves here — no paths or commands on a screen. */
export async function readWorkbook(file: string, max = { rows: 40, cols: 14 }) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = wb.worksheets.slice(0, MAX.sheets).map((ws: any) => {
    const rows: string[][] = [], nums: number[] = [], roles: string[][] = [];
    let total = 0;
    ws.eachRow({ includeEmpty: false }, (row: any, n: number) => {
      const cells: string[] = [], role: string[] = [];
      for (let c = 1; c <= max.cols; c++) {
        const cell = row.getCell(c), v: any = cell.value;
        cells.push(text(v).slice(0, 120));
        role.push(!total ? 'head' : v && typeof v === 'object' && 'formula' in v ? 'calc' : cell.dataValidation ? 'in' : '');
      }
      while (cells.length && !cells.at(-1)) { cells.pop(); role.pop(); } // the table ends where the words do
      if (!cells.some((c) => c)) return; // a blank row under the dropdowns is not a row of a sheet
      total++;
      if (rows.length < max.rows) { rows.push(cells); nums.push(n); roles.push(role); }
    });
    return { name: String(ws.name), total, rows, nums, roles };
  });
  return { sheets };
}
