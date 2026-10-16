// Real spreadsheets, made by crewd itself: a helper fills in a plain spec and exceljs (MIT, pinned in package.json)
// writes the .xlsx into the bot's folder; the same library reads one back as JSON for the app's read-only preview.
// The model never hand-writes the binary, and the app never parses it.
import { readFileSync, writeFileSync } from 'node:fs';
// The shape a helper fills in: one sheet per tab, one column per A/B/C…, rows are the finished rows (an example row included).
type Cell = string | number | boolean | null | undefined;
export type ColumnSpec = { header: string; width?: number; options?: string[] };
export type SheetSpec = { name: string; columns: ColumnSpec[]; rows?: Cell[][] };
/** A chart drawn from the sheet's own cells: `categories` and each series' `values` are one column or row, like B2:B13. */
export type ChartSpec = { type: 'bar' | 'line' | 'pie'; title?: string; sheet?: string; categories: string; series: { name?: string; values: string }[]; at?: string };
export type WorkbookSpec = { name: string; sheets: SheetSpec[]; charts?: ChartSpec[] };

// Bounds on what a model can ask for: a sheet with 10,000 columns is a mistake, not a spreadsheet.
const MAX = { sheets: 12, columns: 24, rows: 500, options: 40, dropdown: 200, width: 60, charts: 8, series: 6 };
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
  header: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }, formula: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }, input: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } },
} as const;

/** YYYY-MM-DD becomes a real UTC-midnight date; null when the calendar says otherwise. */
function dateOf(s: string) {
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null;
}
/** exceljs is CommonJS, and only worth loading for the seconds it is used. */
const excel = () => import('exceljs').then((m: any) => m.default ?? m);

/** Write a workbook the person can open and use: bold frozen headers, sensible widths, dropdowns where they help. */
export async function buildWorkbook(file: string, spec: WorkbookSpec) {
  const ExcelJS = await excel(), sheets = Array.isArray(spec?.sheets) ? spec.sheets.slice(0, MAX.sheets) : [];
  if (!sheets.length) throw new Error('say what the workbook should have: at least one sheet with columns');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Crewhouse'; wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const taken = new Set<string>(), named = new Map<string, any>();
  sheets.forEach((s, n) => {
    const cols = (Array.isArray(s.columns) ? s.columns : []).slice(0, MAX.columns);
    if (!cols.length) throw new Error(`“${s.name ?? 'that sheet'}” has no columns: give each one a header`);
    const ws = wb.addWorksheet(sheetName(String(s.name ?? ''), taken, n));
    for (const k of [String(s.name ?? ''), ws.name]) if (!named.has(k.trim().toLowerCase())) named.set(k.trim().toLowerCase(), ws);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const rows = (Array.isArray(s.rows) ? s.rows : []).slice(0, MAX.rows).map((r) => (Array.isArray(r) ? r : [r]).slice(0, MAX.columns));
    ws.columns = cols.map((c, i) => {
      const header = String(c?.header ?? '').trim().slice(0, 80) || `Column ${i + 1}`, widest = Math.max(header.length, ...rows.map((r) => String(r[i] ?? '').length), 0);
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
        const v = cell.value, formula = !!v && typeof v === 'object' && 'formula' in v;
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
  const memo = new Map<string, unknown>(), placed = new Map<any, number>(), charts = (Array.isArray(spec.charts) ? spec.charts : []).slice(0, MAX.charts).map((c) => {
    if (!['bar', 'line', 'pie'].includes(c?.type)) throw new Error('a chart is a bar, line or pie chart');
    const ws = c.sheet ? named.get(String(c.sheet).trim().toLowerCase()) : wb.worksheets[0];
    if (!ws) throw new Error(`there is no sheet called “${c.sheet}” to put the chart on`);
    const read = (range: unknown) => ({ ref: `'${ws.name.replace(/'/g, "''")}'!${absolute(range)}`, vals: cellsOf(range).map(([r, k]) => shown(wb, ws, ws.getCell(r, k), memo)) }), series = (Array.isArray(c.series) ? c.series : []).slice(0, c.type === 'pie' ? 1 : MAX.series).map((x, i) => {
      const [[r, k]] = cellsOf(x?.values);
      return { name: String(x?.name ?? '').trim().slice(0, 60) || (r > 1 && shown(wb, ws, ws.getCell(r - 1, k), memo)) || `Series ${i + 1}`, ...read(x?.values) };
    });
    if (!series.length) throw new Error('a chart needs at least one series: its values, like B2:B13');
    placed.set(ws, (placed.get(ws) ?? 0) + 1);
    const at = c.at ? cellsOf(c.at)[0] : [17 * placed.get(ws)! - 15, ws.columnCount + 2];
    return { ws, at, xml: chartXml(c.type, String(c.title ?? '').trim().slice(0, 120), read(c.categories), series) };
  }), buf = await wb.xlsx.writeBuffer();
  writeFileSync(file, charts.length ? await withCharts(buf, charts) : Buffer.from(buf));
  return { sheets: wb.worksheets.map((w: any) => w.name) };
}

const RANGE = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i, colOf = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), absolute = (range: unknown) => String(range).trim().toUpperCase().replace(/\$/g, '').replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
/** A range's cells as [row, column], in order: one column or one row of at most MAX.rows cells. */
function cellsOf(range: unknown): [number, number][] {
  const m = RANGE.exec(String(range ?? '').trim()), [r0, c0, r1, c1] = m ? [+m[2], colOf(m[1]), +(m[4] ?? m[2]), colOf(m[3] ?? m[1])] : [0, 0, -1, -1];
  if (!m || (r0 !== r1 && c0 !== c1) || r1 < r0 || c1 < c0 || r1 - r0 + c1 - c0 >= MAX.rows) throw new Error(`“${range}” is not one column or row of cells, like B2:B13`);
  return Array.from({ length: r1 - r0 + c1 - c0 + 1 }, (_, i) => (r0 === r1 ? [r0, c0 + i] : [r0 + i, c0]));
}

// The chart parts exceljs cannot write: standard DrawingML (ECMA-376 part 1, §21.2), added to the file it wrote.
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&${({ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot' } as any)[c]};`), unesc = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as any)[e]), rels = (xs: string[]) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${xs.join('')}</Relationships>`;
type Cells = { ref: string; vals: string[] };
/** The chart part: each series points at its cells (so the person's edits move it) and carries their values now. */
function chartXml(type: string, title: string, cats: Cells, series: (Cells & { name: string })[]) {
  const cache = (tag: string, vs: string[]) => `<c:${tag}Cache>${tag === 'num' ? '<c:formatCode>General</c:formatCode>' : ''}<c:ptCount val="${vs.length}"/>${vs.map((v, i) =>
    `<c:pt idx="${i}"><c:v>${esc(tag === 'num' ? String(Number(v) || 0) : v)}</c:v></c:pt>`).join('')}</c:${tag}Cache>`, ser = series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>${type === 'line' ? '<c:marker><c:symbol val="circle"/></c:marker>' : ''}`
    + `<c:cat><c:strRef><c:f>${esc(cats.ref)}</c:f>${cache('str', cats.vals)}</c:strRef></c:cat><c:val><c:numRef><c:f>${esc(s.ref)}</c:f>${cache('num', s.vals)}</c:numRef></c:val>${type === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`).join(''), axes = '<c:axId val="1"/><c:axId val="2"/>', ax = (tag: string, id: number, pos: string, more = '') =>
    `<c:${tag}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${more}<c:crossAx val="${3 - id}"/></c:${tag}>`, plot = { bar: `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}${axes}</c:barChart>`,
    line: `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/>${axes}</c:lineChart>`,
    pie: `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>` }[type];
  return `${XML}<c:chartSpace ${NS}><c:chart>${title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` : ''}`
    + `<c:autoTitleDeleted val="${title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}${type === 'pie' ? '' : ax('catAx', 1, 'b') + ax('valAx', 2, 'l', '<c:majorGridlines/>')}</c:plotArea>`
    + `${type === 'pie' || series.length > 1 ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : ''}<c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}
/** Add each chart to the sheet it reads, 8 columns by 16 rows from its top-left cell: one drawing per sheet. */
async function withCharts(buf: ArrayBuffer, charts: { ws: any; at: number[]; xml: string }[]) {
  const zip = await (await import('jszip')).default.loadAsync(buf), types: string[] = [];
  let n = 0;
  for (const ws of new Set(charts.map((c) => c.ws))) {
    const mine = charts.filter((c) => c.ws === ws), sheet = `xl/worksheets/sheet${ws.id}.xml`, anchors = mine.map(({ at: [row, col], xml }, i) => {
      zip.file(`xl/charts/chart${++n}.xml`, xml);
      types.push(`<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      const cell = (r: number, k: number) => `<xdr:col>${k - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
      return `<xdr:twoCellAnchor><xdr:from>${cell(row, col)}</xdr:from><xdr:to>${cell(row + 16, col + 8)}</xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/>`
        + `<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">`
        + `<c:chart xmlns:r="${OD}" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
    });
    zip.file(`xl/drawings/drawing${ws.id}.xml`, `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ${NS}>${anchors.join('')}</xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${ws.id}.xml.rels`, rels(mine.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${OD}/chart" Target="../charts/chart${n - mine.length + i + 1}.xml"/>`)));
    // ponytail: assumes exceljs wrote no rels for this sheet (it does only for hyperlinks, comments and tables, none of which a spec makes).
    zip.file(`xl/worksheets/_rels/sheet${ws.id}.xml.rels`, rels([`<Relationship Id="rId1" Type="${OD}/drawing" Target="../drawings/drawing${ws.id}.xml"/>`]));
    zip.file(sheet, (await zip.file(sheet)!.async('string')).replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>'));
    types.push(`<Override PartName="/xl/drawings/drawing${ws.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  }
  const ct = await zip.file('[Content_Types].xml')!.async('string');
  zip.file('[Content_Types].xml', ct.replace('</Types>', `${types.join('')}</Types>`));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** What a cell says, whatever kind of cell it is: one string for the preview's table. A formula shows its value —
 *  the file's cached one, else worked out by `calc` — never the formula text; the downloaded file keeps the real thing. */
function text(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => text(t.text)).join('');
    if ('result' in v || 'formula' in v) return text(v.result);
    if ('text' in v || 'hyperlink' in v) return text(v.text ?? v.hyperlink);
    return '';
  }
  return typeof v === 'boolean' ? String(v) : String(v).replace(/\r?\n/g, ' ');
}

/** The few sheet functions a helper's workbook uses, so a fresh file (no cached values) still reads as numbers. */
const nums = (a: unknown[]) => a.flat(9).filter((v): v is number => typeof v === 'number'), meets = (v: unknown, crit: unknown) => {
  const [, op = '=', rhs] = /^(<>|>=|<=|>|<|=)?(.*)$/s.exec(String(crit))!, n = Number(rhs), d = typeof v === 'number' && rhs.trim() && !Number.isNaN(n) ? v - n : String(v ?? '').toLowerCase() === rhs.toLowerCase() ? 0 : NaN;
  return { '<>': d !== 0, '=': d === 0, '>': d > 0, '<': d < 0, '>=': d >= 0, '<=': d <= 0 }[op];
}, FN: Record<string, (...a: any[]) => unknown> = {
  SUM: (...a) => nums(a).reduce((s, n) => s + n, 0), COUNT: (...a) => nums(a).length, AVERAGE: (...a) => (FN.SUM(...a) as number) / nums(a).length,
  MIN: (...a) => Math.min(...nums(a), Infinity) % Infinity || 0, MAX: (...a) => Math.max(...nums(a), -Infinity) % Infinity || 0,
  COUNTA: (...a) => a.flat(9).filter((v) => v !== '').length, COUNTIF: (r, c) => [r].flat(9).filter((v) => meets(v, c)).length,
  SUMIF: (r, c, s = r) => [r].flat(9).reduce((t: number, v, i) => t + (meets(v, c) ? nums([[s].flat(9)[i]])[0] ?? 0 : 0), 0),
  ROUND: (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d, ABS: Math.abs, IF: (c, a = true, b = false) => (c ? a : b),
}, TOKEN = /\s+|([A-Z][A-Z0-9.]*)\(|(?:(?:'((?:[^']|'')+)'|(\w+))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?|(\d+(?:\.\d+)?)(%?)|"((?:[^"]|"")*)"|(TRUE|FALSE)\b|(<>|<=|>=|[-+*/^&=<>(),])/y;
/** A formula's value from the cells it reads, or '' when it uses something this does not know: only whitelisted
 *  tokens become code, so a formula is never run as anything but arithmetic over the workbook's own cells. */
function calc(wb: any, ws: any, cell: any, memo: Map<string, unknown>): unknown {
  const key = `${ws.name}!${cell.address}`;
  if (memo.has(key) || !cell.formula) return memo.get(key) ?? '';
  memo.set(key, ''); // a formula that reads itself reads an empty cell
  const value = (w: any, c: any) => { const v = c.value; return v?.formula ? v.result ?? calc(wb, w, c, memo) : v instanceof Date ? v.getTime() / 864e5 + 25569 : typeof v === 'object' ? text(v) : v ?? ''; }, ref = (sheet: string | null, a: string, b?: string) => {
    const w = sheet === null ? ws : wb.getWorksheet(sheet), p = w.getCell(a.replace(/\$/g, '')), q = b && w.getCell(b.replace(/\$/g, ''));
    if (!q) { const v = value(w, p); return v === '' ? 0 : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : v; }
    return Array.from({ length: q.row - p.row + 1 }, (_, r) => Array.from({ length: q.col - p.col + 1 }, (_, c) => value(w, w.getCell(p.row + r, p.col + c))));
  };
  let js = '', m: RegExpExecArray | null;
  for (TOKEN.lastIndex = 0; TOKEN.lastIndex < cell.formula.length;) {
    if (!(m = TOKEN.exec(cell.formula)) || (m[1] && !FN[m[1]])) return '';
    const [, fn, quoted, bare, a, b, n, pct, str, bool, op] = m;
    js += fn ? `F.${fn}(` : a ? `R(${JSON.stringify(quoted?.replace(/''/g, "'") ?? bare ?? null)},"${a}"${b ? `,"${b}"` : ''})` : n ? String(Number(n) / (pct ? 100 : 1))
      : str !== undefined ? JSON.stringify(str.replace(/""/g, '"')) : bool ? bool.toLowerCase() : op ? ({ '^': '**', '=': '==', '<>': '!=', '&': '+""+' }[op] ?? op) : ' ';
  }
  try { memo.set(key, new Function('F', 'R', `return (${js});`)(FN, ref)); } catch { /* reads blank */ }
  return memo.get(key);
}
/** A cell as the preview reads it: its words, or a formula's value. */
const shown = (wb: any, ws: any, cell: any, memo: Map<string, unknown>) => { const v = cell.value;
  return text(v && typeof v === 'object' && 'formula' in v && v.result == null ? calc(wb, ws, cell, memo) : v).slice(0, 120); };

/** Read a workbook back as JSON for the app: header row first, at most this many rows and columns of each sheet,
 *  plus row numbers (`nums`, gaps where blanks were skipped) and cell roles (`roles`: head/in/calc/empty, from
 *  formulas and validation only). Nothing but words and counts leaves here — no paths or commands on a screen. */
export async function readWorkbook(file: string, max = { rows: MAX.rows, cols: MAX.columns }) {
  const ExcelJS = await excel(), wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const memo = new Map<string, unknown>(), sheets = wb.worksheets.slice(0, MAX.sheets).map((ws: any) => {
    const rows: string[][] = [], nums: number[] = [], roles: string[][] = [];
    let total = 0;
    ws.eachRow({ includeEmpty: false }, (row: any, n: number) => {
      const cells: string[] = [], role: string[] = [];
      for (let c = 1; c <= max.cols; c++) {
        const cell = row.getCell(c), v: any = cell.value;
        cells.push(shown(wb, ws, cell, memo));
        role.push(!total ? 'head' : v && typeof v === 'object' && 'formula' in v ? 'calc' : cell.dataValidation ? 'in' : '');
      }
      while (cells.length && !cells.at(-1)) { cells.pop(); role.pop(); } // the table ends where the words do
      if (!cells.some((c) => c)) return; // a blank row under the dropdowns is not a row of a sheet
      total++;
      if (rows.length < max.rows) { rows.push(cells); nums.push(n); roles.push(role); }
    });
    return { name: String(ws.name), total, rows, nums, roles, charts: [] as unknown[] };
  });
  // Charts, read from their own parts (exceljs drops them): a bar, line or pie chart's title, labels and numbers from
  // the cells its series point at, under the sheet those cells are on. ponytail: regexes over DrawingML, not an XML parser.
  const zip = await (await import('jszip')).default.loadAsync(readFileSync(file));
  for (const f of Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.slice(14)) - parseInt(b.slice(14)))) {
    const xml = await zip.file(f)!.async('string'), type = /<c:(bar|line|pie)Chart>/.exec(xml)?.[1], at = (part: string) => {
      const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(unesc(/<c:f>([^<]*)<\/c:f>/.exec(part)?.[1] ?? '')), ws = m && wb.getWorksheet(m[1]?.replace(/''/g, "'") ?? m[2]);
      try { return ws ? { ws, vals: cellsOf(m[3]).map(([r, k]) => shown(wb, ws, ws.getCell(r, k), memo)) } : null; } catch { return null; }
    }, series = [...xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map(([, s]) => ({ s, val: at(/<c:val>([\s\S]*?)<\/c:val>/.exec(s)?.[1] ?? '') })).filter((x) => x.val), sheet = series[0] && sheets.find((s: any) => s.name === series[0].val!.ws.name);
    if (!type || !sheet) continue; // a chart kind the preview does not draw, or one reading no cells
    sheet.charts.push({ type, title: [...(/<c:title>([\s\S]*?)<\/c:title>/.exec(xml)?.[1] ?? '').matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unesc(m[1])).join(''),
      labels: at(/<c:cat>([\s\S]*?)<\/c:cat>/.exec(series[0].s)?.[1] ?? '')?.vals ?? [],
      series: series.slice(0, type === 'pie' ? 1 : MAX.series).map(({ s, val }) => ({ name: unesc(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/.exec(s)?.[1] ?? ''), values: val!.vals.map((v) => Number(v) || 0) })) });
  }
  return { sheets };
}
