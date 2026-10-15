// Real slide decks, made by crewd itself: a helper fills in a plain spec and crewd writes the .pptx parts itself
// (standard OOXML DrawingML through the already-pinned jszip — the same route the workbook charts take) into the
// bot's folder. The model never hand-writes the binary, and the app never parses it: readDeck reads it back as
// slides for the preview. The shape a helper fills in: one slide per point, each with a title and its lines.
export type SlideSpec = { title: string; bullets?: string[] };
export type DeckSpec = { name: string; slides: SlideSpec[] };

const MAX = { slides: 40, lines: 8, title: 120, line: 200, body: 420 };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!)), XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"', P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"', T = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The empty shape tree every master, layout and slide starts with: PowerPoint expects one, and it draws nothing. */
const TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
/** The Office theme's own colours and fonts, kept to what a deck needs: a file with no theme is one PowerPoint refuses. */
const THEME = XML + `<a:theme ${A} name="Office"><a:themeElements>`
  + '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
  + '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>'
  + '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>'
  + '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>'
  + '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
  + '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
  + '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  + '<a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill>'
  + '<a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill></a:fillStyleLst>'
  + '<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'
  + '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'
  + '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst>'
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  + '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>'
  + '<a:solidFill><a:schemeClr val="phClr"><a:shade val="51000"/><a:satMod val="150000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst>'
  + '</a:fmtScheme></a:themeElements></a:theme>';

/** One text box at a fixed spot on the 13.3in × 7.5in slide: a title, or the lines under it. */
const box = (id: number, name: string, y: number, cy: number, body: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>`
  + `<a:xfrm><a:off x="685800" y="${y}"/><a:ext cx="10972800" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
  + `<p:txBody><a:bodyPr wrap="square" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;
/** One paragraph: the title's, or a bullet. Sizes are in hundredths of a point. */
const para = (text: string, size: number, bullet: boolean) =>
  `<a:p>${bullet ? '<a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>' : ''}`
  + `<a:r><a:rPr lang="en-US" sz="${size}"${bullet ? '' : ' b="1"'}/><a:t>${esc(text)}</a:t></a:r></a:p>`;

/** One slide: a title along the top, its lines under it — plain text boxes, so nothing depends on a layout. */
function slideXml(s: SlideSpec) {
  const title = String(s?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX.title) || 'Untitled slide', lines = (Array.isArray(s?.bullets) ? s.bullets : []).map((b) => String(b ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX.line)).filter(Boolean).slice(0, MAX.lines);
  // Fewer words mean bigger words: a body that would run off the slide comes down a size.
  const len = lines.reduce((n, b) => n + b.length, 0), size = len > MAX.body ? 1400 : len > 260 ? 1600 : 1800;
  return XML + `<p:sld ${A} ${R} ${P}><p:cSld>${TREE}`
    + box(2, 'Title', 457200, 1371600, para(title, 3200, false))
    + (lines.length ? box(3, 'Body', 2057400, 4114800, lines.map((l) => para(l, size, true)).join('')) : '')
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

/** Write a deck the person can open and present: one real slide per point, a title and its lines. */
export async function buildDeck(file: string, spec: DeckSpec) {
  const slides = (Array.isArray(spec?.slides) ? spec.slides : []).slice(0, MAX.slides);
  if (!slides.length) throw new Error('say what the deck should cover: at least one slide with a title');
  const JSZip = (await import('jszip')).default, n = slides.length, rel = (id: string, kind: string, target: string) => `<Relationship Id="${id}" Type="${T}/${kind}" Target="${target}"/>`, zip = new JSZip();
  zip.file('[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>'
    + '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>'
    + '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
    + '</Types>');
  zip.file('_rels/.rels', XML + `<Relationships ${RELS}>${rel('rId1', 'officeDocument', 'ppt/presentation.xml')}</Relationships>`);
  zip.file('ppt/presentation.xml', XML + `<p:presentation ${A} ${R} ${P} saveSubsetFonts="1">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>`
    + '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', XML + `<Relationships ${RELS}>`
    + rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml') + slides.map((_, i) => rel(`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`)).join('')
    + rel(`rId${n + 2}`, 'theme', 'theme/theme1.xml') + rel(`rId${n + 3}`, 'presProps', 'presProps.xml')
    + rel(`rId${n + 4}`, 'viewProps', 'viewProps.xml') + rel(`rId${n + 5}`, 'tableStyles', 'tableStyles.xml') + '</Relationships>');
  zip.file('ppt/presProps.xml', XML + `<p:presentationPr ${A} ${R} ${P}/>`);
  zip.file('ppt/viewProps.xml', XML + `<p:viewPr ${A} ${R} ${P} lastView="sldView"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>`
    + '<p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr>'
    + '<p:guideLst/></p:cSldViewPr></p:slideViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>');
  zip.file('ppt/tableStyles.xml', XML + `<a:tblStyleLst ${A} def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  zip.file('ppt/theme/theme1.xml', THEME);
  zip.file('ppt/slideMasters/slideMaster1.xml', XML + `<p:sldMaster ${A} ${R} ${P}><p:cSld>${TREE}</p:spTree></p:cSld>`
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
    + '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200" b="1"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>'
    + '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>');
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', XML + `<Relationships ${RELS}>${rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')}${rel('rId2', 'theme', '../theme/theme1.xml')}</Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml', XML + `<p:sldLayout ${A} ${R} ${P} type="blank" preserve="1"><p:cSld name="Blank">${TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', XML + `<Relationships ${RELS}>${rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')}</Relationships>`);
  slides.forEach((s, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(s));
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, XML + `<Relationships ${RELS}>${rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')}</Relationships>`);
  });
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then((b) => import('node:fs').then((fs) => fs.writeFileSync(file, b)));
  return { slides: slides.map((s) => String(s?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX.title) || 'Untitled slide') };
}

/** Every element called `name` under `e`, in order: enough to walk the OOXML tree without a schema. */
const all = (e: any, name: string): any[] => {
  const out: any[] = [];
  for (const c of e?.elements ?? []) if (c.type === 'element') { if (c.name === name) out.push(c); out.push(...all(c, name)); }
  return out;
};
/** The runs of one paragraph, joined: what the slide says. */
const says = (e: any) => all(e, 'a:t').map((t: any) => (t.elements ?? []).map((x: any) => x.text ?? '').join('')).join('');

/** Read a deck back for the app: one entry per slide, its title and its lines, words only — plus those same words
 *  flattened into parts, so a phone's document reader shows a deck too. Nothing but words leaves here. */
export async function readDeck(file: string) {
  const JSZip = (await import('jszip')).default, { xml2js } = await import('xml-js'), zip = await JSZip.loadAsync((await import('node:fs')).readFileSync(file)), num = (f: string) => Number(f.replace(/\D+/g, ''));
  const names = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => num(a) - num(b));
  if (!names.length) throw new Error('no such deck');
  const read = await Promise.all(names.slice(0, MAX.slides).map(async (n) => {
    const root = await xml2js(await zip.file(n)!.async('string'), {}) as any, groups = all(all(root, 'p:cSld')[0], 'p:sp').map((sp) => all(sp, 'a:p').map((p) => says(p).replace(/\s+/g, ' ').trim()).filter(Boolean)).filter((g) => g.length), title = (groups[0]?.[0] ?? '').slice(0, MAX.title);
    const lines = (groups.length > 1 ? groups.slice(1).flat() : (groups[0] ?? []).slice(1)).map((t: string) => t.slice(0, MAX.line)).slice(0, 2 * MAX.lines);
    return { title, lines };
  })), slides = read.filter((s) => s.title || s.lines.length);
  if (!slides.length) throw new Error('no such deck');
  return { slides, parts: slides.flatMap((s) => [{ kind: 'heading', text: s.title }, ...s.lines.map((text) => ({ kind: 'li', text }))]) };
}
