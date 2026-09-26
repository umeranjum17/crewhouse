// Real documents, made by crewd itself: a helper fills in a plain spec and the docx library (MIT, pinned in
// package.json) writes the .docx into the bot's folder. Reading one back for the app's preview uses jszip and
// xml-js, the docx package's own dependencies — crewd parses the file, the app only ever sees plain parts.
// The model never hand-writes the binary.
// The shape a helper fills in: headings, paragraphs (whole-paragraph bold/italic), bullet lists, a table.
type Cell = string | number | boolean | null | undefined;
export type BlockSpec =
  | { heading: string; level?: number }
  | { text: string; bold?: boolean; italic?: boolean }
  | { bullets: string[] }
  | { table: { head: Cell[]; rows: Cell[][] } };
export type DocumentSpec = { name: string; blocks: BlockSpec[] };

// Bounds on what a model can ask for: a 10,000-block letter is a mistake, not a document.
const MAX = { blocks: 300, bullets: 50, rows: 200, cols: 12, text: 8000, parts: 150, shown: 600 };

/** The writer is CommonJS-shaped and only worth loading for the seconds it is used. */
const docx = () => import('docx').then((m: any) => m.default ?? m);
const words = (v: Cell) => String(v ?? '').replace(/\r?\n/g, ' ').slice(0, MAX.text);

/** Write a document the person can open and edit: real headings, real lists, a table with a bold header row. */
export async function buildDocument(file: string, spec: DocumentSpec) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = await docx();
  const blocks = Array.isArray(spec?.blocks) ? spec.blocks.slice(0, MAX.blocks) : [];
  if (!blocks.length) throw new Error('say what the document should say: at least one heading or paragraph');
  const cell = (v: Cell, bold = false) => new Paragraph({ children: [new TextRun({ text: words(v), bold })] });
  const children = blocks.flatMap((b: any) => {
    if (typeof b?.heading === 'string') {
      const level = Math.min(Math.max(Number(b.level) || 1, 1), 3);
      return [new Paragraph({ text: b.heading.slice(0, 200), heading: HeadingLevel[`HEADING_${level}` as const] })];
    }
    if (Array.isArray(b?.bullets)) {
      return b.bullets.slice(0, MAX.bullets).map((t: any) => new Paragraph({ text: words(t), bullet: { level: 0 } }));
    }
    if (b?.table && Array.isArray(b.table.head)) {
      const dataRows = (Array.isArray(b.table.rows) ? b.table.rows : []).slice(0, MAX.rows);
      const head = b.table.head.slice(0, MAX.cols).map((h: Cell) => new TableCell({ children: [cell(h, true)] }));
      const rows = [
        new TableRow({ tableHeader: true, children: head }),
        ...dataRows.map((r: Cell[]) => new TableRow({ children: r.slice(0, MAX.cols).map((c) => new TableCell({ children: [cell(c)] })) })),
      ];
      return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })];
    }
    if (typeof b?.text === 'string') {
      return [new Paragraph({ children: [new TextRun({ text: words(b.text), bold: b.bold === true, italics: b.italic === true })] })];
    }
    return [];
  });
  const doc = new Document({ creator: 'Crewhouse', sections: [{ children }] });
  await Packer.toBuffer(doc).then((buf: Uint8Array) => import('node:fs').then((fs) => fs.writeFileSync(file, buf)));
  return { parts: blocks.length };
}

const HEADING = /^(title|heading)(\d)/i;

/** One plain part of the preview: a heading, a paragraph, a bullet, or a table. */
export type Part = { kind: 'heading' | 'p' | 'li' | 'table'; text?: string; bold?: boolean; items?: string[]; head?: string[]; rows?: string[][] };

/**
 * Read a document back as JSON for the app: at most this many parts, words only. Nothing but words leaves here,
 * so a document cannot smuggle a path, a command or markup onto a screen.
 */
export async function readDocument(file: string) {
  const JSZip = (await import('jszip')).default;
  const { xml2js } = await import('xml-js');
  const xml = await import('node:fs').then(async (fs) => {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const inner = zip.file('word/document.xml');
    if (!inner) throw new Error('no such document');
    return inner.async('string');
  });
  const walk = (els: any[] | undefined, at: (e: any) => void) => (els ?? []).forEach((e) => e.type === 'element' && at(e));
  const runs = (e: any): { text: string; bold: boolean } => {
    let text = '', bold = false;
    walk(e.elements, (c) => {
      if (c.name === 'w:r') {
        bold ||= (c.elements ?? []).some((p: any) => p.name === 'w:rPr' && (p.elements ?? []).some((b: any) => b.name === 'w:b' && b.attributes?.['w:val'] !== 'false'));
        walk(c.elements, (t) => { if (t.name === 'w:t') text += (t.elements ?? []).map((x: any) => x.text ?? '').join(''); });
      }
    });
    return { text: text.replace(/\s+/g, ' ').trim().slice(0, MAX.shown), bold };
  };
  const cellText = (tc: any) => {
    const out: string[] = [];
    walk(tc.elements, (p) => { if (p.name === 'w:p') { const r = runs(p); if (r.text) out.push(r.text); } });
    return out.join(' ');
  };
  const root = await xml2js(xml, {}) as any;
  const parts: Part[] = [];
  const push = (p: Part) => { if (parts.length < MAX.parts) parts.push(p); };
  const body = root?.elements?.[0]?.elements?.find((e: any) => e.type === 'element' && e.name === 'w:body');
  walk(body?.elements, (el) => {
    if (el.name === 'w:tbl') {
      const rows: string[][] = [];
      walk(el.elements, (tr) => {
        if (tr.name !== 'w:tr' || rows.length >= 40) return;
        const row: string[] = [];
        walk(tr.elements, (tc) => { if (tc.name === 'w:tc') row.push(cellText(tc).slice(0, 160)); });
        if (row.some((c) => c)) rows.push(row);
      });
      if (rows.length) push({ kind: 'table', head: rows[0], rows: rows.slice(1) });
      return;
    }
    if (el.name !== 'w:p') return;
    const style = (el.elements ?? []).find((e: any) => e.name === 'w:pPr')?.elements?.find((e: any) => e.name === 'w:pStyle')?.attributes?.['w:val'] ?? '';
    const list = JSON.stringify((el.elements ?? []).find((e: any) => e.name === 'w:pPr')?.elements ?? []).includes('"w:numPr"');
    const { text, bold } = runs(el);
    if (!text) return;
    if (HEADING.test(style)) push({ kind: 'heading', text });
    else if (list) push({ kind: 'li', text });
    else push({ kind: 'p', text, ...(bold ? { bold: true } : {}) });
  });
  if (!parts.length) throw new Error('no such document');
  return { parts };
}
