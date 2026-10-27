// The resume: Chief makes it only from the person's own words in his chat, the person edits it in the app, and the PDF
// and Word files they save say exactly what the document says. Real crewd over HTTP on the stub engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { setup, settled, task } from './lab.ts';
import { temp } from './tmp.ts';
import { readDocument } from '../src/documents.ts';
import { startServer } from '../src/server.ts';
import * as A from '../web/src/adapter.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const CV = `Umer Anjum
London · umer@example.com · github.com/umer
Frontend engineer at Acme, 2019 to 2023
Led a team of four building a payments dashboard in React and TypeScript
Cut page load time by 40 percent on the checkout flow
BSc Computer Science, 2016
Private: current salary £70,000`;
const sections = [
  { lines: ['Umer Anjum', 'London · umer@example.com · github.com/umer'] },
  { heading: 'Experience', lines: ['Frontend engineer at Acme, 2019 to 2023', 'Led a team of four building a payments dashboard in React and TypeScript', 'Cut page load time by 40 percent'] },
  { heading: 'Education', lines: ['BSc Computer Science, 2016'] },
];
/** The words on a PDF's pages, read straight out of its text operators (crewd writes them uncompressed). */
const pdfWords = (b64: string) => [...Buffer.from(b64, 'base64').toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
  .map((m) => m[1].replace(/\\([0-7]{3}|.)/g, (_, c) => c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : c)).join(' ');
const norm = (s: string) => s.replace(/\x95/g, '•').replace(/\s+/g, ' ');

test('a resume from his own words only, edited in the app, saved as PDF and Word that match it', async (t) => {
  const { cfg, db, crew, done } = setup();
  Object.assign(cfg, { port: 0, host: '127.0.0.1', linkPort: 0 });
  const server = await startServer(cfg, db, crew);
  t.after(async () => { await new Promise<void>((r) => server.close(() => r())); done(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, key = readFileSync(join(cfg.stateDir, 'person.key'), 'utf8');
  const api = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${key}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
  crew.onboard('Umer');
  await settled(db, (await crew.post('chief', `Here is my CV:\n${CV}`))!.task);
  const ask = async (words: string, input: object) => { const id = (await crew.post('chief', `${words} ${call('crew_resume', input)}`))!.task; await settled(db, id); return id; };
  const delivered = () => db.all("SELECT * FROM events WHERE kind = 'file.delivered' AND bot = 'chief'").length;

  // The no-invention guard: a line he never wrote, or one he marked private, makes no resume. The words of the request
  // itself are not his material: only what comes before the tool call counts.
  const refused = async (input: object, why: RegExp) => {
    const id = await ask('Make my resume', input);
    assert.match((crew.runtime as any).transcript(task(db, id).session), why);
  };
  await refused({ sections: [...sections, { heading: 'Certifications', lines: ['AWS Certified Solutions Architect'] }] }, /“AWS Certified Solutions Architect” is not in what they told you/);
  await refused({ sections: [...sections.slice(0, 2), { heading: 'Summary', lines: ['current salary £70,000'] }] }, /marked private, so it stays out/);
  await refused({ sections: [{ heading: 'Certified AWS architect', lines: ['BSc Computer Science, 2016'] }] }, /“Certified AWS architect” is not in what they told you/);
  assert.equal(delivered(), 0, 'an invented line, a private line and an invented heading make no resume');

  await ask('Make my resume', { sections });
  assert.equal(delivered(), 1, 'his own lines make the resume, delivered once');
  const view = (await api('GET', '/api/document?bot=chief&path=files/resume.docx')).body, doc = A.document(view, 'Resume');
  const cvAt = db.get("SELECT at FROM messages WHERE bot = 'chief' AND author = 'person' AND text LIKE 'Here is my CV%'")!.at;
  assert.deepEqual(doc.resume!.map((r) => r.from), [[cvAt], [cvAt], [cvAt]], 'each part records the message he wrote it in, not the request');
  assert.match(A.resumeFrom(doc.resume![1]), /^From what you told Chief on /);
  assert.deepEqual(doc.parts.map((p) => p.text), ['Umer Anjum', sections[0].lines[1], 'Experience', ...sections[1].lines, 'Education', ...sections[2].lines]);

  // Export round trip: every line of the document is in the PDF's text and in the Word file's.
  const save = async (as: string) => { const r = await api('GET', `/api/document?bot=chief&path=files/resume.docx&as=${as}`); assert.equal(r.status, 200); return r.body; };
  const pdf = await save('pdf'), word = await save('docx'), file = join(temp('resume'), word.name);
  assert.equal(pdf.name, 'resume.pdf');
  assert.equal(pdf.type, 'application/pdf');
  assert.match(Buffer.from(pdf.data, 'base64').subarray(0, 8).toString(), /^%PDF-1\.4/);
  writeFileSync(file, Buffer.from(word.data, 'base64'));
  const words = norm(pdfWords(pdf.data)), back = (await readDocument(file)).parts.map((p) => p.text);
  for (const line of sections.flatMap((s) => s.lines)) {
    assert.ok(words.includes(line), `the PDF says “${line}”`);
    assert.ok(back.includes(line), `the Word file says “${line}”`);
  }
  assert.doesNotMatch(words, /70,000/);

  // Edit, then export: his new words are in both files and the old ones are gone; the part says he edited it.
  const mine = doc.resume!.map((r) => ({ heading: r.heading, lines: r.lines }));
  mine[1].lines[2] = 'Cut checkout page load time by 40 percent, measured in production';
  mine[2].lines.push('Kaggle notebooks: github.com/umer/notebooks');
  const after = A.document((await api('PUT', '/api/resume', { sections: mine })).body, 'Resume');
  assert.deepEqual(after.resume!.map((r) => r.edited), [false, true, true]);
  assert.match(A.resumeFrom(after.resume![1]), /^Edited by you, from what you told Chief on /);
  const pdf2 = norm(pdfWords((await save('pdf')).data)), file2 = join(temp('resume-2'), 'resume.docx');
  writeFileSync(file2, Buffer.from((await save('docx')).data, 'base64'));
  const back2 = (await readDocument(file2)).parts.map((p) => p.text);
  for (const line of ['Cut checkout page load time by 40 percent, measured in production', 'Kaggle notebooks: github.com/umer/notebooks']) {
    assert.ok(pdf2.includes(line) && back2.includes(line), `the edit “${line}” is in both files`);
  }
  assert.ok(!back2.includes('Cut page load time by 40 percent') && !pdf2.includes('Cut page load time by 40 percent'), 'the old line is gone from both');
  assert.equal((await api('PUT', '/api/resume', { sections: [{ heading: 'Experience', lines: [] }] })).status, 400, 'a resume keeps at least one line');
  assert.equal((await api('GET', '/api/document?bot=chief&path=files/nope.docx&as=pdf')).status, 403, 'only a delivered document saves');
});
