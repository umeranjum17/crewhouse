// The Google journey offline, on emulate's stateful Google (vercel-labs/emulate) on loopback: the person connects Gmail,
// Gmail drafts & labels and Calendar through crewd and the kit's real sign-in, a helper reads the inbox, drafts a reply
// and files it (one card each), Chief reads his own calendar, and the emulator's own state is the witness: the draft
// exists, the label is set, the Sent box is empty. Demo data only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startGoogleEmulator, ME, THREAD, CLIENT } from './emulate-google.ts';

const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => r(port)); }); });
// crewd's redirect is fixed when the crew starts, and the emulator's client registers exactly that address.
process.env.CREWHOUSE_PORT = String(await free());
const { server: google, url: EMU } = await startGoogleEmulator(Number(process.env.CREWHOUSE_PORT));
after(() => google.close());
process.env.CREWHOUSE_GOOGLE_EMULATOR = EMU;
const { setup, settled, task, until, grantApps } = await import('./lab.ts');
const { startServer } = await import('../src/server.ts');
const { GMAIL } = await import('../src/calendar.ts');

/** The emulator's own view, read with a token crewd never holds. */
const witness = async (path: string) => (await fetch(`${EMU}/gmail/v1/users/me${path}`, { headers: { authorization: 'Bearer witness' } })).json() as Promise<any>;
const unhtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('Gmail and Calendar on an emulated Google: connect, read, draft and file with one card each, nothing sent', async (t) => {
  assert.equal(GMAIL, `${EMU}/gmail/v1/users/me`, 'the test-only seam points Gmail at the emulator');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  // Registered before setup's own after(done), so the server stops before the database closes.
  after(async () => { server?.closeAllConnections(); await new Promise((r) => server ? server.close(r) : r(null)); done(); });
  const { db, crew, cfg, done } = setup();
  cfg.linkPort = 0;
  server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${cfg.port}`;
  const api = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    assert.equal(res.status, 200, `${method} ${path}`);
    return res.json() as Promise<any>;
  };
  await api('POST', '/api/onboard', { address: 'Umer' });
  await api('POST', '/api/recruit', { template: 'scribe', name: 'Quill' });
  grantApps(cfg, 'quill', ['gmail', 'calendar']);
  await api('PUT', '/api/house/google', CLIENT);

  // Each app the way the person connects it: Connect, the sign-in page, their own account, back to crewd.
  for (const app of ['gmail', 'gmailwrite', 'calendar']) {
    crew.connections.apps[app] = { ...crew.connections.apps[app], oauth: { authorize: `${EMU}/o/oauth2/v2/auth`, token: `${EMU}/oauth2/token` } };
    const { url } = await api('POST', `/api/connections/${app}`);
    assert.ok(url.startsWith(`${EMU}/o/oauth2/v2/auth?`), `${app} signs in on the emulated Google`);
    const page = await (await fetch(url)).text(), form = page.split('<form').find((f) => f.includes(`value="${ME}"`));
    assert.ok(form, 'the sign-in page offers Umer');
    const fields = new URLSearchParams([...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)].map((m) => [m[1], unhtml(m[2])]));
    const chosen = await fetch(`${EMU}/o/oauth2/v2/auth/callback`, { method: 'POST', body: fields, redirect: 'manual' });
    assert.equal(chosen.status, 302);
    assert.match(await (await fetch(chosen.headers.get('location')!)).text(), /is connected\./, `${app} is connected`);
    assert.equal(crew.connections.connected(app), true);
  }

  // The helper reads the inbox: free, no card.
  const read = crew.assign('quill', 'what is new [tool mail {"args":[]}]', 'chief').task;
  await settled(db, read);
  assert.match(task(db, read).result, new RegExp(`${THREAD},Ada <ada@example\\.com>,Friday plan`), 'the seeded thread, through crewd');
  assert.equal(db.all('SELECT * FROM asks').length, 0, 'reading never asks');

  // A reply as a draft, then a label: one card each, and the yes writes.
  const steps = [['draft', THREAD, 'Yes, Friday still works. See you then.'], ['label', THREAD, 'Plans']];
  for (const args of steps) {
    const job = crew.assign('quill', `[tool mail ${JSON.stringify({ args })}]`, 'chief').task;
    await until(`${args[0]} card`, () => db.get("SELECT id FROM asks WHERE task_id = ? AND state = 'open'", job));
    await crew.answer(db.get("SELECT id FROM asks WHERE task_id = ? AND state = 'open'", job)!.id, { answer: 'allow' });
    await settled(db, job);
    assert.match(db.all("SELECT text FROM messages WHERE task_id = ? AND author = 'bot'", job).map((m) => m.text).join('\n'), args[0] === 'draft' ? /drafted: \{id: \S+, thread: 19a0c0ffee000001, from: umer@example\.com, to: ada@example\.com/ : /labelled: \{id: 19a0c0ffee000001, label: Plans\}/);
  }

  // Chief reads his own calendar: one Chief task, no asks, the answer in his thread.
  const jobs = db.all('SELECT * FROM tasks').length, asked = (await crew.post('chief', 'what are my next meetings [tool calendar {"args":["next","2"]}]') as { task: number }).task;
  await settled(db, asked);
  assert.equal(db.all('SELECT * FROM tasks').length, jobs + 1, 'exactly one task');
  assert.equal(task(db, asked).bot, 'chief', 'it stays with Chief: no helper task');
  assert.equal(db.all("SELECT * FROM asks WHERE task_id = ?", asked).length, 0, 'reading never asks');
  assert.match(task(db, asked).result, /next\[2\]\{id,when,title\}:\n {2}standup0001,.+ 09:00-10:00,Standup\n {2}dentist0001,.+ 15:00-16:00,Dentist/);
  assert.ok(crew.botPage('chief').messages.some((m) => m.author === 'bot'), 'Chief replies in his own thread');

  // The emulator's own state: the draft is there, the label is set, and the Sent box is empty.
  const drafts = (await witness('/drafts')).drafts ?? [], draft = await witness(`/drafts/${drafts[0]?.id}?format=full`);
  const labels = (await witness('/labels')).labels, plans = labels.find((l: any) => l.name === 'Plans'), thread = await witness(`/threads/${THREAD}`);
  const sent = await witness('/messages?labelIds=SENT'), to = draft.message?.payload?.headers?.find((h: any) => h.name === 'To')?.value;
  t.diagnostic(`emulator state: ${JSON.stringify({ drafts: drafts.length, draftThread: draft.message?.threadId, draftTo: to, draftSnippet: draft.message?.snippet, label: plans?.name, threadLabels: thread.messages[0].labelIds, sent: sent.messages?.length ?? 0 })}`);
  assert.equal(drafts.length, 1, 'one draft');
  assert.equal(draft.message.threadId, THREAD, 'the draft replies in the thread');
  assert.equal(to, 'ada@example.com', 'to the person who wrote');
  assert.match(draft.message.snippet, /Yes, Friday still works\. See you then\./, 'in the helper\u2019s words');
  assert.ok(plans && thread.messages[0].labelIds.includes(plans.id), 'the thread carries the label');
  assert.equal(sent.messages?.length ?? 0, 0, 'nothing was sent');
  assert.equal(db.all("SELECT * FROM events WHERE kind IN ('mail.approved', 'mail.sent')").length, 0, 'crewd never tried to send');
});
