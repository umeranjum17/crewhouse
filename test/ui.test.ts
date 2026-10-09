// The "no technical text" gate: whatever crewd sends, nothing a person reads may show a command, a file path,
// an engine or model name, a usage percentage, a raw prompt or terminal text (persona brief rule 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { build, type Plugin } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { join } from 'node:path';
import type { Json } from '../web/src/api.ts';
import type { Kind } from '../web/src/art.ts';
import { PROVIDERS } from '../src/accounts.ts';
import { PROVIDERS as ROUTES } from '@byokit/accounts';
import * as A from '../web/src/adapter.ts';
import { readTyped } from '../web/src/typed.ts';
import { askOf } from '../mobile/src/ask.ts';
import { draftOf, keepDraft, sent } from '../web/src/draft.ts';
import { chatTokens, safeLink } from '../web/src/chat-md.ts';
import { api, setLink, setTransport } from '../web/src/api.ts';
import { color } from '../web/src/tokens.ts';
import { cycle } from '../web/src/dialog.ts';

const now = Date.now();

/** The phone app's screens: App.tsx, the office room beside it, and the bubble's panel. */
const PHONE_SCREENS = ['App.tsx', 'src/office.tsx', 'src/panel.tsx'].map((f) => join(import.meta.dirname, '..', 'mobile', f));

test('crew room lines and handoff checks hide machinery', () => {
  const s: Json = { bots: [{ id: 'scout', display: 'Scout', template: 'scout', task: null }], events: [], asks: [] };
  // A chat answer reads as written: inline code and bullets stay, so the person sees what the helper said.
  const said = A.room({ lines: [{ id: 1, bot: 'scout', author: 'bot', text: '- `--branch`: View a specific repository branch.\n- `--web`: Open the repository in a web browser.', files: [{ bot: 'scout', path: 'files/story.md' }], at: now }] }, s);
  assert.ok(said[0].text.includes('--branch') && said[0].text.includes('--web'));
  assert.equal(said[0].files.length, 1);
  // Engine events still never read as sentences, whoever typed them.
  const stripped = A.room({ lines: [{ id: 2, bot: 'scout', author: 'bot', text: 'On it [tool crew_do {"x":1}]', files: [], at: now }] }, s);
  assert.doesNotMatch(stripped[0].text, /\[tool|\{"x"/);
  assert.equal(stripped[0].files.length, 0);
  const c = A.card({ id: 2, bot: 'scout', kind: 'propose', at: now, detail: { pass: { files: ['story.md'] }, words: 'Scout wants to hand this to Scribe' } }, s);
  assert.deepEqual(c.choices?.map((x) => x.label), ['Hand it on', 'Not now']);
});
test('the Skills screen reads plain words: starter set and catalog rows', () => {
  const set = A.starterSkills({ live: true, starter: [
    { slug: 'weather', summary: 'Current weather and forecasts.', why: 'The daily jacket question.', needs: ['the curl tool'], on: true },
    { slug: 'homeassistant-skill', summary: 'Ask about the home.', why: '', needs: [], on: false }] });
  assert.deepEqual(set.map((s) => [s.name, s.on, s.reviewed]), [['Weather', true, true], ['Homeassistant Skill', false, true]]);
  const rows = A.skillSearch([{ slug: 'obsidian', owner: 'steipete', summary: 'Find notes.' }], set);
  assert.equal(rows[0].reviewed, false, 'outside the reviewed set says so');
  assert.doesNotMatch(set.concat(rows).map((s) => [s.name, s.what, s.why, ...s.needs].join(' ')).join(' '),
    /token|host\b|engine|grant|command|`|\/home\/|\.md\b/i);
});
const bot = (id: string, extra = {}) => ({ id, display: id[0].toUpperCase() + id.slice(1), role: 'Makes demo videos from screenshots', template: id, runtime: 'claude', model: 'sonnet',
  thinks: [{ key: 'claude:sonnet', name: 'Claude Sonnet' }], state: 'on', computer: true, controls: 'bot', task: null, queued: 0, pausedUntil: null, ...extra });
// The owner's screenshot, as crewd sends it today: a raw fc-list approval, "Claude · 9% of 5h used", the prompt as the task.
const state = {
  person: { id: 1, name: 'Umer', address: 'Umer', onboarded: 1 },
  bots: [
    bot('chief'),
    bot('reel', { task: { id: 5, title: 'Make a birthday video for mum', state: 'needs_you' }, stuck: true, quietSince: now - 6 * 60_000,
      step: { kind: 'run.tool', at: now, data: { tool: 'Bash', summary: 'fc-list 2>&1 | head -20' } } }),
    bot('scout', { task: { id: 6, title: 'Flights', state: 'working' }, step: { kind: 'run.tool', at: now, data: { tool: 'Read', summary: '/home/alex/Crewhouse/bots/scout/notes.md' } } }),
    bot('tracer', { template: 'tracer' }),
  ],
  templates: [{ id: 'chief' }, { id: 'reel', display: 'Reel', role: 'Makes videos' }, { id: 'tracer', display: 'Tracer', role: 'Finds emails' }],
  tasks: [
    { id: 4, bot: 'reel', title: 'Eid collage', state: 'done', updated_at: now, files: ['files/eid-collage.png'], result: 'Saved to /home/alex/Crewhouse/bots/reel/files/eid-collage.png with `magick montage -tile 4x3`' },
    { id: 3, bot: 'scout', title: 'Flights', state: 'failed', updated_at: now, files: [], result: 'Stopped on an error from claude: 529 overloaded' },
  ],
  ideas: [],
  asks: [
    { id: 1, bot: 'reel', task_id: 5, kind: 'permission', at: now, title: 'Reel would like to run a command', detail: { tool: 'Bash', summary: 'fc-list 2>&1 | head -20', rule: 'Bash(fc-list *)', covers: 'fc-list commands' } },
    { id: 2, bot: 'reel', task_id: 5, kind: 'permission', at: now, title: 'Reel would like to use mcp__people__search', detail: { tool: 'mcp__people__search', summary: 'curl -X POST https://api.example.com', spends: true } },
    { id: 3, bot: 'scout', task_id: 6, kind: 'blocked', at: now, title: 'Scout is waiting on a question in its terminal', detail: { pane: '❯ 1. Yes\n  2. No, and tell Claude what to do (esc)' } },
    { id: 4, bot: 'reel', task_id: null, kind: 'propose', at: now, title: 'Reel would like to remember how to do this: make a birthday video', detail: { words: 'Reel would like to remember how to do this: make a birthday video', preview: { head: 'How Reel would do it', body: '1. Pick the happiest photos from ~/Pictures/eid\n2. Run `ffmpeg -i x.mp4`' } } },
  ],
  events: [
    { seq: 1, at: now, kind: 'run.tool', bot: 'reel', data: { task: 5, tool: 'Bash', summary: 'ffmpeg -i in.mp4 out.mp4' } },
    { seq: 2, at: now, kind: 'run.tool', bot: 'reel', data: { task: 5, tool: 'mcp__browser__browser_click', summary: 'ref=e12' } },
    { seq: 3, at: now, kind: 'ask.opened', bot: 'reel', data: { task: 5, kind: 'permission', tool: 'Bash', summary: 'fc-list 2>&1 | head -20' } },
    { seq: 4, at: now, kind: 'run.allowed', bot: 'reel', data: { task: 5, summary: 'fc-list 2>&1 | head -20', rule: 'Bash(fc-list *)' } },
    { seq: 5, at: now, kind: 'file.delivered', bot: 'reel', data: { task: 5, path: 'files/mum-birthday_v2.mp4' } },
    { seq: 6, at: now, kind: 'account.limit', bot: null, data: { fiveHour: { used: 9 } } },
    { seq: 7, at: now, kind: 'task.failed', bot: 'scout', data: { task: 3, title: 'Flights', result: 'Stopped on an error from claude' } },
  ],
  limits: { claude: { fiveHour: { used: 9, resetsAt: now + 3600_000 } } },
  resting: { codex: now + 3600_000, ollama: 0 },
  routines: [{ id: 1, bot: 'reel', kind: 'task', name: 'Weekly demo', words: 'Every Monday at 9:00', state: 'on', next_at: now, brain: 'claude:haiku', history: [] }],
};
const page = { messages: [
  { id: 1, author: 'person', text: 'can you make a birthday video for mum' },
  { id: 2, author: 'bot', text: 'Done! I ran `ffmpeg -i /home/alex/Crewhouse/bots/reel/files/in.mp4 out.mp4` with Claude Code.\n```sh\nls -la\n```' },
  { id: 3, author: 'system', text: 'Delivered files/mum-birthday_v2.mp4: first cut' },
], notes: '# Notes\n- Umer likes soft piano\n- Keep videos in ~/Crewhouse/bots/reel/files', trail: state.events,
  soul: '# Reel\n\nYou are Reel.\n\n## Voice\n- Upbeat. Say what you made, never `ffmpeg -i in.mp4`.',
  skills: [{ name: 'make-reel', description: 'Turn screenshots into a demo video (mp4) with ffmpeg.', says: 'Turn photos into a short video' }, { name: 'plan-dinners', description: 'Uses the browser MCP tools' }] };

const FORBIDDEN = /fc-list|2>&1|\| ?head|\bBash\b|claude|anthropic|codex|sonnet|haiku|opus|gpt-|mcp__|\/home\/|~\/|files\/|\.md\b|\bpane\b|terminal|\d+ ?%|a command|ffmpeg|magick|\bls -la\b|```|`|\besc\b|529/i;
// URLs are for fetching files, never shown as text; nor are times, which are numbers (a timestamp can contain "529"),
// nor `quietSince`, the machine token behind "Leave it" — never words a person reads.
const shown = (x: unknown) => JSON.stringify(x, function (k, v) {
  if (this.evidence === 'draft' && k === 'draftText') return undefined;
  if (this.evidence === 'draft' && k === 'preview') return { ...v, body: undefined };
  return k === 'url' || k === 'at' || k === 'quietSince' ? undefined : v;
});

test('nothing technical survives the adapter', () => {
  const h = A.chatgpt([{ account: 'chatgpt', name: 'ChatGPT', signedIn: false, signIn: { state: 'waiting', url: 'https://auth.openai.com/codex/device', code: 'AB12-CDE34' } }]);
  const views = {
    crew: A.crew(state), chief: A.chief(state), cards: A.cards(state), work: A.work(state), things: A.things(state), ideas: A.ideas(state),
    steps: A.steps(page.trail, undefined, true), memories: A.memories(page.notes), personality: A.personality(page.soul), knows: A.knows(page.skills), routines: A.routines(state), gallery: A.gallery(state),
    resting: A.resting(state), apps: A.apps(state), chatgpt: { ...h, signing: { code: h.signing?.code } },
    profile: A.profileParts('I run a bakery. See files/plan and `make` with sonnet about it.'),
  };
  for (const [name, v] of Object.entries(views)) assert.doesNotMatch(shown(v), FORBIDDEN, name);
  // A chat answer is the exception: it reads as written, never scrubbed — the person sees what the helper said.
  const [reply] = A.lines(page, 'reel').filter((l) => l.from === 'them');
  assert.match(reply.text, /`ffmpeg -i/);
  const jobView = A.jobParts({ does: 'Compare prices.', aim: 'Find a fair option.', gets: 'The person’s budget.', how: 'Check two sources.', great: 'A sourced comparison with totals.', prompt: 'You are Quill. Read /home/alex/private/AGENTS.md' });
  assert.doesNotMatch(shown(jobView), /You are|\/home\/|AGENTS\.md/, 'job view contains only the five plain recipe parts, never prompt text or paths');
  assert.equal(h.signing?.code, 'AB12-CDE34', 'the one-time code reaches the sign-in sheet');
  assert.deepEqual(A.knows(page.skills).map((k) => k.says), ['Turn photos into a short video', 'plan dinners'], 'the person\'s words, never the model\'s');
  const aboutSoul = A.soulText('Reel', 'Upbeat and practical\nLoves a tidy thirty seconds');
  assert.match(aboutSoul, /^# Reel\n\n## How you come across\n- Upbeat and practical\n- Loves a tidy thirty seconds\n$/, 'the family\'s words become the helper\'s instructions');
  assert.deepEqual(A.aboutTraits('Reel', aboutSoul), ['Upbeat and practical', 'Loves a tidy thirty seconds'], 'the family reads traits, not instructions');
  assert.ok(!/\byou\b/i.test(A.aboutDraft('Reel', page.soul)), 'no second-person prompt text reaches the family');
  assert.equal(A.withoutMemory(A.withMemory('- One\n', 'Two'), 0), '- Two\n');
  assert.equal(A.profileText(A.profileParts('I run a bakery. My audience is local families.')), 'I run a bakery. My audience is local families.', 'the record reads back as Chief left it');
  assert.deepEqual(A.profileParts('Warm and plain, no closing mark'), ['Warm and plain, no closing mark'], 'a trailing fragment is a part of its own');
});

test('the account list is the one crewd really serves: every route, none made up', () => {
  // The honest matrix: every subscription route /api/accounts serves renders on Settings — no route hidden,
  // none invented, and ChatGPT (the verified front door) first.
  const providers = Object.keys(PROVIDERS);
  assert.deepEqual(A.AIS.map((ai) => ai.key), providers);
  assert.equal(A.AIS[0].key, 'chatgpt');
  const rows = providers.map((key) => ({ account: key, name: key, signedIn: false, restingUntil: 0 }));
  for (const ai of A.AIS) {
    const g = A.account(rows, ai.key);
    assert.equal(g.state, 'signed-out');
    assert.ok(!/connected|ready/i.test(JSON.stringify(g)), 'a route without an account never reads as tested');
  }
  // The honest word under the list: a plan they already pay for, and the pay-for-each-use kind is not set up here.
  assert.match(A.AI_ROUTES, /plan you already pay for/, 'the limitation is a person\'s words');
  assert.doesNotMatch(A.AI_ROUTES, /API key|bill|\broutes?\b|provider/i, 'no billing or machinery words under the account list');
  for (const ai of A.AIS) assert.doesNotMatch(ai.cli ?? '', /\bCLI\b/, `${ai.name}'s prerequisite names a product, never an acronym`);
  // Name and billing come from the kit's own catalogue, so a new kit route lands labelled and nothing drifts.
  for (const ai of A.AIS) if (ROUTES[ai.key]) assert.deepEqual([ai.name, ai.billing], [ROUTES[ai.key].name, ROUTES[ai.key].billing], `${ai.key} is the kit's own row`);
  // Every route says honestly how the person pays: a plan they already have, or charged per use.
  const listed = A.aiList(rows).more.map((r) => ({ name: r.ai.name, cli: r.ai.cli, says: r.says }));
  for (const row of listed) {
    if (row.cli) continue; // this one needs a tool installed first; its billing shows in the line under the list
    const api = ROUTES[providers.find((k) => ROUTES[k]?.name === row.name) ?? '']?.billing === 'api';
    assert.match(row.says, api ? /charged per use/i : /your own .* plan/i, `${row.name}'s row states its billing honestly`);
  }
  assert.deepEqual(listed.find((r) => r.name === 'OpenRouter'), { name: 'OpenRouter', cli: undefined, says: 'Not set up. Charged per use on your OpenRouter account.' });
  const phone = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.match(phone, /<Label>Your AI accounts<\/Label>/);
  assert.match(phone, /\{row\(A\.AIS\[0\]\)\}/, 'ChatGPT, the front door, is named first');
  assert.match(phone, /\{A\.AIS\.slice\(1\)\.map\(row\)\}/, 'the phone shows the same six routes, not a second list');
  assert.match(phone, /\{A\.AI_ROUTES\}/, 'the pay-for-each-use limitation reaches the phone');
  assert.match(phone, /Signing in happens on the home computer, in Settings\. This phone can't tell whether an account is signed in\./, 'no invented phone sign-in state');
  assert.match(phone, /onPress=\{\(\) => go\(\{ view: 'phone' \}\)\} accessibilityRole="button" accessibilityLabel="Check AI account sign-in/, 'Home leads to the disclosure');
  // The resting sentence names the account when it can and stays generic when it can't — both machinery-free.
  assert.match(A.resting({ resting: { chatgpt: now + 60_000 } }), /^Your ChatGPT is resting until /);
  assert.match(A.resting({ resting: { notARoute: now + 60_000 } }), /^The crew is resting until /);
});

test('asks become plain cards: money never gets "always", a blocked terminal becomes a question', () => {
  const [run, spend, question, keep] = A.cards(state);
  assert.equal(keep.head, 'Reel learned something');
  assert.deepEqual(keep.choices.map((c) => c.label), ['Yes, keep it', 'Not now'], 'a suggestion is yes or no, never "always"');
  assert.equal(keep.preview?.head, 'How Reel would do it');
  assert.equal(run.words, 'Reel would like your OK to carry on.');
  assert.deepEqual(run.choices.map((c) => c.label), ['Yes, go ahead', 'Always OK for Reel', 'Not now']);
  assert.equal(spend.kind, 'spend');
  assert.ok(!spend.choices.some((c) => /always/i.test(c.label)));
  assert.equal(question.kind, 'question');
  assert.ok(question.reply);
  // The engine's own words and preview win once it sends them (docs/ui-contract.md).
  const send = A.card({ id: 9, bot: 'reel', kind: 'permission', at: now, detail: { effect: 'send', words: 'Reel wants to email Aunty Sara. Send it?', always: 'Aunty Sara', preview: { head: 'To Aunty Sara', body: 'Dear Aunty Sara' } } }, state);
  assert.equal(send.words, 'Reel wants to email Aunty Sara. Send it?');
  assert.deepEqual(send.choices.map((c) => c.label), ['Send', 'Always OK for Aunty Sara', 'Not now']);
  assert.equal(A.card({ id: 8, bot: 'reel', kind: 'connect', at: now, detail: { app: 'drive' } }, state).app?.name, 'Google Drive');
});

test('Needs you: spending and sending first, then questions; a suggestion waits in its helper\'s chat', () => {
  const rows = A.needsYou(state);
  assert.deepEqual(rows.map((c) => c.kind), ['spend', 'ok', 'question'], 'money and messages, then OKs, then questions');
  assert.ok(!rows.some((c) => /learned something/.test(c.head)), 'a proposal never sits on Home; it lives in the helper\'s chat');
  // and the proposal's dot moves to that helper's row in the list
  assert.equal(A.chats(state).find((c) => c.id === 'reel')?.unread, 1, 'the unread dot carries the suggestion');
  assert.equal(A.chats(state).find((c) => c.id === 'scout')?.unread, 0, 'nobody else\'s dot moves');
});

test('a helper\'s draft waits in Needs you, named for who it goes to; the row\'s tap opens the review, and approving never sends', async () => {
  // The real path: a scout job drafts a reply (crew_write then crew_draft) and the ask the app receives
  // is crew.snapshot()\'s — every open ask already through Crew.askView. Web and the phone render from
  // these same adapter calls (mobile/App.tsx imports adapter.ts), so this covers both view models.
  const { setup: lab, settled } = await import('./lab.ts');
  const { crew, db, done } = lab();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  const body = "Hello, the signed trip form is in Ayaan's bag this morning. Thank you, Umer\n\nCrewhouse helps me work with ChatGPT, GPT-5 and `drafts`.";
  // A skill is kept instructions, so its own words refuse a backtick; the scrubbing below is about model names and paragraphs.
  const steps = 'Keep the reply short.\n\nGPT-5 never gets to write it for you.';
  const call = (name: string, args: object) => `[tool ${name} ${JSON.stringify(args)}]`;
  await settled(db, (await crew.post('scout', 'Draft the reply on a card in front of me. '
    + call('crew_write', { path: 'files/reply-trip-form.md', content: `  ${body}\n` })
    + call('crew_draft', { path: 'files/reply-trip-form.md', channel: 'email', subject: 'Ayaan’s trip form — Friday', to: 'the school office' })
    + call('crew_learn', { name: 'Prepare replies', description: 'When preparing replies', says: 'Prepare a reply', steps })))!.task);
  const s: Json = crew.snapshot();
  const ask = s.asks.find((a: any) => a.kind === 'propose' && a.detail.draft)!;
  assert.equal(ask.detail.draft.to, 'the school office', 'askView passes the draft through; without it Home drops the row');
  assert.equal(ask.detail.yes, 'Approve', 'the yes approves the draft; it is never a send');
  const c = A.card(ask, s);
  assert.equal(c.head, 'Scout wrote your email', 'the card says what it is and who it is for, never "learned something"');
  assert.deepEqual(c.choices.map((x: any) => x.label), ['Copy', 'Reject'], 'with no link the yes copies the words and approves; nothing is sent');
  assert.match(c.preview?.body ?? '', /trip form/, 'the sheet the row opens shows the words');
  assert.equal(c.draftText, body, 'the words to change are the draft itself, not a tidied copy');
  const rows = A.needsYou(s);
  assert.equal(rows.find((r: any) => r.id === ask.id)?.head, 'Scout wrote your email', 'the draft is a Needs-you row, ready to tap');
  assert.ok(!rows.some((r: any) => /learned something/.test(r.head)));
  assert.equal(rows.find((r: any) => r.id === ask.id)?.preview?.body, body, 'Needs you keeps every draft word and paragraph');
  assert.doesNotMatch(shown(c), FORBIDDEN, 'only the draft body is exempt');
  // askView never hands the app the skill itself: a proposal that is not a draft is the one to remember.
  const skill = A.card(s.asks.find((a: any) => a.kind === 'propose' && !a.detail.draft)!, s);
  assert.doesNotMatch(shown(skill), FORBIDDEN, 'skill bodies are still scrubbed');
  assert.doesNotMatch(skill.preview?.body ?? '', /GPT-5|\n\n/, 'a skill proposal is still plain: no model name, no paragraph break');
  assert.match(shown({ evidence: 'lines', preview: { body: 'Use `drafts` with sonnet' } }), FORBIDDEN,
    'other preview bodies never get the draft exemption');
  done();
});

test('draft cards keep the recipient, email subject and exact message separate across channels', async () => {
  const { setup: lab, settled } = await import('./lab.ts');
  const { crew, db, done } = lab();
  crew.onboard('sir');
  crew.recruit('scribe', 'Scribe', 'person');
  try {
    for (const [channel, to, subject, message] of [
      ['email', 'returns@shop.example', 'Order 98765 refund', 'Hello,\n\nPlease confirm my refund.\n\nThanks,\nUmer'],
      ['email', 'office@school.example', 'Friday trip', 'Hello,\n\nThe form is in the bag.\n\nThanks,\nUmer'],
      ['message', 'Sara', '', 'Can we meet at 6?'],
      ['post', 'X', '', 'One small win today.\n\nThe seedlings are up. #garden'],
    ]) {
      const tool = (name: string, args: Json) => `[tool ${name} ${JSON.stringify(args)}]`;
      const { task } = (await crew.post('scribe', 'Recommended: X1. Draft only. This is the TASK TITLE. '
        + tool('crew_write', { path: 'files/message.md', content: message }) + ' '
        + tool('crew_draft', { path: 'files/message.md', channel, to, ...(subject ? { subject } : {}) })))!;
      await settled(db, task);
      const state = crew.snapshot();
      const ask = state.asks.find((a: Json) => a.detail.draft?.to === to)!;
      const c = A.card(ask, state);
      assert.equal(c.head, `Scribe wrote your ${channel}`);
      assert.equal(c.words, c.head, 'the headline never repeats job text or recipient');
      assert.equal(c.draftTo, to);
      assert.equal(c.draftSubject, subject || undefined);
      assert.equal(c.preview?.body, message, 'paragraphs, first line and hashtags stay intact');
      assert.equal(c.draftText, message, 'Edit starts with exactly the message on the card');
      assert.equal(c.status, `Nothing is sent · ${channel === 'post' ? 'post' : 'send'} it yourself`);
      assert.deepEqual(c.choices.map((x) => x.label), ['Copy', 'Reject']);
    }
    assert.equal(crew.snapshot().asks.filter((a: Json) => a.detail.draft).length, 4, 'two email cards with the same short headline both arrive');
  } finally { done(); }
});

test('a draft card filed before its channel was recorded still names a real noun, never undefined', () => {
  // The card an older crewd filed: the draft is there, the channel never was. The renderer's own words, not the row's title.
  const ask: Json = { id: 7, bot: 'scribe', kind: 'propose', at: 1, member: 1, title: 'Scribe wrote your undefined.', detail: {
    draft: { to: 'X launch post', subject: undefined, path: 'files/x.md', sha: 'abc' },
    preview: { body: 'One small win today.' } } };
  const c = A.card(ask, { asks: [ask], bots: [{ id: 'scribe', display: 'Scribe' }] } as any);
  assert.equal(c.head, 'Scribe wrote your draft');
  assert.doesNotMatch(`${c.head} ${c.words} ${c.status}`, /undefined/, 'no raw undefined reaches the person');
  assert.equal(c.status, 'Nothing is sent · send it yourself');
});

test('a draft is words to send, not a document: its heading marks go, its words stay', () => {
  // What Scribe filed: markdown headings in a plain email the person would send with the marks still in it.
  const body = '# Overdue refund follow-up\n\n## Recommended\n\nHello,\n\nPlease confirm my refund.\n\nThanks,\nUmer';
  const ask: Json = { id: 8, bot: 'scribe', kind: 'propose', at: 1, member: 1, title: 'Scribe wrote your email.', detail: {
    draft: { channel: 'email', to: 'returns@shop.example', subject: 'Refund', path: 'files/a.md', sha: 'abc' },
    preview: { body } } };
  const c = A.card(ask, { asks: [ask], bots: [{ id: 'scribe', display: 'Scribe' }] } as any);
  for (const text of [c.head, c.words, c.status, c.preview?.body, c.draftText].join('\n'))
    assert.doesNotMatch(text, /^\s*#{1,6}\s/m, 'no raw heading marks reach the person');
  assert.equal(c.preview?.body, 'Overdue refund follow-up\nRecommended\n\nHello,\n\nPlease confirm my refund.\n\nThanks,\nUmer');
  assert.equal(c.draftText, c.preview?.body, 'Edit starts from the same words the card shows');
  assert.match(c.preview!.body, /Please confirm my refund\./, 'the words themselves are untouched');
});

test('a draft whose body repeats its own subject line shows it once', () => {
  // What the real model files: the subject line inside the body too. The card already heads it.
  const ask: Json = { id: 9, bot: 'scribe', kind: 'propose', at: 1, member: 1, title: 'Scribe wrote your email.', detail: {
    draft: { channel: 'email', to: 'the school office', subject: 'Trip form Friday', path: 'files/a.md', sha: 'abc' },
    preview: { body: 'Subject: Trip form Friday\n\nHello,\n\nThe form is in the bag.\n\nThanks,\nUmer' } } };
  const c = A.card(ask, { asks: [ask], bots: [{ id: 'scribe', display: 'Scribe' }] } as any);
  assert.equal(c.draftSubject, 'Trip form Friday');
  assert.equal(c.draftText, 'Hello,\n\nThe form is in the bag.\n\nThanks,\nUmer', 'the repeated line goes, every other word stays');
  const other: Json = { id: 10, bot: 'scribe', kind: 'propose', at: 1, member: 1, title: 'Scribe wrote your email.', detail: {
    draft: { channel: 'email', to: 'the school office', subject: 'Trip form Friday', path: 'files/b.md', sha: 'def' },
    preview: { body: 'Subject: something else entirely\n\nHello.' } } };
  const d = A.card(other, { asks: [other], bots: [{ id: 'scribe', display: 'Scribe' }] } as any);
  assert.match(d.draftText ?? '', /^Subject: something else entirely/, 'a line that says more than the subject stays');
});

test("a draft card flows the model's hard wraps; Copy and Edit keep the exact words", () => {
  // What the real model files: every sentence wrapped mid-line. The card reads it as prose.
  const wrapped = 'Hello,\n\nThanks for the reminder about the trip form. I have it\nhere, and I will get it signed and back to you before Friday.\n\nThanks,\nUmer';
  assert.equal(A.flowed(wrapped),
    'Hello,\n\nThanks for the reminder about the trip form. I have it here, and I will get it signed and back to you before Friday.\n\nThanks, Umer',
    'lone newlines read as spaces, blank lines stay paragraph breaks');
  const ask: Json = { id: 11, bot: 'scribe', kind: 'propose', at: 1, member: 1, title: 'Scribe wrote your email.', detail: {
    draft: { channel: 'email', to: 'the school office', subject: 'Trip form Friday', path: 'files/a.md', sha: 'abc' },
    preview: { body: wrapped } } };
  const c = A.card(ask, { asks: [ask], bots: [{ id: 'scribe', display: 'Scribe' }] } as any);
  assert.equal(c.draftText, wrapped, 'Copy and Edit start from the filed words, wraps and all');
  const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'parts.tsx'), 'utf8');
  const card = src.slice(src.indexOf('export function AskCard'), src.indexOf('/** The approval moment'));
  assert.match(card, /flowed\(c\.preview\.body\)/, 'the card view flows the draft body');
  const sheet = src.slice(src.indexOf('export function AskSheet'));
  assert.doesNotMatch(sheet, /flowed/, 'the review sheet keeps the exact words');
});

test('Home commits nothing: a row opens the review sheet, and a starter fills the box without sending', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  const home = src.slice(src.indexOf('function NeedsRows('), src.indexOf('function ChiefRail('));
  assert.ok(!home.includes('<AskCard'), 'ask cards with buttons sat right on Home; a row opens the sheet instead');
  assert.match(home, /needs-row/, 'the compact Needs-you rows');
  assert.match(home, /href=\{`#\/ask\/\$\{c\.id\}`\}/, 'every row opens the existing review sheet');
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.doesNotMatch(app, /api\.post\(i\.bot/, 'an idea chip fills the draft, it never sends');
});

test('Home keeps a standing "hand me a job" list, straight from crewd\'s ideas: a goal first, then money back, and a job that needs an app says so', () => {
  const withJobs = { ...state, ideas: [
    { bot: 'scout', promise: 'I\'ll search the government\'s unclaimed-money registers for your name and get the claims ready to file. I\'ll file it end to end — you just tap approve.', ask: 'Search for money owed to me that nobody has claimed', group: 'money', needs: [] },
    { bot: 'scout', promise: 'I\'ll claim the money back the day the price drops. I\'ll do it end to end — you just tap approve.', ask: 'Watch something I bought', group: 'money', needs: ['Gmail'] },
    { bot: 'scribe', promise: 'Say who it is for and the email is written', ask: 'Write an email to ' },
    { bot: 'reel', promise: 'Turn photos into a short video', ask: 'Make a video from these photos: ' },
  ] };
  const rows = A.jobs(withJobs);
  assert.deepEqual(rows.map((r) => [r.bot, r.needs.length]), [['scout', 0], ['scout', 1], ['scribe', 0], ['reel', 0]], 'money back leads — the job that waits on nothing first — and a waiting row keeps its needs');
  assert.equal(rows[0].label, withJobs.ideas[0].ask, 'Home uses the short ask as the row');
  assert.equal(A.jobs({ ...withJobs, bots: [...state.bots, { id: 'scout', display: 'Scout' }] })[0].says, 'Scout · I\'ll search the government\'s unclaimed-money registers for your name and get the claims ready to file.', 'under it, whose job it is and one sentence of the promise');
  for (const r of rows) assert.ok((r.says.match(/[.!?](\s|$)/g) ?? []).length <= 1, `at most one sentence of a promise: ${r.says}`);
  assert.equal(A.jobs({ ...state, ideas: [{ bot: 'chief', promise: "What's on this week?", ask: "What's on this week?" }] })[0].says, '', 'a promise that only repeats the ask adds no line');
  assert.match(A.homeSummary({ ...withJobs, asks: [], bots: [] }), /0 things need you · 0 helpers working/, 'the summary follows the rows, not demo copy');
  assert.deepEqual(A.ideas(withJobs).map((i: any) => i.bot), ['scout', 'scribe', 'reel'], 'Chief\'s chips stay jobs the crew can run now — the unclaimed search needs nothing, so it chips too');
  assert.match(A.jobNeeds(rows.find((r) => r.needs.length)!.needs), /^Needs Gmail first\.$/);
  assert.doesNotMatch(shown(rows), FORBIDDEN, 'the list is a person\'s sentence, not a screen of details');
  // The claim card is a press, not a message going out: it says acting on a site, and names the page's own button.
  const press = A.card({ id: 9, bot: 'scout', kind: 'permission', state: 'open',
    title: 'Scout wants to press “Request price adjustment” on shop.example, a site you signed it in to. The page shows $999.00.',
    detail: { effect: 'send', press: true, spends: false,
      words: 'Scout wants to press “Request price adjustment” on shop.example, a site you signed it in to. The page shows $999.00.',
      preview: { head: 'What Scout will press on shop.example', body: "You'd get $50.00 back.\nPaid on 12 March: $999.00\nRequest price adjustment" } } }, withJobs);
  assert.equal(press.head, 'Scout wants to act on a site', 'a press is not called a message ready to send');
  assert.match(press.choices[0].label, /press it/i);
  assert.match(press.preview!.body, /Request price adjustment/, 'the button, as the page writes it');
  assert.match(press.preview!.body, /You'd get \$50\.00 back\./, 'and what they get back, when the page wrote both prices');
  assert.equal(press.choices.find((c: any) => c.body.scope === 'always'), undefined, 'no standing answer for acting as the person');
  // A form line being filled is a fill card, not a press: "Yes, fill it in" — "these in" for more than one line — and
  // the family's data sits in the preview and nowhere else.
  const fill = A.card({ id: 10, bot: 'scout', kind: 'permission', state: 'open',
    title: 'Scout wants to fill “Owner\'s full name” on unclaimed.example, a site you signed it in to.',
    detail: { effect: 'send', press: true, fill: true, spends: false,
      words: 'Scout wants to fill “Owner\'s full name” on unclaimed.example, a site you signed it in to.',
      preview: { head: 'What Scout will fill in on unclaimed.example', body: "Owner's full name: Ada Lovelace" } } }, withJobs);
  assert.equal(fill.head, 'Scout wants to act on a site', 'a form line is the same acting-on-a-site card');
  assert.match(fill.preview!.body, /Owner's full name: Ada Lovelace/, 'the line, label then value');
  assert.equal(fill.choices[0].label, 'Yes, fill it in');
  const these = A.card({ id: 11, bot: 'scout', kind: 'permission', state: 'open',
    title: 'Scout wants to fill in 3 lines on the claim form at unclaimed.example.',
    detail: { effect: 'send', press: true, fill: true, spends: false,
      words: 'Scout wants to fill in 3 lines on the claim form at unclaimed.example.',
      preview: { head: 'What Scout will fill in on unclaimed.example', body: "Owner's full name: Ada Lovelace\nAddress the money was owed at: 12 Lovelace Lane\nEmail for this claim: ada@example.net" } } }, withJobs);
  assert.equal(these.choices[0].label, 'Yes, fill these in', 'more than one line, these in');
  assert.equal(fill.choices.find((c: any) => c.body.scope === 'always'), undefined, 'and still no standing answer');
  const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  const home = src.slice(src.indexOf('function Home('), src.indexOf('/** The standing'));
  assert.match(home, /<JobList state=\{state\} few refresh=\{refresh\} \/>/, 'the desk\'s feed, beside On it now and Done today');
  assert.match(home, /<JobList state=\{state\} phone refresh=\{refresh\} \/>/, 'and under the chats on a phone');
  const list = src.slice(src.indexOf('function JobList('), src.indexOf('function ChiefIdeas('));
  assert.match(list, /A\.jobs\(state\)/, 'the rows are the ideas, not a list written in the app');
  assert.match(list, /keepDraft\('chief', ask\)/, 'a tap fills Chief\'s box; it never sends');
  assert.match(list, /className="list-row"/, 'Home uses a whole-row target on both widths');
  assert.doesNotMatch(list, /api\.post/, 'nothing is handed over by itself');
});

test('every job that sends or spends names its ask-first step, and Home shows it under the row', () => {
  // The template rule (src/bots.ts `ideas`): a promise that sends or spends names its ask-first step in its own
  // words. It reaches Home only with its source: the row carries the short ask, the promise's first sentence sits
  // under it. Proof is only counts from local rows — the digest's Finished lines and "done today" — never a "time
  // given back" figure, which no row records.
  const SEND_SPEND = /\b(paid|purchase|order|cart|checkout|refund|lookup|claims? ready|end to end|asks? you first|ask (you )?before|tap approve|approve it|you send|you post|send it|post (it|them)|file it)\b/i;
  const ASK_FIRST = /\b(tap approve|approve it|asks? you first|ask (you )?before|you read|you send|you post|never contact|like any purchase)\b/i;
  const NO_TIME_FIGURE = /time (given|saved)|given back|saved you|hours? (saved|back)/i;
  const tplNames = ['scout', 'scribe', 'tracer', 'reel'];
  const ideas = tplNames.flatMap((t) => {
    const j = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'templates', t, 'bot.json'), 'utf8'));
    return (j.ideas as any[]).map((i) => ({ bot: t, ...i }));
  });
  const outbound = ideas.filter((i) => SEND_SPEND.test(i.promise));
  assert.ok(outbound.length >= 8, `enough send/spend jobs to pin the rule (${outbound.length})`);
  for (const i of outbound) assert.match(i.promise, ASK_FIRST, `${i.bot} names its ask-first step: ${i.promise.slice(0, 60)}\u2026`);
  for (const i of ideas) assert.doesNotMatch(`${i.promise} ${i.ask}`, NO_TIME_FIGURE, `${i.bot} shows no time figure`);
  const st = { ...state,
    bots: [...state.bots, ...tplNames.map((t) => ({ id: t, display: t[0].toUpperCase() + t.slice(1) }))],
    ideas: ideas.map((i) => ({ bot: i.bot, promise: i.promise, ask: i.ask, group: i.group, needs: [] })) };
  for (const i of outbound) {
    assert.ok(A.jobs(st).find((r) => r.ask === i.ask)!.says.length > 0, `Home shows the promise under the row: ${i.ask.slice(0, 40)}`);
  }
  const web = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8')
    + readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'adapter.ts'), 'utf8');
  assert.doesNotMatch(web, NO_TIME_FIGURE, 'no time figure beside the counts');
});

test('a freshly recruited helper opens on its own starters, and a tap fills the box without sending', () => {
  const withJobs = { ...state, ideas: [
    { bot: 'scout', promise: 'Ask me anything and I will answer with sources', ask: 'Find out ', group: 'life', needs: [] },
    { bot: 'scribe', promise: 'Say who it is for and the email is written', ask: 'Write an email to ', group: 'life', needs: [] },
  ] };
  const own = A.ideas(withJobs).filter((i: any) => i.bot === 'scout');
  assert.deepEqual(own.map((i: any) => i.bot), ['scout'], 'a helper sees its own rows, never another helper\'s');
  assert.equal(own[0].ask, 'Find out ', 'the chip carries the ask words');
  // A tap fills the box: the composer remounts from the draft (key={seed}) and nothing is posted.
  keepDraft('scout', own[0].ask);
  assert.equal(draftOf('scout').text, 'Find out ', 'the tap filled the helper\'s box');
  keepDraft('scout', '');
  const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.match(src, /const fresh = !lines\.length/, 'the hidden join note counts as a fresh chat, not only an empty one');
  assert.match(src, /joined the crew`\)\)/, 'fresh means only that note');
  assert.match(src, /<HelperIdeas state=\{state\} chat=\{id\}/, 'a helper gets its own chips beside Chief\'s');
  const helper = src.slice(src.indexOf('function HelperIdeas'), src.indexOf('function HelperIdeas') + 700);
  assert.match(helper, /i\.bot === chat/, 'the helper\'s chips are its own ready rows');
  assert.match(helper, /keepDraft\(chat, i\.ask\)/, 'a tap fills the box');
  assert.doesNotMatch(helper, /api\.post/, 'it never sends');
  const chat = src.slice(src.indexOf('function Chat('), src.indexOf('function Chat(') + 9500);
  assert.match(chat, /fresh && page/, 'the fresh chat renders the starters');
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  const phone = app.slice(app.indexOf('function Chat('), app.indexOf('function Chat(') + 9000);
  assert.match(phone, /joined the crew`\)\)/, 'the phone uses the same fresh condition');
  assert.match(phone, /i\.bot === id/, 'the phone filters to the helper\'s own rows too');
  assert.match(phone, /keepDraft\(id, i\.ask\)/, 'a phone tap fills the box');
  assert.doesNotMatch(phone.slice(phone.indexOf('s.chips'), phone.indexOf('s.chips') + 600), /api\.post/, 'and never sends');
});

test('chat navigation acts like chat: no tab scroller, Details behind the header, Back by history', () => {
  assert.equal(A.lines({ messages: [{ id: 1, author: 'bot', text: 'Hello' }] }, 'scout')[0].at, undefined, 'old lines without timestamps keep asks in the thread');
  const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.doesNotMatch(src, /className="tabs"/, 'the seven-tab scroller is gone; the chat is the page and Details is one link');
  assert.match(src, /Details<\/button>/, 'Details is a text button in the chat header');
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.doesNotMatch(app, /tabPill/, 'the phone has no tab strip either');
  assert.doesNotMatch(app, /\['chief', 'helper', 'add'\]\.includes\(route\.view\) \? 'crew'/, 'a helper chat lights Chats, not Crew');
});

test('first success: starters never dead-end, and setup stays in Settings', () => {
  // Google not set up: the calendar starter sits out; a party plan takes its place.
  const on = A.firstIdeas({ house: { google: true } });
  const off = A.firstIdeas({ house: { google: false } });
  assert.equal(on.length, 3);
  assert.equal(off.length, 3);
  assert.ok(!off.some((i) => i.label.includes("What's on this week")), 'the calendar starter waits for Google setup');
  assert.ok(off.some((i) => /birthday party/i.test(i.label)));
  // The house's three jobs, and how many are left.
  const openrouter = [{ account: 'openrouter', name: 'OpenRouter', signedIn: true }];
  assert.equal(A.homeSetup({ house: { google: true } }, openrouter, { anywhere: 'anywhere' }).left, 0,
    'any signed-in account finishes the job, not only the front door');
  const half = A.homeSetup({ house: { google: false } }, [{ account: 'chatgpt', name: 'ChatGPT', signedIn: false }], { anywhere: 'anywhere' });
  assert.deepEqual(half.rows.filter((r) => !r.done).map((r) => r.key), ['signin', 'google']);
  assert.equal(half.rows[0].says, 'An AI plan the crew can think with', 'nobody signed in: no provider is named');
  const claude = [{ account: 'chatgpt', signedIn: false }, { account: 'claude', name: 'Claude', signedIn: true }];
  assert.equal(A.homeSetup({ house: {} }, claude, null).rows[0].says, 'The crew thinks with your Claude plan', 'the plan actually in use, never ChatGPT');
  const out = [{ account: 'chatgpt', signedIn: false }, { account: 'grok', signedIn: false }, { account: 'claude', name: 'Claude', signedIn: false, signedOut: true }];
  assert.equal(A.aiList(out).mine[0].ai.key, 'claude', 'the sign-in card leads with the account that signed out, never the front door');
  assert.equal(A.planName(openrouter), 'OpenRouter account', 'a pay-per-use route is not called a plan');
  const web = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.doesNotMatch(web, /MemberRow|memberSetup|set me up for you/, 'Home and Hello serve one person');
  assert.match(web, /<SetupRow state=\{state\}/, 'the person keeps the setup checklist');
  assert.doesNotMatch(web, /A\.OWNER/, 'setup serves the person without a household role selector');
  const phone = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  const hello = phone.slice(phone.indexOf('function Hello('), phone.indexOf('// ---------- asks ----------'));
  assert.doesNotMatch(hello, /named|A\.OWNER/, 'the phone has one Hello flow');
  assert.ok(hello.indexOf('{name}') < hello.indexOf('A.firstIdeas'), 'the name comes before the ideas');
});

test('the runs-at-home line is said once, in the same plain words, in all three places a family meets it', () => {
  const [here, on, only] = A.atHome();
  assert.equal(here, 'Your helpers live on this computer and use your own sign-ins.', 'no technical words, no vendor voice');
  // the one truthful condition, repeated word for word wherever the computer or pairing comes up
  assert.equal(on, 'The crew works only while this computer is on and connected to the internet.');
  assert.equal(on, A.awake());
  // honest about what does leave: what a job needs, to ChatGPT or the app it's using (README, "Nothing leaves your machine…")
  assert.equal(only, "Nothing you tell them is kept anywhere else — only what a job needs goes to your AI plan or the app it's using.");
  assert.match(A.atHome(undefined, 'Claude plan')[2], /goes to your Claude plan or/, 'Settings names the plan in use');
  assert.doesNotMatch(`${here} ${on} ${only}`, FORBIDDEN);
  assert.match(A.atHome('the home computer')[0], /^Your helpers live on the home computer and use your own sign-ins\.$/, 'the phone names the home computer');
  assert.equal(A.atHome('the home computer')[1], A.awake('the home computer'));
  const web = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.equal([...web.matchAll(/A\.atHome\(/g)].length, 3, 'Hello and Settings both quote it; nobody paraphrases it');
  assert.match(web, /<ul className="promises">\s+<li>[^<]+<\/li>\s+<li>\{A\.atHome\(\)\[1\]\}<\/li>\s+<li>\{A\.atHome\(\)\[2\]\}<\/li>\s+<li>[^<]+<\/li>\s+<\/ul>/, "it sits in Hello's promises, the condition right after where the helpers live");
  assert.match(web, /<h1>Settings<\/h1>\s+<p className="mute small">\{A\.atHome\(undefined, A\.planName\(accounts\)\)\.join\(' '\)\}<\/p>/, 'Settings says it under the title, in the quiet style');
  assert.match(web, /<b>Reach it away from home<\/b>\s+<p className="mute small">\{A\.awake\(\)\}<\/p>\s+<p className="mute small">\{A\.anywhere\(link\)\.words\}<\/p>/, 'pairing a phone repeats the condition');
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.equal([...app.matchAll(/A\.atHome\('the home computer'\)/g)].length, 2, 'the phone quotes it at first run and on This phone');
  assert.match(app, /\{\[\.\.\.A\.atHome\('the home computer'\), "I'll ask/, 'first run on the phone shows every line, condition included');
  assert.match(app, /\{A\.atHome\('the home computer'\)\.join\(' '\)\}<\/T>\s+<T tone="mute" style=\{s\.small\}>🔒/, 'on This phone it sits above the lock line');
  assert.match(app, /\{A\.awake\('your computer'\)\}<\/T>\s+<T [^>]+>🔒 Only your computer/, 'the phone says it before pairing, above the lock line');
  assert.doesNotMatch(app, /I run the crew on this computer/, 'the phone never calls the family computer "this computer"');
  // No surface promises more than is true: no guaranteed reach, no cost or setup claim, no detection talk.
  const adapter = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'adapter.ts'), 'utf8');
  const PROMISE = /always works|works (from )?anywhere|from anywhere|no setup|zero cost|free (forever|connector)|always online|bypass detection|residential|untraceable/i;
  for (const [name, src] of [['main.tsx', web], ['adapter.ts', adapter], ['App.tsx', app]]) assert.doesNotMatch(src.replace(/^\s*(\/\/|\/?\*).*$/gm, ''), PROMISE, name);
});

test('Tracer is visible and recruitable without an owner filter', () => {
  assert.ok(A.crew(state).some((h) => h.id === 'tracer'));
  assert.ok(A.gallery(state).some((t: Json) => t.id === 'tracer'));
  const legacy = { ...state, templates: [{ id: 'tracer', display: 'Tracer', ownerOnly: true }] };
  assert.ok(A.gallery(legacy).some((t: Json) => t.id === 'tracer'), 'old template metadata cannot hide it');
});

test('the screens read view models only, and the mono face draws art only', () => {
  const dir = join(import.meta.dirname, '..', 'web', 'src');
  // The phone app's screens too (mobile/App.tsx), which read the same adapter.
  for (const f of [...readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)), ...PHONE_SCREENS]) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /detail\.(summary|pane|rule|tool)|\.thinks\b|\.limits\b|\.runtime\b|\bclaude\b|terminal/i, f);
    if (f.includes('mobile')) assert.doesNotMatch(src, /monospace/, 'the phone app draws its art as dots, and sets no text in mono');
    else assert.doesNotMatch(src, /<pre(?![^>]*className="art)/, f);
  }
  const css = readFileSync(join(dir, 'styles.css'), 'utf8');
  for (const rule of css.split('}')) {
    if (!/var\(--art\)|monospace/.test(rule)) continue;
    // Mono draws the art, standalone times/counts in a column (.time), and inline code chips
    // in chat answers (.chat-code) - never other reading text.
    assert.match(rule, /(\.art\b|\.ascii\b|\.time\b|\.chat-code\b|--art:|@font-face)/, `mono type outside the art: ${rule.trim().slice(0, 80)}`);
  }
});

// Main563/565: the app opens on Chat with Chief; the Office is the optional view of the same state, off at every launch.
test('Home opens on Chat at every launch, with Office one tap away and never stored', () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
  for (const f of ['web/src/main.tsx', 'mobile/App.tsx']) {
    const app = src(f);
    assert.match(app, /let homeMode: HomeMode = 'chat';/, `${f}: each launch starts on Chat`);
    assert.match(app, /const HOME_MODES: \[HomeMode, string\]\[\] = \[\['chat', 'Chief'\], \['office', 'Office'\]\];/, `${f}: one Chief | Office switch`);
    assert.doesNotMatch(app, /(localStorage|AsyncStorage|SecureStore|kept\.\w+)\([^)]*homeMode/, `${f}: the view is never stored`);
    const home = app.slice(app.indexOf('function Home('));
    assert.match(home.slice(0, 2600), /<HomeBar [^>]*mode=\{mode\} pick=\{pick\} \/>/, `${f}: the switch shows in both views`);
  }
  const web = src('web/src/main.tsx');
  const home = web.slice(web.indexOf('function Home('), web.indexOf('/** The standing'));
  assert.match(home, /if \(mode === 'chat'\) return <div className="page chat-page home-chat"><div className="home-top">\{top\}<NeedsPin state=\{state\} cards=\{live\.needs\} flat \/><\/div><Chat \{\.\.\.ctx\} id="chief" hero rail=\{<ChiefRail state=\{state\} live=\{live\} refresh=\{refresh\} \/>\} \/><\/div>;/, 'web Chief: the top (a phone renders the hero block from its bar) and Needs you over his own thread, box and the ask + doing rail');
  assert.match(web.slice(web.indexOf('function HomeBar('), web.indexOf('function NeedsPin(')), /<ChiefHero live=\{ctx\.live\} state=\{ctx\.state\} signedOut=\{chiefLocal\(ctx\)\.signedOut && !ctx\.offline\} side=\{gear\} below=\{seg\} \/>/, 'the phone header is one block: hero with gear top-right, switch below its lines, carrying the sign-in the thread reads');
  const hero = web.slice(web.indexOf('function ChiefHero('), web.indexOf('function ChiefHero(') + 2200);
  assert.match(hero, /A\.chief\(state, \{ signedOut: true \}\)/, 'the phone header reads Chief from the same table as the thread, with the sign-in');
  assert.match(hero, /out \? NEEDS_SIGNIN : needs \? 'Needs you'/, 'signed out with a job queued: the thread card\'s flag, never the green "At work"');
  assert.match(hero, /<div className="ch-row">[\s\S]*className="ch-name"[\s\S]*className=\{`ch-status[\s\S]*\{side\}[\s\S]*<\/div>[\s\S]*\{below\}/, 'one compact row: avatar, the name over its single status, the small switch and the gear');
  assert.doesNotMatch(hero, /className="ch-line"/, 'exactly one status line, never a second echoing strip');
  const flows = src('web/src/flows.tsx');
  assert.match(flows, /export const NEEDS_SIGNIN = 'Needs a sign-in';/, 'one flag for the thread card and the phone header');
  assert.match(flows.slice(flows.indexOf('function AccountCard('), flows.indexOf('function AccountCard(') + 3000), /\{NEEDS_SIGNIN\}/, 'the thread card reads it from there too');
  assert.match(home, /<NeedsPin state=\{state\} cards=\{live\.needs\}( flat)? \/>/, 'Needs you pinned from the office\'s one list');
  assert.match(home, /<div className="feed-ask"><Composer/, 'Office keeps Chief\'s box on a desk');
  assert.match(home, /<div className="dock phone-only"><Composer/, 'and on a phone');
  const pin = web.slice(web.indexOf('function NeedsPin('), web.indexOf('function NeedsPin(') + 1400);
  assert.match(pin, /<NeedsCard state=\{state\} c=\{order\.slice\(0, 1\)\[0\]\}/, 'one pinned card (B1)');
  const card = web.slice(web.indexOf('function NeedsCard('), web.indexOf('/** An empty list'));
  assert.match(card, /<a className="btn go" href=\{`#\/ask\/\$\{c\.id\}`\}>/, 'its yes opens the review sheet: Home commits nothing');
  assert.doesNotMatch(card, /api\.|answer\(/, 'no answer is sent from the card');
  assert.match(pin, /`See all \$\{cards\.length\}`/, 'and an exact "See all N"');
});

test("Chief's conversation is a named transcript on a desk, a conversation on a phone", async () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
  const art = await import('../web/src/art.ts');
  const web = src('web/src/main.tsx'), css = src('web/src/styles.css'), app = src('mobile/App.tsx');
  const chat = web.slice(web.indexOf('function Chat('), web.indexOf('function Chat(') + 9500);
  assert.match(chat, /className="line-by"><span className="who">/, 'every line carries its name in the open');
  assert.doesNotMatch(chat, /<Face/, 'no faces in the transcript rows');
  assert.doesNotMatch(chat, /consecutive/, 'no collapsing: the name repeats on every line');
  assert.match(css, /\.card\.ask \{[^}]*border-top: 1px dashed/, 'the ask sits inline under a dashed rule, with no card chrome');
  // ch-pwa-chat: a phone keeps the names for screen readers only, and a card shows one primary with "⋯" for the rest.
  assert.match(css, /\.chat \.line-by \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\)/, 'a phone hides the names from sight, not from screen readers');
  assert.match(css, /\.chat \.card\.ask \.more-act \{ display: none; \}/, 'a phone card keeps one primary in sight');
  const phone = app.slice(app.indexOf('function Chat('), app.indexOf('function Chat(') + 12000);
  assert.match(phone, /\{speaker\(l\)\}/, 'the phone names every line too');
  assert.equal(art.helmet(38, 'needs', true, 0).length, 19, 'the rail helmet is the mock\'s 38-column grid');
  assert.doesNotMatch(phone, /bubbleText/, 'no bubbles on the phone either');
  for (const [f, head] of [['web/src/parts.tsx', 'function AskHead'], ['mobile/App.tsx', 'function AskHead']] as const) {
    const h = src(f).slice(src(f).indexOf(head), src(f).indexOf(head) + 700);
    assert.match(h, /askStatus|ask-status/, 'the ask keeps its Needs-you flag');
    assert.doesNotMatch(h, /<Face|Face who/, 'but loses the face');
  }
});

test('Home renders once: a second full Home (bd51524) put a second composer below the first', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.equal([...src.matchAll(/<Home\b/g)].length, 1, 'the app is one page per view, never two');
});

test('the phone app moves only through mobile/src/motion.ts, where Reduce Motion always snaps', () => {
  for (const f of PHONE_SCREENS) {
    const app = readFileSync(f, 'utf8');
    assert.doesNotMatch(app, /\bAnimated\b|LayoutAnimation|animated: true|animationType="(slide|fade)"/, `a move named outside motion.ts: ${f}`);
    for (const [m] of app.matchAll(/animationType=\{[^}]*\}|animationType="[^"]*"/g)) assert.match(m, /motion\.\w+\(reduce\)|"none"/, m);
  }
  const rule = readFileSync(join(import.meta.dirname, '..', 'mobile', 'src', 'motion.ts'), 'utf8');
  assert.match(rule, /reduce \? 'none'/, 'Reduce Motion snaps a sheet');
});

test('sign-in states reach the screens as plain states, never the engine\'s words', () => {
  const row = (signIn: any, extra = {}) => A.account([{ account: 'chatgpt', name: 'ChatGPT', signedIn: false, signIn, ...extra }]);
  const page = row({ state: 'waiting', via: 'browser', url: 'https://auth.openai.com/oauth/authorize?x' });
  assert.equal(page.page, 'https://auth.openai.com/oauth/authorize?x', 'the redirect: a page to open, no code');
  assert.equal(page.signing, null);
  assert.equal(row({ state: 'waiting', via: 'code', url: 'https://auth.openai.com/codex/device', code: 'AB12-CD34' }).signing?.code, 'AB12-CD34');
  assert.ok(row({ state: 'failed', why: 'declined', error: 'The sign-in was declined' }).declined);
  assert.ok(row({ state: 'failed', why: 'busy', error: 'Something else…' }).busy);
  assert.ok(row({ state: 'failed', error: 'The sign-in took too long.' }).expired);
  for (const signIn of [null, { state: 'waiting' }, { state: 'done', url: 'https://old.test', code: 'OLD' }, { state: 'failed', error: 'Other problem', url: 'https://old.test' }]) {
    const g = row(signIn);
    assert.equal(g.page, '', 'a missing, finished or failed sign-in never opens an old page');
    assert.equal(g.signing, null, 'only a waiting sign-in offers a code');
  }
  assert.match(row({ state: 'failed', why: 'locked', error: 'Unlock your password storage, then try again.' }).recovery, /Unlock.*try again/);
  const mixed = row({ state: 'failed', why: 'busy', error: 'The sign-in expired.' });
  assert.ok(mixed.busy && mixed.expired && !mixed.failed, 'keep the independent screen flags');
  assert.ok(row({ state: 'failed', why: 'expired', error: 'Other problem' }).failed, 'the existing view uses the expiry words');
  assert.equal(row({ state: 'waiting', code: 'AB12-CD34' }, { signedIn: true }).signing?.code, 'AB12-CD34', 'a new sign-in stays visible while the account is ready');
  assert.equal(row({ state: 'waiting', code: 'AB12-CD34' }, { signedIn: true }).state, 'signed-out', 'an unfinished sign-in never becomes a success sheet');
  const ready = row(null, { signedIn: true, notIncluded: true, work: 'sara@acme.com' });
  assert.deepEqual([ready.state, ready.notIncluded, ready.work], ['ready', true, 'sara@acme.com']);
  assert.equal(A.resting({ resting: { chatgpt: Date.now() + 3600_000 } }).startsWith('Your ChatGPT is resting until'), true);
  assert.deepEqual(A.apps({ connections: [] }).map((a) => a.id), ['drive', 'calendar', 'gmail', 'gmailsend', 'notion', 'canva'], 'v1: no Outlook');
  assert.ok(A.needsHouse({ house: { google: false } }, A.apps({}).find(a => a.id === 'calendar')!));
  assert.ok(!A.needsHouse({ house: { google: false } }, A.apps({}).find(a => a.id === 'notion')!), 'Notion needs no setup');
});

test('the helmet: every app mood wears one of its four moods, and every mood looks different', async () => {
  const art = await import('../web/src/art.ts');
  assert.deepEqual(new Set(art.MOODS.map(art.helmetOf)), new Set(art.HELMET_MODES), 'every helmet mood is reachable');
  assert.deepEqual(new Set((['listen', 'work', 'needs', 'pleased', 'rest'] as const).map(art.helmetOf)), new Set(art.HELMET_MODES), 'every pose lands on the helmet');
  const seen = new Set(art.HELMET_MODES.map((m) => art.helmetText(24, m, true, 9).join('\n')));
  assert.equal(seen.size, 3, 'here and needs-you share characters; the mood lives in the eye colour');
  assert.notEqual(art.helmetText(12, 'here', true, 0).join('\n'), art.helmetText(12, 'here', false, 0).join('\n'), 'day inverts the ramp');
  // Here and needs-you share characters; the mood lives in the eye colour.
  assert.equal(art.helmetText(30, 'here', true, 0).join('\n'), art.helmetText(30, 'needs', true, 0).join('\n'));
  assert.notEqual(art.helmetDots(20, 'here', true, 0).pal.e, art.helmetDots(20, 'needs', true, 0).pal.e);
  assert.ok(art.helmet(24, 'rest', true, 0).flat().some((c) => c.eye && c.ch === '-'), 'rest shuts the eyes');
  assert.ok(!art.helmet(30, 'think', true, 9).flat().some((c) => c.eye), 'think shows no eyes');
  assert.ok(art.helmet(30, 'think', true, 9).flat().some((c) => c.scan), 'think shows the scan');
  const { rows, pal } = art.helmetDots(20, 'needs', true, 0);
  assert.equal(rows.length, 10, 'rows follow the columns');
  assert.ok(rows.every((r) => r.length === 20 && /^[.es1-9]+$/.test(r)), 'dots carry only density steps, eyes and the scan');
  assert.match(pal.e, /0a84ff/i, 'needs-you eyes wear the blue');
  // The helmet must survive the page's own type features: no ligatures, kerning or
  // inherited feature sets, or the day ramp's `-`/`=`/`+` runs set unevenly (PR 343 review).
  const css = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'styles.css'), 'utf8');
  const artRule = (css.match(/\.art\s*\{([^}]*)\}/) ?? [])[1] ?? '';
  assert.match(artRule, /font-variant-ligatures:\s*none/, '.art leaves ligatures off');
  assert.match(artRule, /font-kerning:\s*none/, '.art leaves kerning off');
  assert.match(artRule, /font-feature-settings:\s*normal/, '.art clears inherited feature sets');
});

test('the mascots: every app mood wears one of B1\'s five poses, and every pose of everyone looks different', async () => {
  const art = await import('../web/src/art.ts');
  assert.deepEqual(new Set(art.MOODS.map(art.poseOf)), new Set(art.POSES), 'every pose is reachable');
  const chief = (p: (typeof art.POSES)[number]) => art.chiefSvg(p).replace(/ch\d+c/g, '');
  assert.equal(new Set(art.POSES.map(chief)).size, 5, 'two of Chief\'s poses look the same');
  // A helper's face says done (a tick) or resting (eyes shut); the rest of their status is the helmet's mood and the panel's label.
  for (const k of ['reel', 'scout', 'scribe', 'tracer'] as Kind[]) assert.equal(new Set((['listen', 'pleased', 'rest'] as const).map((p) => art.beanSvg(k, p))).size, 3, k);
  // Each drawing is one SVG whose clip ids never collide on a page with many faces.
  const ids = [art.chiefSvg(), art.chiefSvg()].map((x) => x.match(/id="(\w+)"/)![1]);
  assert.notEqual(ids[0], ids[1]);
  // 159/174: Chief's side shading is the old ellipse's own arc (cx 156 cy 178 rx 30 ry 120), still clipped to his body: the
  // old arc's first third (where it leaves his body over the dome), closed outside the body (x 150, y 240), so it paints
  // what the whole arc did and no part of it measures past his outline or below his feet.
  for (const p of art.POSES) {
    const s = art.chiefSvg(p), m = /<g clip-path="url\(#ch\d+c\)"><path d="M([\d.]+) (\d+)A30 120 0 0 1 ([\d.]+) ([\d.]+)H150V240Z"/.exec(s);
    assert.ok(m && !/ry="120"/.test(s), `${p}: the shading is the bounded arc inside the body clip`);
    const [x1, y1, x2, y2] = m!.slice(1).map(Number), on = (x: number, y: number) => ((x - 156) / 30) ** 2 + ((y - 178) / 120) ** 2;
    assert.ok(Math.abs(on(x1, y1) - 1) < 1e-5 && Math.abs(on(x2, y2) - 1) < 1e-5 && x1 === 130.3144, `${p}: both ends lie on the old ellipse, from its old start`);
    assert.ok(y1 === 240 && (x2 - 100) ** 2 + (y2 - 120) ** 2 > 48 ** 2 && y2 < 120 && /<clipPath id="ch\d+c"><path d="M52 232V/.test(s), `${p}: it leaves the body over the dome and closes outside the clip`);
  }
});

test('the phone mascot set matches art.ts: everyone whole and as a head, in every pose', async () => {
  // scripts/icons.mjs renders the helmet into mobile/assets/pals/ at 3x, required from mobile/src/marks.ts.
  const art = await import('../web/src/art.ts');
  const files = new Map<string, [number, number]>();
  for (const p of art.POSES) for (const who of ['chief', ...Object.keys(art.PALS)]) {
    files.set(`${who}-${p}.png`, who === 'chief' ? [180, 225] : [144, 180]);
    files.set(`head-${who}-${p}.png`, [168, 168]);
  }
  files.set('chief-wave.png', [180, 225]);   // the hero's lifted hat
  const dir = join(import.meta.dirname, '..', 'mobile', 'assets', 'pals');
  assert.deepEqual(new Set(readdirSync(dir).filter((f) => f.endsWith('.png'))), new Set(files.keys()), 'a pose without a picture, or a picture without a pose');
  for (const [f, [w, h]] of files) {
    const b = readFileSync(join(dir, f));
    assert.deepEqual(b.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), `${f} is no PNG`);
    assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [w, h], `${f} is not drawn at 3x`);
  }
  const wired = new Set([...readFileSync(join(import.meta.dirname, '..', 'mobile', 'src', 'marks.ts'), 'utf8')
    .matchAll(/require\('\.\.\/assets\/pals\/([\w-]+\.png)'\)/g)].map((m) => m[1]));
  assert.deepEqual(wired, new Set(files.keys()), 'mobile/src/marks.ts does not require the whole set');
});

test('the phone office: one grouped list, helmets still, the shared view model', () => {
  // The office is a grouped list (Needs you / At work / Done today / Resting), as the web's panels are: every helper
  // in exactly one group, no drawn room, no floor plan, no motion at all (the think-scan shows still while working).
  const office = readFileSync(join(import.meta.dirname, '..', 'mobile', 'src', 'office.tsx'), 'utf8');
  assert.doesNotMatch(office, /floorPlan|Image|PALS\[|motion\.(Hop|Loop|Fly|Pulse|Land|Note|useAwake)/);
  assert.doesNotMatch(office, /setInterval|setTimeout|useBeat|requestAnimationFrame|DesktopView|desktopSignaling|Animated/);
  assert.match(office, /\['needs', 'work', 'done', 'rest'\]/);
  assert.match(office, /TITLES\[g\]/);
  assert.match(office, /A\.office\(state\)/);
  assert.match(office, /A\.officeEvent\(/);
  assert.match(office, /helmetDots\(cols, mode, night, mode === 'think' \? 12 : 0\)/, 'the scan shows still while working, and only there');
  assert.match(office, /export const summaryOf = \(v: A\.OfficeView\): string/, 'one count line from the office view');
  // A question's button wears the ask's own words (its yes, or its flow's label), never a generic one.
  assert.match(office, /const label = !c\.ask \? '' : simple \? yes!\.label : c\.ask\.reply/);
  const appHome = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.match(appHome, /<T style=\{\[s\.serif, \{ fontSize: 28, lineHeight: 32 \}\]\}>Office<\/T>/, 'Office is a slim title, not the greeting');
  assert.match(appHome, /<T tone="ink2" style=\{s\.small\}>{summaryOf\(view\)}<\/T>/, 'then the count line, then the switch');
  const motion = readFileSync(join(import.meta.dirname, '..', 'mobile', 'src', 'motion.ts'), 'utf8');
  assert.doesNotMatch(motion, /Hop|Pulse|Land|Loop|Note|Fly|useOnBeat/, 'no room loops left');
  const home = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  const top = home.slice(home.indexOf('function Home('), home.indexOf('function ChatList('));
  const bar = home.slice(home.indexOf('function HomeBar('), home.indexOf('function NeedsPin('));
  const chatHead = bar.slice(bar.indexOf("if (mode === 'chat')"));
  assert.ok(chatHead.indexOf('<ChiefHero') > 0 && chatHead.indexOf('{tools}') > chatHead.indexOf('<ChiefHero'), 'Chat header: the hero, then gear and switch on one row under it');
  assert.match(top, /hero=\{<><\/>}/, 'the thread carries an empty hero slot (tray lines keep flowing)');
  assert.doesNotMatch(top, /NeedsPin/, 'no pinned card in the conversation; the ask sits inline');
  assert.ok(top.indexOf('<Office') < top.lastIndexOf('{pinned}'), 'Office: Needs you right under the grouped list');
  assert.match(top, /few=\{1\}/, 'one pinned row in Office, and "See all N" for the rest');
  assert.match(top, /if \(mode === 'chat'\) return <View style=\{\{ flex: 1 \}\}>\{top\}<Chat \{\.\.\.ctx\} id="chief" hero=\{/, 'Chat: the header over Chief\'s own thread, and his box');
});

test("Chief's mood is the first matching row of the table, and the line follows the face", () => {
  const min = 60_000, ago = (m: number) => Date.now() - m * min;
  const bot = (id: string, extra: Json = {}) => ({ id, display: id[0].toUpperCase() + id.slice(1), template: id, ...extra });
  const base: Json = { person: { id: 1 }, asks: [], tasks: [], events: [], resting: {}, bots: [bot('chief'), bot('reel'), bot('scout')] };
  const withBots = (...bs: Json[]) => ({ ...base, bots: [bot('chief'), ...bs] });
  const mood = (v: { mood: string }) => v.mood;
  // 9 · nothing applies: content
  assert.equal(A.chief(base).mood, 'idle');
  assert.equal(A.chief(base).line, 'Keeping an eye on things');
  assert.equal(A.chief(base).tone, 'ok');
  // 1 · the computer is asleep, whatever else is true
  const busyHouse = withBots(bot('reel', { task: { id: 1, title: 'A video', state: 'working' } }));
  const off = A.chief(busyHouse, { offline: true });
  assert.deepEqual([off.mood, off.tone, off.line], ['rest', 'off', 'The home computer is asleep']);
  // 2 · listening: the face changes, the line stays
  const work = A.chief(busyHouse);
  assert.deepEqual([work.mood, work.rank], ['work', 7]);
  const listen = A.chief(busyHouse, { listen: true });
  assert.deepEqual([listen.mood, listen.line], ['listen', work.line]);
  // 3 · an unread failure in the last 30 minutes is sad, and said once
  const failed = { ...base, bots: [bot('chief'), bot('reel', { unread: 2 })], events: [{ kind: 'task.failed', bot: 'reel', at: ago(4), data: { title: 'Flights' } }] };
  const sad = A.chief(failed);
  assert.deepEqual([sad.mood, sad.tone, sad.rank], ['error', 'wait', 3]);
  assert.equal(sad.line, "Reel couldn't finish \u201cFlights\u201d");
  assert.equal(A.chief({ ...failed, events: [{ kind: 'task.failed', bot: 'reel', at: ago(31), data: { title: 'Flights' } }] }).mood, 'idle', 'over half an hour old: over it');
  assert.equal(A.chief({ ...failed, bots: [bot('chief'), bot('reel')] }).mood, 'idle', 'read: over it');
  assert.equal(A.chief({ ...failed, events: [{ kind: 'task.unsure', bot: 'reel', at: ago(2), data: { title: 'Booking' } }] }).mood, 'error', 'unsure counts too');
  // 4 · a helper gone quiet, or the sign-in out, is worried — and beats waiting on you
  const worried = A.chief(withBots(bot('reel', { stuck: true, quietSince: ago(6) }), bot('scout', { task: { id: 2, title: 'Flights', state: 'needs_you' } })));
  assert.deepEqual([worried.mood, worried.line], ['worried', 'Reel has gone quiet']);
  assert.equal(A.chief(base, { signedOut: true }).line, 'Waiting for your sign-in');
  // 5 · waiting on you
  const ask = A.chief(withBots(bot('reel', { task: { id: 3, title: 'A video', state: 'needs_you' } })));
  assert.deepEqual([ask.mood, ask.tone, ask.line], ['ask', 'wait', 'Reel needs you']);
  const askCard = A.chief({ ...base, asks: [{ id: 1, bot: 'scout' }] });
  assert.deepEqual([askCard.mood, askCard.line], ['ask', 'Scout needs you']);
  // 6 · fresh finished work is pleased
  const done = { ...base, bots: [bot('chief'), bot('reel', { task: { id: 4, title: 'A video', state: 'working' } }), bot('scout')], events: [{ kind: 'task.done', bot: 'scout', at: ago(2), data: { title: 'Dinners' } }] };
  const pleased = A.chief(done);
  assert.deepEqual([pleased.mood, pleased.line], ['happy', 'Scout finished “Dinners”']);
  assert.equal(A.chief({ ...done, events: [{ kind: 'task.done', bot: 'scout', at: ago(6), data: { title: 'Dinners' } }] }).mood, 'work', 'five minutes gone: back to the work');
  // 7 · on the job, even while the account rests
  const resting = { ...busyHouse, resting: { chatgpt: Date.now() + 30 * min } };
  assert.deepEqual([mood(A.chief(resting)), A.chief(resting).tone], ['work', 'ok']);
  // 8 · the crew rests
  const rest = A.chief({ ...base, resting: { chatgpt: Date.now() + 30 * min } });
  assert.deepEqual([rest.mood, rest.tone], ['rest', 'off']);
  assert.match(rest.line, /resting until/);
  // And the whole ladder, top down: each row beats the one under it.
  const ladder = { ...failed, events: [...failed.events, { kind: 'task.done', bot: 'scout', at: ago(1), data: { title: 'Dinners' } }], bots: [...failed.bots, bot('scout', { stuck: true, quietSince: ago(6), task: { id: 9, title: 'Flights', state: 'needs_you' } })] };
  assert.equal(mood(A.chief(ladder)), 'error', 'sad over worried');
  assert.equal(mood(A.chief({ ...ladder, bots: (ladder.bots as Json[]).map((b) => (b.id === 'reel' ? { ...b, unread: 0 } : b)) })), 'worried', 'worried over ask');
  const askOver = withBots(bot('scout', { task: { id: 5, title: 'Flights', state: 'needs_you' } }), bot('pip', { task: { id: 6, title: 'Week', state: 'working' } }));
  assert.equal(mood(A.chief({ ...askOver, events: [{ kind: 'task.done', bot: 'pip', at: ago(1), data: { title: 'Week' } }] })), 'ask', 'ask over happy');
  assert.equal(mood(A.chief({ ...done, resting: { chatgpt: Date.now() + min } })), 'happy', 'happy over work');
  assert.equal(A.chief({ ...resting, asks: [{ id: 2, bot: 'reel' }] }).rank, 5, 'the rank rides along for the hold');
});

test('helpers wear the same story on their own faces', () => {
  const min = 60_000, ago = (m: number) => Date.now() - m * min;
  const s = { person: { id: 1 }, asks: [], tasks: [{ id: 3, bot: 'scribe', state: 'failed', updated_at: ago(3) }], resting: {}, events: [
    { kind: 'task.failed', bot: 'scribe', at: ago(3), data: { title: 'The note' } },
    { kind: 'task.done', bot: 'scout', at: ago(2), data: { title: 'Flights' } },
  ], bots: [
    { id: 'chief', display: 'Chief' },
    { id: 'scribe', display: 'Scribe', template: 'scribe', unread: 1 },                       // today's failure → sad
    { id: 'reel', display: 'Reel', template: 'reel', task: { id: 1, title: 'A video', state: 'needs_you' } }, // → ask
    { id: 'scout', display: 'Scout', template: 'scout' },                                     // fresh work → happy
    { id: 'pip', display: 'Pip', template: 'scout', stuck: true, quietSince: ago(7) },        // → worried
    { id: 'tracer', display: 'Tracer', template: 'tracer', task: { id: 2, title: 'An email', state: 'working' } }, // → work
    { id: 'muse', display: 'Muse', template: 'reel', pausedUntil: ago(-30) },                 // → rest
    { id: 'ink', display: 'Ink', template: 'reel' },                                          // → idle
  ] } as Json;
  const moodOf = (id: string) => A.crew(s).find((h) => h.id === id)!.mood;
  assert.deepEqual(['scribe', 'reel', 'scout', 'pip', 'tracer', 'muse', 'ink'].map(moodOf), ['error', 'ask', 'happy', 'worried', 'work', 'rest', 'idle']);
  assert.equal(moodOf('scribe') === 'error' && A.crew(s).find((h) => h.id === 'scribe')!.ring, '', 'sad is a face, not a ring');
  // Tracer is visible in the crew; here the mapping is what matters.
});

test('the phone\'s tab icons: whole 9×9 grids of one ink, each its own shape, and no font glyphs in the tab bar', async () => {
  const { TABS } = await import('../web/src/art.ts');
  assert.deepEqual(Object.keys(TABS), ['home', 'crew', 'things', 'routines', 'settings']);
  for (const [k, b] of Object.entries(TABS)) assert.ok(b.length === 9 && b.every((r) => /^[.x]{9}$/.test(r)), k);
  assert.equal(new Set(Object.values(TABS).map((b) => b.join())).size, Object.keys(TABS).length);
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.doesNotMatch(app.slice(app.indexOf('const nav:'), app.indexOf('</View>', app.indexOf('s.tabbar'))), /[⌂☺▤↻▯]/);
});

test('a checkout asks for review first: the yes names the order, an unreadable total sends the person to do it themselves', () => {
  const ask = (detail: Json) => A.card({ id: 11, bot: 'scout', kind: 'permission', at: now, detail }, state);
  const known = ask({ effect: 'spend', words: 'Scout wants to place this order at shop.example: Garlic, 2 kg. Total $43.10.', spends: true,
    preview: { head: 'The order at shop.example', body: 'Garlic, 2 kg — $6.20\nTotal $43.10' }, order: { shown: '$43.10', known: true, dollars: true } });
  assert.equal(known.head, "Review Scout's order");
  assert.ok(known.review, 'the inbox opens the review before any yes');
  assert.deepEqual(known.choices.map((c) => c.label), ['Place order · $43.10', "Don't place order"], 'the yes names the action and the amount');
  assert.deepEqual(known.choices.filter((c) => c.body.answer === 'deny').map((c) => c.label), ["Don't place order"], 'deny says what it does');
  const unknown = ask({ effect: 'spend', words: "Scout wants to act on a checkout page at shop.example. I couldn't read the total on this page.", spends: true,
    order: { shown: '', known: false, dollars: false } });
  assert.equal(unknown.review, true);
  assert.ok(!unknown.choices.some((c) => c.body.answer === 'allow'), 'no yes without a readable total');
  assert.deepEqual(unknown.choices.map((c) => c.label), ["Don't place order", "I'll buy it myself"], 'the safe way out is offered');
  // The un-readable total is said once — in the order's own line — and the note only adds the consequence.
  unknown.preview = { head: 'The order at shop.example', body: 'Garlic, 2 kg \u2014 $6.20\nTotal: couldn\u2019t read it on this page' };
  const sheetLines = unknown.preview.body.split('\n');
  assert.equal(sheetLines.filter((l) => /couldn.t read/.test(l)).length, 1, 'the total is said once');
  // A spend without an order (a paid lookup, the words carry its cap) keeps a direct answer.
  const lookup = ask({ effect: 'spend', words: "Tracer wants to make a paid lookup with Finder, up to $0.50.", spends: true });
  assert.ok(!lookup.review);
  assert.deepEqual(lookup.choices.map((c) => c.label), ['OK, spend it', 'Not now']);
});

test('Settings keeps the person’s Chief address, quiet-hours switch and crew share controls', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.match(src, /<label[^>]*>Chief calls (?:you|\{you \? 'you' : 'them'\})\s*<input[^>]*[\s\S]*?api\.person\([^\n]*\{ address \}/, 'Chief calls you stays editable and saves the address');
  assert.match(src, /<label[^>]*><span[^>]*>Quiet hours[\s\S]*?<input type="checkbox" role="switch"[^\n]*api\.person\([^\n]*\{ quiet:/, 'quiet hours stays a switch that saves the preference');
  assert.match(src, /How much of (?:it|your AI) the crew may use[\s\S]*?onClick=\{[^\n]*api\.person\([^\n]*\{ share:/, 'the person can still set the crew’s share in Settings');
  assert.match(src, /<label[^>]*>Your name\s*<input[^>]*[\s\S]*?api\.person\([^\n]*\{ name \}/, 'the person can rename themselves from the default');
  assert.doesNotMatch(src, /className="tag"|Home setup/, 'no you/owner tags, no household setup words');
});

test('the crew\'s share is words, never a number; money is dollars against your cap', () => {
  for (const s of [{ choice: 'light', used: false }, { choice: 'light', used: true }, { choice: 'full', used: false }]) {
    const v = A.share({ share: s });
    assert.doesNotMatch(shown(v), FORBIDDEN);
    assert.doesNotMatch(v.today, /\d/, 'no counts, no percentages');
  }
  assert.match(A.share({ share: { choice: 'light', used: true } }).today, /start again tomorrow/);
  assert.equal(A.money({}), null, 'an older snapshot without money has no panel');
  assert.equal(A.money({ money: { cap: 20, spent: 0 } })!.month, 'This month: nothing spent yet.');
  assert.equal(A.money({ money: { cap: 20, spent: 4.5 } })!.month, 'This month: $4.50 of $20 spent.');
});

test('reach from anywhere: one plain sentence per relay state, naming only the relay\'s host', () => {
  assert.equal(A.reach({ relay: '', relayStatus: 'off' }).on, false);
  for (const st of ['connecting', 'online', 'offline', 'refused', 'replaced']) {
    const r = A.reach({ relay: 'https://relay.example.com', relayStatus: st });
    assert.ok(r.on && r.words.length > 10, st);
    assert.doesNotMatch(r.words, /https?:|wss?:|\/relay\/v1|undefined/, st);
  }
  assert.equal(A.reach({ relay: 'https://relay.example.com', relayStatus: 'online' }).online, true);
});

test('no jargon anywhere: the machinery\'s words never reach a person', () => {
  // The captain's sweep (CREWHOUSE-APK-04): relay, link, Noise, ticket, grant, host, daemon, crewd, engine, token,
  // port and stub never show in the screens' own words or the adapter's views. Tailscale is the one allowed name,
  // and only in the two places a person is asked to set it up or switch it on (adapter.anywhere/away).
  const JARGON = /\b(relay|noise|tickets?|grants?|daemon|crewd|engine|tokens?|ports?|stub|hosted?|links?|host)\b/i;
  // A literal of all lower-case tokens (class names, import paths, hrefs) is never read as words on a screen.
  const TOKENY = /^[a-z0-9-./:]+( [a-z0-9-./:]+)*$/;
  const prose = (src: string) => {
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' '); // comments are for us
    const lits = [...bare.matchAll(/(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]).filter((l) => !/^https?:/i.test(l.trim()));
    // JSX text: anything between tags that is not an expression fragment (&&, ===, x.y, "?) :" are code, not copy).
    const jsx = [...bare.matchAll(/>([^<>{}\n]{3,})</g)].map((m) => m[1]).filter((t) => !/&&|\?\?|===|\.\w|\)\s*[?:]/.test(t));
    return [...lits, ...jsx].filter((l) => !TOKENY.test(l.trim()));
  };
  const srcDir = join(import.meta.dirname, '..', 'web', 'src');
  for (const f of ['main.tsx', 'parts.tsx', 'flows.tsx', 'office.tsx', 'dialog.ts', 'draft.ts', 'kept.ts', 'chat-md.ts', 'demo.ts', 'adapter.ts'])
    for (const w of prose(readFileSync(join(srcDir, f), 'utf8')))
      assert.doesNotMatch(w, JARGON, `${f} shows: ${w.trim().slice(0, 80)}`);
  for (const f of PHONE_SCREENS) for (const w of prose(readFileSync(f, 'utf8'))) assert.doesNotMatch(w, JARGON, `${f} shows: ${w.trim().slice(0, 80)}`);
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.doesNotMatch(app, /Use a relay code|Relay address|Short relay code|legacy/, 'the phone pairs through one code box; no relay toggle');
  // The adapter is everything a person reads: no view says a machinery word, and Tailscale appears only in the
  // away explainer on the phone — Settings itself never names it.
  const linkView = { on: true, lan: false, pinned: false, tailscale: false, hosts: ['127.0.0.1'], relay: 'https://go.example.com', relayStatus: 'online', push: 'ready', asking: [] };
  const views: Record<string, unknown> = {
    crew: A.crew(state), cards: A.cards(state), chats: A.chats(state), things: A.things(state), ideas: A.ideas(state), jobs: A.jobs(state),
    reach: A.reach(linkView), reached: A.reached({ reached: { home: now, tailscale: now - 9e6, relay: now - 5e6 } }),
    push: A.pushWords(linkView), typed: A.phoneTyped({ short: 'K7M2QX', code: '7KQ4-M2XP-9RTH', relay: 'https://go.example.com' }),
    anywhere: A.anywhere(linkView), away: A.away({ tailnet: true, vpn: true, knock: 'timeout', reached: { tailscale: now - 3.6e6 } }),
    status: A.status(state), crewLine: A.crewLine(state),
    profile: A.profileParts('I run a bakery for local families. My business is called Morning Loaf.'),
    bubble: [null, 'off' as const, { text: 'Friday 3pm www.x.top order', picked: '' }, { text: 'a', picked: 'a' }].flatMap((box) => A.quick({ ...state, connections: [] }, { box })).map(({ label, ask }) => ({ label, ask })),
    canned: [A.canned(state, 'status'), A.canned(state, 'details', '- Vegetarian at home'), A.secretOf('PIN 1234'), A.secretOf('www.x.top')],
  };
  const words = (x: unknown): string => typeof x === 'string' ? x : Array.isArray(x) ? x.map(words).join(' ')
    : x && typeof x === 'object' ? Object.entries(x).filter(([k]) => k !== 'url' && k !== 'at').map(([, v]) => words(v)).join(' ') : '';
  for (const [name, v] of Object.entries(views)) assert.doesNotMatch(words(v), JARGON, name);
  assert.match(words(views.typed), /^K7M2QX-7KQ4-M2XP-9RTH@go\.example\.com$/, 'the typed code is one string, the mailbox carried inside it');
  assert.doesNotMatch(words(views.reach) + words(views.reached) + words(views.push) + words(views.typed) + words(views.anywhere), /tailscale/i, 'Tailscale is named only where it is set up');
  assert.match(words(views.away), /Tailscale/, 'away may name Tailscale');
  // The failure words are people words too: the phone's pairing lines and the toasts on both ends.
  for (const w of ["That code has run out. Show a new one on your computer, then try again.", "That code didn't match. Show a fresh one and try again.",
    "Couldn't reach your computer. Check it's awake, then try again.", "That didn't go through. Check the code, then try again.",
    'That code is missing where to look it up. Copy the whole code from your computer, then try again.',
    "Can't reach the home computer right now. Check it's on, then try again.", 'That didn’t work. Please try again.'])
    assert.doesNotMatch(w, JARGON);
});

test('the status-bar chip: this person\'s jobs only, counts only where a locked phone shows it, and one door to the kit', () => {
  const st = A.status(state)!;
  // Scout's job is working; Reel's waits on Umer. Tracer is busy, but only bot-wide (`live`): not her job, not counted.
  const s2 = { ...state, bots: state.bots.map((b) => (b.id === 'tracer' ? { ...b, live: 'working' } : b)) };
  assert.deepEqual(A.status(s2), st, 'a helper busy on someone else\'s job never shows');
  assert.equal(st.active, true);
  assert.equal(st.title, 'Scout is working', 'names only in the unlocked lines');
  assert.equal(st.publicText, `1 working · ${st.needsYou} need${st.needsYou === 1 ? 's' : ''} you`);
  assert.equal(st.chip, 'Needs');
  assert.deepEqual(st.actions.map((a) => a.id), ['needs', 'ask']);
  assert.deepEqual(A.status(state, false)!.actions, [], 'a watching phone only opens the app');
  const many = (n: number, extra: Json[] = []) => A.status({ ...state, asks: [], bots: [...Array.from({ length: n }, (_, i) => bot(`helper${i}`, { display: `Helper ${i}`, task: { id: i, title: 'Tax return', state: 'working' } })), ...extra] })!;
  assert.equal(many(3).chip, '3 busy');
  assert.equal(many(12).chip, 'Busy');
  assert.equal(many(1, [bot('chief', { task: { id: 99, title: 'Plan dinners', state: 'working' } })]).title, '2 helpers working', 'Chief working on her job counts');
  assert.deepEqual(many(2).actions.map((a) => a.id), ['ask'], 'nothing waiting: no needs action');
  assert.equal(A.status({ ...state, asks: [], bots: [bot('chief'), bot('scout')] }), null, 'a quiet crew clears the chip');
  const waiting = A.status({ ...state, bots: [bot('chief'), bot('reel', { task: { id: 5, title: 'Birthday video', state: 'needs_you' } })] })!;
  assert.equal(waiting.active, false, 'waiting alone is never promoted to the chip');
  for (const v of [st, many(1), many(3), many(12), waiting]) {
    assert.ok([...v.chip].length <= 7, v.chip);
    for (const b of [...state.bots, ...Array.from({ length: 12 }, (_, i) => ({ display: `Helper ${i}` }))]) {
      assert.ok(!`${v.chip} ${v.publicText}`.includes(b.display), `${b.display} on a locked screen`);
    }
    assert.doesNotMatch(shown(v), FORBIDDEN);
    assert.doesNotMatch(`${v.chip} ${v.publicText}`, /[A-Za-z]{2,}.*(Birthday|Tax|Flights|Plan)/, 'no job on the lock screen');
  }
  // The kit is imported in one place, and the app reaches it only through that file.
  const mobile = join(import.meta.dirname, '..', 'mobile');
  const users = [...readdirSync(join(mobile, 'src')).map((f) => join('src', f)), 'App.tsx', 'index.ts'].filter((f) => readFileSync(join(mobile, f), 'utf8').includes('@byokit/statusbar'));
  assert.deepEqual(users, [join('src', 'chip.ts')]);
});

test('Chief on the screen: off until switched on, one door to the overlay kit, and his stills drawn from his bitmap', () => {
  const mobile = join(import.meta.dirname, '..', 'mobile');
  const files = [...readdirSync(join(mobile, 'src')).map((f) => join('src', f)), 'App.tsx', 'index.ts'];
  assert.deepEqual(files.filter((f) => readFileSync(join(mobile, f), 'utf8').includes('@byokit/overlay')), [join('src', 'bubble.ts')]);
  const bubble = readFileSync(join(mobile, 'src', 'bubble.ts'), 'utf8');
  assert.match(bubble, /host: 'window'/, 'the bubble floats in its own window, not the accessibility service');
  assert.doesNotMatch(bubble + readFileSync(join(mobile, 'src', 'panel.tsx'), 'utf8'), /setInterval/, 'no timers');
  // Write it here: the box is read once, on the person's tap, and filled only through the kit; the app's own
  // accessibility service does nothing but hand itself to the kit.
  assert.deepEqual([...bubble.matchAll(/focusedField\.read\(/g)].length, 2, 'on the tap, and Put it in checking it is still that box');
  assert.match(bubble.slice(bubble.indexOf('export async function putIn')), /const now = await focusedField\.read\(\)[\s\S]*const same = !!now && now\.app === was\.app && now\.text === was\.text;[\s\S]*same \? await focusedField\.insert/);
  assert.match(bubble, /overlay\.on\('tap', \(\) => \{\n  box = Promise\.all\(\[focusedField\.available\(\), focusedField\.read\(\)\]\)/);
  const a11y = join(mobile, 'modules', 'crewhouse-net', 'android', 'src', 'main');
  const service = readFileSync(join(a11y, 'java', 'expo', 'modules', 'crewhousenet', 'CrewhouseAccessibilityService.kt'), 'utf8');
  assert.match(service, /override fun onServiceConnected\(\) = ByokitAccessibility\.attach\(this\)/);
  assert.match(service, /override fun onUnbind[\s\S]*?ByokitAccessibility\.detach\(this\)[\s\S]*?override fun onDestroy\(\) \{\n    ByokitAccessibility\.detach\(this\)/, 'let go on unbind and on destroy (the kit\'s README)');
  assert.match(service, /override fun onAccessibilityEvent\(event: AccessibilityEvent\?\) \{\}/, 'it watches nothing itself');
  assert.match(readFileSync(join(a11y, 'res', 'xml', 'crewhouse_accessibility.xml'), 'utf8'), /flagRetrieveInteractiveWindows[\s\S]*canRetrieveWindowContent="true"/);
  assert.match(readFileSync(join(a11y, 'AndroidManifest.xml'), 'utf8'), /CrewhouseAccessibilityService"[\s\S]*BIND_ACCESSIBILITY_SERVICE/);
  // Every mood it can wear is a still the config plugin copies in, and the notification's glyph is there too.
  const app = JSON.parse(readFileSync(join(mobile, 'app.json'), 'utf8'));
  const moods = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === '@byokit/overlay')[1].moods as Record<string, string>;
  for (const m of [...bubble.matchAll(/'(chief_\w+)'/g)].map((x) => x[1]).concat(['idle', 'work', 'ask', 'happy', 'rest', 'worried', 'error'].map((m) => `chief_${m}`)))
    assert.ok(moods[m] && readFileSync(join(mobile, moods[m])).length > 0, m);
  // Hold him to talk: the long press only opens the panel listening; the mic is the panel's Chief box (App.tsx Mic),
  // started there and never from the bubble's window, and what was heard waits in the box until the person sends it.
  assert.match(bubble, /overlay\.on\('longPress', \(\) => \{ void overlay\.openPanel\(\{ listen: '1' \}\); \}\);/);
  const panel = readFileSync(join(mobile, 'src', 'panel.tsx'), 'utf8');
  assert.match(panel, /<Body [^>]*listen=\{!!listen\} \/>/, 'the panel hands the long press to its body');
  assert.match(panel, /<Composer placeholder="Ask Chief anything" onSend=\{toChief\} chat="chief" listen=\{hold\} \/>/);
  assert.match(panel, /useEffect\(\(\) => \{ if \(state && canAct\) setHold\(false\); \}/, 'once per opening: a link blip never starts the mic again');
  assert.match(readFileSync(join(mobile, 'App.tsx'), 'utf8'), /if \(c && listen && shown\.current\) void start\(\);/);
  assert.doesNotMatch(bubble, /hear\(|RECORD_AUDIO/, 'no mic from the bubble itself');
  // The one link is shared: the app, the bubble and its panel each let go of their hold, never hang up on the others.
  assert.doesNotMatch(readFileSync(join(mobile, 'App.tsx'), 'utf8'), /return \(\) => l\.stop\(\)/);
});

test('the chip\'s two doors, and who writes for Write it here', () => {
  assert.deepEqual(A.status(state)!.actions, [{ id: 'needs', label: 'See what needs you' }, { id: 'ask', label: 'Ask Chief' }]);
  assert.deepEqual(A.status(state, false)!.actions, [], 'a watching phone gets no actions');
  // Write it here's writer: Scribe, else the general Helper (whatever it is called), else the Helper the tap hires.
  const s = { ...state, bots: [...state.bots, bot('scribe')] };
  assert.deepEqual(A.writer(s), { id: 'scribe', name: 'Scribe' });
  const none = { ...s, bots: s.bots.filter((b) => b.template !== 'scribe') };
  assert.deepEqual(A.writer(none), { id: '', name: 'Helper' }, 'nobody to write: the tap hires the Helper, never Chief');
  assert.deepEqual(A.writer({ ...none, bots: [...none.bots, bot('pip', { template: 'helper', display: 'Pip' })] }), { id: 'pip', name: 'Pip' });
});

test('suggest for this screen: the rules table picks at most three buttons from what the tap read, no model', () => {
  const s = { ...state, bots: [bot('chief'), bot('scout'), bot('scribe')], asks: [], connections: ['calendar', 'gmail'] };
  const box = (text: string, app = 'com.example.notes', picked = '') => ({ app, text, picked });
  const ids = (b: A.Screen['box'], used?: Record<string, number>) => A.quick(s, { box: b, used }).map((x) => x.id);
  // No box: the kit names the app only with a box in focus (focusedField.read() is null, and @byokit/overlay 0.3.0 has
  // no other foreground-app read in JS), so the two buttons that work on any screen.
  assert.deepEqual(ids(null), ['deal', 'letter']);
  assert.deepEqual(ids('off'), ['write', 'deal', 'letter'], 'the box not readable yet: Write it here explains the switch');
  // Two screens, two different sets: a chat with a date, and a scam text with an address in it.
  assert.deepEqual(ids(box('See you Friday at 3pm?', 'com.whatsapp')), ['write', 'calendar', 'short']);
  assert.deepEqual(ids(box('Your parcel is held: pay £1.99 at https://royalmail-redelivery.top/pay now', 'com.google.android.apps.messaging')), ['write', 'real', 'short']);
  assert.deepEqual(ids(box('Where is my order from last week?', 'com.google.android.gm')), ['write', 'mail', 'short']);
  assert.deepEqual(ids(box('My son starts at Oak Lane School', 'com.example.notes', 'Oak Lane School')), ['write', 'remember', 'lookup']);
  assert.deepEqual(ids(box('hello there')), ['write', 'short', 'lookup'], 'words that fit nothing: the ones that work on any words');
  assert.deepEqual(ids(box('Marco said 5 more minutes', 'com.whatsapp')), ['write', 'short', 'lookup'], 'no date in a name that starts like a month');
  assert.deepEqual(ids(box('Your account is on hold, sign in at hmrc-refund.site', 'com.whatsapp')), ['write', 'real', 'short']);
  assert.deepEqual(ids(box('  ', 'com.whatsapp')), ['write', 'real', 'deal'], 'an empty box in a chat: a still of what was sent');
  assert.deepEqual(ids(box('', 'com.example.notes')), ['write', 'deal', 'letter']);
  for (const b of [null, 'off' as const, box('x'), box('Friday 3pm www.x.top order', 'com.whatsapp', 'Friday'), box('a'.repeat(400))]) assert.ok(A.quick(s, { box: b }).length <= 3);
  // The tap log orders them by what the person picks most in this app; it never adds one or drops one.
  assert.deepEqual(ids(box('See you Friday at 3pm?', 'com.whatsapp'), { short: 4, calendar: 1, deal: 9 }), ['short', 'calendar', 'write']);
  assert.deepEqual(ids(null, { letter: 2 }), ['letter', 'deal']);
  assert.deepEqual(A.quick(s, { box: box('Friday') }, false), [], 'a watching phone gets none');
});

test('the bubble\'s buttons: fixed words to one helper, never Chief, and what needs Google says so', () => {
  const s = { ...state, bots: [bot('chief'), bot('scout'), bot('scribe')], asks: [], connections: ['calendar', 'gmail'] };
  const box = (text: string, picked = '', app = 'com.example.notes') => ({ app, text, picked });
  const by = (b: A.Screen['box'], id: string, st: Json = s) => A.quick(st, { box: b }).find((x) => x.id === id)!;
  const real = by(box('Your parcel is held: pay £1.99 at https://royalmail-redelivery.top/pay now'), 'real');
  assert.deepEqual([real.from, real.to], ['text', { id: 'scout', name: 'Scout' }]);
  assert.equal(real.ask.split('\n')[0], "Is this real? Here's what it says:");
  assert.equal(real.ask.split('\n')[1], '“Your parcel is held: pay £1.99 at hxxps://royalmail-redelivery[.]top/pay now”', 'its addresses defanged, so nothing follows them');
  assert.match(real.ask, /warning signs/, 'signs, never a verdict');
  assert.match(real.ask, /Don't tell me it's safe or a scam, and don't open or look up any web address in it\./, 'and never fetching what it points at');
  assert.match(real.ask, /official app/);
  assert.equal(A.defang('www.bank.co.uk or http://x.top, £1.99'), 'www[.]bank[.]co[.]uk or hxxp://x[.]top, £1.99');
  assert.equal(by(box('Who is Dr Rana Malik, really?', 'Dr Rana Malik'), 'lookup').ask.split('\n')[1], '“Dr Rana Malik”', 'only what was picked');
  assert.match(by(box('Friday 3pm, the dentist'), 'calendar').ask, /^Put this date in my Google Calendar:\n“Friday 3pm, the dentist”\n.*say so instead of guessing/);
  assert.equal(by(box('a long letter'), 'short').ask, 'Give me the short version, in three lines or fewer:\n“a long letter”');
  // Find that email: read-only, on the mail tool, through a helper.
  const mail = by(box('my flight booking to Lahore'), 'mail');
  assert.deepEqual([mail.label, mail.from, mail.to.id], ['Find that email', 'text', 'scout']);
  assert.match(mail.ask, /^Find the email in my Gmail this is about.*Only look: don't change, move, send or delete anything\.\n“my flight booking to Lahore”$/s);
  const still = by(box('', '', 'com.whatsapp'), 'real'), letter = by(null, 'letter'), deal = by(null, 'deal');
  assert.deepEqual([still.from, letter.from, deal.from, deal.ask], ['screen', 'camera', 'screen', ''], 'Deal with this: the person says what to do');
  // A still or a photo opens the share box with words a person would write; how to go about it is sent after, unseen.
  assert.deepEqual([still.ask, letter.ask, deal.brief], ['Is this real?', 'Read this letter for me', '']);
  assert.match(still.brief, /^It's on my phone's screen, in the picture\.\nPoint out the warning signs/);
  assert.deepEqual([by(box('hi'), 'write').from, by(box('hi'), 'write').to], ['box', { id: 'scribe', name: 'Scribe' }]);
  const keep = by(box('Ali is allergic to peanuts', 'allergic to peanuts'), 'remember');
  assert.deepEqual([keep.label, keep.from, keep.ask], ['Remember this', 'keep', 'allergic to peanuts'], 'only what was picked, kept as the person picked it');
  // Plan my day is said, not a button: Scout's own ask, the one its day plan answers.
  const plan = A.planDay(s);
  const scoutDay = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'templates', 'scout', 'bot.json'), 'utf8')).ideas.find((i: Json) => /my day/.test(i.ask)).ask;
  assert.deepEqual([plan.ask, plan.from, plan.to.id], [scoutDay, 'none', 'scout']);
  // What needs Google says so until it is on, and a tap goes to Settings (mobile/src/panel.tsx): the calendar needs
  // Calendar, finding an email Gmail, the day plan both.
  const off = { ...s, connections: [] };
  assert.equal(by(box('Friday 3pm'), 'calendar', off).label, 'Put this date in my calendar · needs Google');
  assert.equal(by(box('the booking'), 'mail', off).label, 'Find that email · needs Google');
  assert.deepEqual(A.planDay({ ...s, connections: ['calendar'] }).needs, ['Google']);
  assert.deepEqual(A.planDay(s).needs, []);
  // No Scout: the general Helper; nobody at all: '' — the tap hires the Helper first. Never Chief.
  assert.deepEqual([...new Set(A.quick({ ...s, bots: [bot('chief'), bot('pip', { template: 'helper', display: 'Pip' })] }, { box: box('Friday') }).map((b) => b.to.id))], ['pip']);
  for (const b of A.quick({ ...s, bots: [bot('chief')] }, { box: null })) assert.deepEqual(b.to, { id: '', name: 'Helper' });
  for (const b of [...A.quick(s, { box: null }), ...A.quick(off, { box: box('Friday 3pm order', 'Friday') }), ...A.quick(s, { box: box('a', '', 'com.whatsapp') }), plan]) {
    assert.doesNotMatch(b.label, FORBIDDEN);
    assert.doesNotMatch(b.ask.replace(/“[^”]*”/g, ''), FORBIDDEN);
  }
  // Every address the panel opens is one App.tsx reads: Settings, and a helper's screen to take the wheel or watch.
  const mobile = join(import.meta.dirname, '..', 'mobile');
  const panel = readFileSync(join(mobile, 'src', 'panel.tsx'), 'utf8'), app = readFileSync(join(mobile, 'App.tsx'), 'utf8');
  const settingsAt = /^crewhouse:\/\/settings\/?$/, screenAt = /^crewhouse:\/\/screen\?bot=([a-z0-9-]+)(&watch=1)?$/;
  assert.ok(app.includes(`${settingsAt}`.slice(1, -1)) && app.includes(`${screenAt}`.slice(1, -1)), 'App.tsx parses exactly these');
  for (const u of ["open('crewhouse://settings')", 'open(`crewhouse://screen?bot=${top.id}`)', 'open(`crewhouse://screen?bot=${top.id}&watch=1`)']) {
    assert.ok(panel.includes(u), u);
    assert.match(u.replace(/^open\(['`]|['`]\)$/g, '').replace('${top.id}', 'scout'), /crewhouse:\/\/settings/.test(u) ? settingsAt : screenAt, u);
  }
  assert.ok(askOf('crewhouse://ask', []) !== undefined, 'Chief\'s chat, where Ask Chief anyway lands');
  assert.match(app, /watchNow=\{screenFirst\}/, 'after taking the wheel the screen opens by itself, as the app\'s own button does');
  // The panel asks the table with the tap's box and the tap log, logs each press (app and button, never words), and
  // shows nothing beside the table's buttons but Chief's box.
  assert.match(panel, /const buttons = A\.quick\(state, \{ box, used \}, canAct\);/);
  assert.match(panel, /logTap\(box && box !== 'off' \? box\.app : '', b\.id\)/);
  assert.doesNotMatch(panel, /A\.bubble\(|more\.map/);
  assert.match(readFileSync(join(mobile, 'src', 'bubble.ts'), 'utf8'), /overlay\.logTap\(\{ app, action \}\)/);
});

test('Remember this: refused on the phone when it looks like a secret, before anything is sent', () => {
  const NO = /PIN, a card number or a code/;
  for (const t of ['PIN 1234', 'my code is 482913', '4111 1111 1111 1111', '4111-1111-1111-1111', 'card 5500005555555559', 'the door is 0451',
    'Your verification number', 'the alarm passcode', 'CVV 123', 'sort code 12-34-56', 'login code: 77 31 09', 'otp 9921',
    'PIN1234', 'Visa4111111111111111', 'door code 2014', 'gate 1999', '١٢٣٤', '１２３４５６', 'acct 12-34-56'])
    assert.match(A.secretOf(t), NO, t);
  for (const t of ['Ali is allergic to peanuts', 'the dress is blue', 'my mobile is 07700 900123', 'call me on +44 7700 900123', 'Flat 4, 221B Baker Street',
    'Zara (9) and Ali (6)', 'school starts 8:45', 'rent is £1,250', 'moved here 12/03/2019', 'trip 2026-10-01'])
    assert.equal(A.secretOf(t), '', t);
  assert.match(A.secretOf('see www.example.com'), /not web or email addresses/);
  assert.match(A.secretOf('write to sam@example.com'), /not web or email addresses/);
  assert.match(A.secretOf('keys are in /home/sam/.ssh/'), /not web or email addresses/);
  // Kept as one plain line of what the whole crew knows, the same shape crewd keeps (`- …`), and Undo takes it back out.
  const notes = '- Vegetarian at home\n';
  assert.deepEqual(A.keep(notes, '  Ali   is allergic\nto peanuts '), { notes: '- Vegetarian at home\n- Ali is allergic to peanuts\n', line: 'Ali is allergic to peanuts' });
  assert.deepEqual(A.keep('', 'Oak Lane School'), { notes: '- Oak Lane School\n', line: 'Oak Lane School' });
  assert.deepEqual(A.keep('# Family\n\n- Wife: Sara\n\n', 'Oak Lane School'), { notes: '# Family\n\n- Wife: Sara\n- Oak Lane School\n', line: 'Oak Lane School' }, 'the person\'s own spacing stays');
  assert.match((A.keep(notes, 'PIN 1234') as { refuse: string }).refuse, NO);
  assert.match((A.keep(notes, 'Vegetarian at home') as { refuse: string }).refuse, /already/);
  assert.match((A.keep('- x'.repeat(499), 'Oak Lane School') as { refuse: string }).refuse, /full/);
  assert.match((A.keep(notes, 'word '.repeat(60)) as { refuse: string }).refuse, /a lot/);
  assert.equal(A.unkeep('- Vegetarian at home\n- Oak Lane School\n- Later\n', 'Oak Lane School'), '- Vegetarian at home\n- Later\n');
  for (const t of ['PIN 1234', 'see www.example.com', 'x'.repeat(201), '']) assert.doesNotMatch(A.secretOf(t) + JSON.stringify(A.keep('', t)), FORBIDDEN);
  // The panel checks before it writes: keep() decides, and only its yes reaches PUT /api/about.
  const panel = readFileSync(join(import.meta.dirname, '..', 'mobile', 'src', 'panel.tsx'), 'utf8');
  assert.match(panel, /const r = A\.keep\([^\n]*\n\s*if \('refuse' in r\) return say\(r\.refuse\);\n\s*await api\.setAbout\(r\.notes\);/);
});

test('Chief\'s box answers who is on what and what the crew knows about you itself, with no model; a day plan is a job', () => {
  for (const t of ["What's everyone doing?", 'what is the crew up to', 'Status', "how's it going", 'who is working?']) assert.equal(A.cannedOf(t), 'status', t);
  for (const t of ['My details', 'what do you know about me?', "what's my address", 'who am I']) assert.equal(A.cannedOf(t), 'details', t);
  for (const t of ['Plan my day', "what's on today", 'plan for today']) assert.equal(A.cannedOf(t), 'plan', t);
  for (const t of ['Book a table for Friday', 'Remember my status at work', 'What is everyone saying about the new phone?', 'Status of my refund?',
    'who is working on the tax return, and can they hurry', 'my details changed: new address is 4 Elm Road', 'plan my day around the dentist at 3'])
    assert.equal(A.cannedOf(t), '', t);
  assert.equal(A.canned(state, 'status'), `${A.crewLine(state)} ${A.homeCounts(state).needs} things need you.`);
  assert.equal(A.canned({ ...state, asks: [], resting: {}, tasks: [], bots: [bot('chief'), bot('scout')] }, 'status'), 'Nobody is on a job right now.');
  assert.equal(A.canned(state, 'details', '- Vegetarian at home\n- Two children: Zara (9) and Ali (6)\n'), "You're Umer.\nWhat the crew knows about you:\n• Vegetarian at home\n• Two children: Zara (9) and Ali (6)");
  assert.match(A.canned(state, 'details', ''), /^You're Umer\.\nThe crew knows nothing else about you yet\./);
  for (const k of ['status', 'details'] as const) assert.doesNotMatch(A.canned(state, k, '- See files/x.md'), FORBIDDEN);
  const panel = readFileSync(join(import.meta.dirname, '..', 'mobile', 'src', 'panel.tsx'), 'utf8');
  assert.match(panel, /const kind = photos\.length \? '' : A\.cannedOf\(text\);\n.*\n\s*if \(kind === 'plan' && !plan\.needs\.length\) return press\(plan\)/);
});

test('who is on what: one plain line from state alone, resting included, no model', () => {
  assert.equal(A.crewLine(state), `Reel needs you. Scout is on “Flights”. The crew is resting until ${A.clock(now + 3600_000)}.`);
  const st = { ...state, resting: {}, bots: [bot('chief', { task: { id: 9, title: 'Plan dinners', state: 'working' } }), bot('scout', { task: { id: 6, title: 'Flights', state: 'working' }, controls: 'person' }),
    bot('scribe', { task: { id: 7, title: 'Post', state: 'working' }, stuck: true, quietSince: now - 9 * 60_000 }), bot('reel', { pausedUntil: now + 600_000 }), bot('tracer')] };
  assert.equal(A.crewLine(st), `Chief is on “Plan dinners”. Scout waits while you drive. Scribe has gone quiet. Reel is waiting until ${A.clock(now + 600_000)}.`);
  assert.equal(A.crewLine(st, true), `Chief is working. Scout waits while you drive. Scribe has gone quiet. Reel is waiting until ${A.clock(now + 600_000)}.`, 'over other apps: no job\'s words');
  assert.equal(A.crewLine({ ...st, bots: [bot('chief'), bot('tracer')] }), '', 'a quiet crew says nothing (Chief\'s own line stands)');
  assert.equal(A.crewLine({ ...st, bots: [bot('chief'), bot('reel', { pausedUntil: now + 600_000, queued: 1 })] }), `Reel is waiting until ${A.clock(now + 600_000)}.`, 'a held job behind a queued one: waiting, nobody working yet');
  assert.doesNotMatch(A.crewLine(state), FORBIDDEN);
});

test('Write it here: the writer is asked in plain words, and its draft is the job\'s own reply', () => {
  const tail = 'as plain text: no file, no notes.', decide = 'Don\'t ask me anything first: decide what fits and write it.';
  assert.equal(A.writeAsk(' say no politely, offer Thursday ', { text: 'Hi Sara,\n', picked: '' }),
    `Write it here: say no politely, offer Thursday\nThat's for the text box I'm typing in on my phone. It says so far: “Hi Sara,”\n${decide}\nReply with only what the whole box should say, keeping what I wrote where it fits, ${tail}`);
  assert.equal(A.writeAsk('a thank-you note', { text: '  ', picked: '' }, 'Thanks!'),
    `Write it here: a thank-you note\nThat's for the text box I'm typing in on my phone.\nNot this one: “Thanks!”\n${decide}\nReply with only what the whole box should say, ${tail}`, 'an empty box says nothing; Try again names the one passed on');
  assert.equal(A.writeAsk('make it warmer', { text: 'Dear Sam, no. Best, Umer', picked: 'no.' }),
    `Write it here: make it warmer\nThat's for the part I picked in a text box I'm typing in on my phone: “no.”. The whole box says: “Dear Sam, no. Best, Umer”\n${decide}\nReply with only the words to put in place of the part I picked, ${tail}`, 'a picked part is all that changes');
  const page = (state: string, result?: string) => ({ tasks: [{ id: 7, state, ...(result === undefined ? {} : { result }) }, { id: 6, state: 'done', result: 'older' }],
    messages: [{ task_id: 7, author: 'person', text: 'ask' }, { task_id: 7, author: 'bot', text: 'Sorry, Thursday works better.' }] });
  assert.equal(A.draftOf(page('working'), 7), null, 'still writing');
  assert.equal(A.draftOf(page('queued'), 7), null);
  assert.equal(A.draftOf(page('done', ' Sorry, Thursday? '), 7), 'Sorry, Thursday?');
  assert.equal(A.draftOf(page('done', 'Done.'), 7), '', 'an empty reply is not a draft to put in');
  assert.equal(A.draftOf(page('failed', 'boom'), 7), '', 'it couldn\'t: nothing to put in');
  assert.equal(A.draftOf(page('unsure'), 7), '');
  assert.equal(A.draftOf({ tasks: [] }, 7), null);
  assert.equal(A.waitOf(page('working'), 7), '', 'writing: nothing to wait for');
  assert.equal(A.waitOf(page('paused', 'Waiting for you to sign in with ChatGPT.'), 7), 'Waiting for you to sign in with ChatGPT.', 'a paused job says why, never "writing" forever');
  assert.equal(A.waitOf(page('needs_you'), 7), 'It needs your OK first.');
  assert.equal(A.draftOf(page('paused'), 7), null);
  for (const w of ['Write it here', 'What should it say?', 'Let Chief see the box you\'re typing in', 'Put it in', 'Try again', 'Not now', 'Copied: hold the box and paste'])
    assert.doesNotMatch(w, FORBIDDEN);
});

test('Write it here on Reddit or in a Hacker News reader: labelled notes to write from, and Copy instead of Put it in', () => {
  const s = { ...state, bots: [bot('chief'), bot('scribe')], asks: [] };
  const write = (app: string, text = 'Great writeup, but', picked = '') => {
    const box = { app, text, picked }, b = A.quick(s, { box }).find((x) => x.id === 'write')!;
    return { label: b.label, put: b.put, ask: A.writeAsk('agree, add the caching numbers', box) };
  };
  for (const [app, on] of [['com.reddit.frontpage', 'Reddit'], ['com.simon.harmonichackernews', 'Hacker News'], ['io.github.hidroh.materialistic', 'Hacker News']]) {
    const w = write(app);
    assert.deepEqual([w.label, w.put], ['Write it here', 'Copy'], app);
    assert.match(w.ask, new RegExp(`^Write it here: agree, add the caching numbers\nThat's for the text box I'm typing in on my phone\. It says so far: “Great writeup, but”\n`), app);
    assert.match(w.ask.split('\n').at(-1)!, new RegExp(`^It's a reply on ${on}, where people want my own words, so don't write the reply\. Reply with short labelled notes .*\(Point:, Why:, Example:\)`), app);
    assert.match(write(app, 'Great writeup', 'writeup').ask, /labelled notes/, 'a picked part gets notes too');
    assert.doesNotMatch(w.ask, FORBIDDEN);
  }
  for (const app of ['com.twitter.android', 'com.linkedin.android', 'com.whatsapp', '']) {
    const w = write(app);
    assert.equal(w.put, 'Put it in', app);
    assert.match(w.ask, /\nReply with only what the whole box should say, keeping what I wrote where it fits, as plain text: no file, no notes\.$/, app);
  }
  // The panel offers what the button says: Copy puts the notes on the clipboard (nothing goes in the box, nothing is
  // sent), and the bubble says how to paste.
  const mobile = join(import.meta.dirname, '..', 'mobile');
  assert.match(readFileSync(join(mobile, 'src', 'panel.tsx'), 'utf8'), /A\.notesOn\(box\.app\) \? <Btn go label="Copy" onPress=\{\(\) => void copyOut\(draft\)\} \/>\n\s*: <Btn go label="Put it in"/);
  assert.match(readFileSync(join(mobile, 'src', 'bubble.ts'), 'utf8'), /export async function copyOut\(text: string\) \{\n  Clipboard\.setString\(text\);\n  await overlay\.closePanel\(\);/);
  assert.doesNotMatch('Copy', FORBIDDEN);
});

test('the iPhone\'s Live Activity: the chip\'s own status, counts only until unlocked, started by work and ended by quiet', async () => {
  // Built for real from mobile/src/island.ios.tsx, with expo-widgets and @expo/ui swapped for a recorder.
  const stubs: Plugin = { name: 'stubs', setup(b) {
    b.onResolve({ filter: /^(@expo\/ui|expo-widgets)/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: {
      '@expo/ui/swift-ui': "export const [HStack, Image, Link, Text, VStack] = ['HStack', 'Image', 'Link', 'Text', 'VStack'];",
      '@expo/ui/swift-ui/modifiers': 'const m = (n) => (x) => ({ [n]: x }); export const font = m("font"), minimumScaleFactor = m("scale"), opacity = m("opacity"), padding = m("padding");',
      'expo-widgets': `export const createLiveActivity = (name, layout) => (globalThis.activity = { name, layout, on: [], getInstances() { return [...this.on]; },
        start(s, url, stale) { const a = { s, stale, update: async (s, stale) => Object.assign(a, { s, stale }), end: async () => void this.on.splice(this.on.indexOf(a), 1) }; this.on.push(a); return a; } });`,
    }[a.path] }));
  } };
  const dir = mkdtempSync(join(process.cwd(), 'test/.island-'));
  try {
    await build({ entryPoints: [join(import.meta.dirname, '..', 'mobile', 'src', 'island.ios.tsx')], outfile: join(dir, 'island.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react'], plugins: [stubs], logLevel: 'error' });
    const { island } = await import(join(dir, 'island.mjs'));
    const la = (globalThis as any).activity;
    const words = (n: any): string => typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(words).filter(Boolean).join(' ')
      : n?.props ? [n.props.label, n.props.destination, words(n.props.children)].filter(Boolean).join(' ') : '';
    const st = A.status(state)!; // Scout's job is working; Reel's waits on Umer
    const view = la.layout(st, { colorScheme: 'light' });
    for (const k of ['banner', 'compactLeading', 'compactTrailing', 'minimal']) {
      for (const b of state.bots) assert.ok(!words(view[k]).includes(b.display), `${b.display} where a locked phone shows it (${k})`);
    }
    assert.equal(words(view.banner), st.publicText, 'the Lock Screen: counts only');
    assert.equal(words(view.minimal), st.chip);
    assert.equal(words(view.compactTrailing), st.chip);
    assert.equal(words(view.expandedCenter), `${st.title} ${st.text}`, 'names only in the expanded island');
    assert.deepEqual(view.expandedBottom.props.children.map((l: any) => [l.props.label, l.props.destination]),
      [['See what needs you', 'crewhouse://needs'], ['Ask Chief', 'crewhouse://ask']], 'its buttons open the addresses the app already takes');
    assert.deepEqual(la.layout(A.status(state, false), { colorScheme: 'light' }).expandedBottom.props.children, [], 'a watching phone gets no buttons');
    assert.deepEqual(la.layout(st, { colorScheme: 'light', isStale: true }).banner.props.modifiers.at(-1), { opacity: 0.5 }, 'out of date, it says so by fading');

    const waiting = A.status({ ...state, bots: [bot('chief'), bot('reel', { task: { id: 5, title: 'Birthday video', state: 'needs_you' } })] });
    island(waiting);
    assert.equal(la.on.length, 0, 'something waiting alone never starts one: that is the push\'s job');
    const t = Date.now();
    island(st);
    assert.equal(la.on.length, 1, 'a working job starts it');
    assert.ok(Math.abs(la.on[0].stale - t - 15 * 60_000) < 5000, 'marked out of date 15 minutes after the last refresh');
    island(st);
    assert.equal(la.on.length, 1, 'a refresh updates the one there is');
    island(waiting);
    assert.equal(la.on[0].s, waiting, 'the job done but something still waiting: it stays, and says so');
    island(null);
    assert.equal(la.on.length, 0, 'a quiet crew, or an app out of touch, ends it');
    island(st);
    la.on.length = 0; // the person swipes it away
    island(st);
    assert.equal(la.on.length, 0, 'swiped away, it stays away while the same work goes on');
    island(waiting); island(st);
    assert.equal(la.on.length, 1, 'new work starts a new one');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // expo-widgets and @expo/ui are imported in one place; the app shows the chip's own status there, local updates only.
  const mobile = join(import.meta.dirname, '..', 'mobile');
  const users = [...readdirSync(join(mobile, 'src')).map((f) => join('src', f)), 'App.tsx', 'index.ts'].filter((f) => /'(expo-widgets|@expo\/ui)/.test(readFileSync(join(mobile, f), 'utf8')));
  assert.deepEqual(users, [join('src', 'island.ios.tsx')], 'Android loads island.tsx, where neither is linked');
  // Metro tries every platform's .ts before any .tsx: a stand-in with another extension would win on the iPhone too.
  assert.deepEqual(readdirSync(join(mobile, 'src')).filter((f) => f.startsWith('island.')).sort(), ['island.ios.tsx', 'island.tsx']);
  assert.match(readFileSync(join(mobile, 'App.tsx'), 'utf8'), /\{ chip\(s\); island\(s\); \}/);
  assert.ok(JSON.parse(readFileSync(join(mobile, 'app.json'), 'utf8')).expo.plugins.includes('expo-widgets'), 'no push settings: nothing but the app updates it');
});

test('the phone\'s one code box reads either kind by its shape, and rejects what it cannot dial', () => {
  assert.equal(readTyped('23456-789ABCDE-FGHJKMNPQR-S023456-789ABCDE-FGHJKMN').kind, 'direct', 'the long letter envelope, case and dashes aside');
  assert.equal(readTyped('xxxxx-'.repeat(20)).kind, 'direct');
  assert.deepEqual(readTyped('k7m2qx 7kq4 m2xp 9rth @ go.example.com'), { kind: 'relay', short: 'K7M2QX', code: '7KQ4M2XP9RTH', base: 'https://go.example.com' });
  assert.deepEqual(readTyped('K7M2QX-7KQ4-M2XP-9RTH@https://go.example.com'), { kind: 'relay', short: 'K7M2QX', code: '7KQ4M2XP9RTH', base: 'https://go.example.com' });
  assert.equal(readTyped('7KQ4-M2XP-9RTH').kind, 'unknown', 'a code that names no relay has nowhere to dial');
  assert.equal(readTyped('K7M2QX-7KQ4-M2XP-9RTH@example').kind, 'unknown', 'no address to look it up');
  assert.equal(readTyped('K7M2QX-7KQ4@go.example.com').kind, 'unknown', 'half the codes is not a code');
  assert.equal(readTyped('').kind, 'unknown');
});

test('reach it from anywhere: three plain states and numbered steps, and the phone says which step is missing', () => {
  // Whatever crewd sends, no address, port, command or network jargon reaches a screen.
  const TECH = /\d+\.\d+|:\d{2,5}\b|ws:|https?:|\b100\.x\b|tailscale (up|serve|funnel|status)|\bserve\b|\bfunnel\b|port|\bIP\b|undefined/i;
  const home = A.anywhere({ anywhere: 'home', hosts: ['127.0.0.1', '100.101.2.3'], tailscale: false });
  assert.equal(home.state, 'home');
  assert.match(home.words, /^Only at home\./);
  assert.deepEqual(home.steps.map((x) => x.split(' ').slice(0, 2).join(' ')), ['On this', 'On your', 'Then pair']);
  const anywhere = A.anywhere({ anywhere: 'anywhere', hosts: ['100.101.2.3'] });
  assert.match(anywhere.words, /^Reachable away from home\./);
  assert.equal(anywhere.steps.length, 2, 'this computer is done; the steps for your phone stay');
  const signin = A.anywhere({ anywhere: 'signin' });
  assert.match(signin.words, /^The connector app needs signing in again/);
  assert.equal(A.anywhere(null).state, 'home');
  for (const x of [home, anywhere, signin]) assert.doesNotMatch(shown(x), TECH);
  assert.match(home.steps[1], /your phone.*same Google account/, 'your phone uses your own account');
  assert.match(home.steps[1], /or share this computer with that phone's account in the app/, 'another account remains supported');
  assert.doesNotMatch(shown(home), /invite/i);

  const away = [
    A.away({ home: true, tailnet: true, vpn: true }),
    A.away({ home: false, tailnet: false }),
    A.away({ tailnet: true, vpn: false }),
    A.away({ tailnet: true, vpn: true, anywhere: 'signin' }),
    A.away({ tailnet: true, vpn: true, anywhere: 'anywhere', knock: 'timeout' }),
    A.away({ tailnet: true, vpn: true, knock: 'refused' }),
    A.away({ tailnet: true, vpn: true, knock: 'answers' }),
    A.away({ tailnet: true, vpn: true, knock: 'timeout', peer: false }),
    A.away({ tailnet: true, vpn: true, knock: 'timeout', reached: { tailscale: Date.now() - 3_600_000 } }),
    A.away({ home: true, knock: 'refused' }),
    A.away({ home: true, knock: 'answers' }),
  ];
  assert.match(away[0], /on the home Wi-Fi, but the home computer doesn't answer at all/);
  assert.match(away[1], /same account.*or share this computer/);
  assert.match(away[2], /Tailscale is off on this phone/);
  assert.match(away[3], /needs signing in again/);
  // No answer over Tailscale and nothing else known: never one cheerful guess, but both causes and who checks them.
  assert.match(away[4], /Either the computer is asleep or off, or it hasn't been shared with this phone's Tailscale account/);
  assert.match(away[4], /check both/);
  assert.match(away[5], /answers over Tailscale, but Crewhouse isn't running/, 'refused: the computer is there');
  assert.match(away[6], /getting back in touch/);
  assert.match(away[7], /isn't shared with this phone's Tailscale account: it checked/, 'the computer\'s own Tailscale said so');
  assert.match(away[8], /reached it that way before .*so sharing works/, 'sharing proven, so only then the likely cause');
  assert.match(away[9], /Either Crewhouse isn't running on it, or its setting for phones on this Wi-Fi is off/);
  assert.match(away[10], /getting back in touch/);
  assert.equal(new Set(away).size, away.length);
  for (const w of away) assert.doesNotMatch(w, /may be asleep or switched off\.$/, 'the old single guess is gone');
  for (const w of away) assert.doesNotMatch(w.replace(/\d{1,2}:\d{2}(\s?[ap]m)?/gi, ''), TECH); // a clock time is not a port
});

test('a knock on the computer\'s address ends within its bound: answers, refused, or timed out', async () => {
  const { createServer } = await import('node:net');
  const { createServer: web } = await import('node:http');
  const listen = (s: any) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
  const up = web((_q, res) => res.writeHead(404).end());
  const silent = createServer(() => {}); // takes the connection, never answers: like a peer that drops the packets
  const closed = createServer();
  const [a, b, c] = [await listen(up), await listen(silent), await listen(closed)];
  await new Promise((r) => closed.close(r));
  try {
    assert.equal(await A.knock(`ws://127.0.0.1:${a}/link`, 1500), 'answers');
    assert.equal(await A.knock(`ws://127.0.0.1:${c}/link`, 1500), 'refused');
    const t0 = Date.now();
    assert.equal(await A.knock(`ws://127.0.0.1:${b}/link`, 600), 'timeout');
    assert.ok(Date.now() - t0 < 1500, 'no spinner without an end');
  } finally { up.closeAllConnections(); up.close(); silent.close(); }
});

test('Settings, Phones: when each phone last reached the computer and how, and missing notifications said once', () => {
  assert.equal(A.reached({}), 'Not in touch yet');
  assert.match(A.reached({ reached: { home: Date.now() } }), /^Last reached it .* on the home Wi-Fi · never from away yet$/);
  assert.match(A.reached({ reached: { home: Date.now() - 9e6, tailscale: Date.now() } }), /away from home$/);
  assert.match(A.reached({ reached: { tailscale: Date.now() - 9e6, home: Date.now() } }), /on the home Wi-Fi$/, 'the latest route, with away proven');
  assert.equal(A.pushWords({ push: 'ready' }), '');
  assert.match(A.pushWords({ push: 'missing' }), /^Phone notifications aren't switched on for this app yet/);
});

test('watches and hand-offs read as plain words, with only the page\'s host', () => {
  const s = { routines: [{ id: 1, bot: 'scout', name: 'Watch rentals.example.com', words: 'Every hour', next_at: Date.now() + 1000, state: 'on', kind: 'task', quiet: 1,
    watch: 'https://www.rentals.example.com/phuket?max=900&sort=new', history: [{ at: Date.now(), kind: 'routine.fired', watch: 'same' }, { at: Date.now() - 9e5, kind: 'routine.fired', watch: 'changed', task: 3 }] }] };
  const [r] = A.routines(s);
  assert.equal(r.watching, 'rentals.example.com');
  assert.match(r.last, /^Checked .*, no change$/);
  assert.equal(r.changes, 1);
  assert.doesNotMatch(shown(r), /phuket\?|https?:/);
  const [l] = A.lines({ messages: [{ id: 1, author: 'reel', text: 'find three songs' }] }, 'scout');
  assert.deepEqual([l.from, l.text], ['note', 'Reel asked: find three songs']);
});

test('Chief\'s hand-off in a helper chat is one short ask with the whole words behind Show details; teasers carry no markdown marks', () => {
  const [l] = A.lines({ messages: [{ id: 1, author: 'chief', task_id: 9, title: 'Plan the week\'s dinners',
    text: 'The person says: plan dinners for four. Done means: a plan document with seven meals and one shopping list.' }] }, 'scribe');
  assert.equal(l.from, 'chief');
  assert.equal(l.text, 'From Chief: Plan the week\'s dinners', 'the ask, not the assignment prose');
  assert.match(l.detail!, /Done means/);
  const [g] = A.lines({ messages: [{ id: 4, author: 'chief', title: 'The person\'s words verbatim: "help me chase a refund for the stroller"',
    text: 'The person\'s words verbatim: "help me chase a refund for the stroller"' }] }, 'scribe');
  assert.equal(g.text, 'From Chief: help me chase a refund for the stroller', 'a label an older hand-off wrapped the ask in never reaches the person');
  const [f] = A.lines({ messages: [{ id: 2, author: 'chief', text: 'First line stands in\nwhen no title came with it' }] }, 'scribe');
  assert.equal(f.text, 'From Chief: First line stands in');
  assert.equal(A.lines({ messages: [{ id: 3, author: 'person', text: 'hello there' }] }, 'chief')[0].detail, undefined, 'Chief\'s own thread keeps whole lines');
  // Teasers: a Things row and a chat list line read as words, never raw ** emphasis.
  assert.equal(A.teaser('The **dinner plan** is ready — see *the timing*'), 'The dinner plan is ready — see the timing');
  assert.equal(A.things({ tasks: [{ id: 1, bot: 'scribe', state: 'done', title: 'Dinners', updated_at: now, result: 'A **complete** plan' }] })[0].summary, 'A complete plan');
  // What the phone opens itself: the parsed files the web shows — documents, pages, sheets, videos — nothing else.
  for (const [path, readable] of [['files/plan.docx', true], ['files/plan.md', true], ['files/plan.txt', true], ['files/plan.xlsx', true], ['files/demo.mp4', true], ['files/demo.mov', true], ['files/scan.pdf', false], ['files/photo.png', false]] as const) {
    assert.equal(A.phoneReadable(A.fileView('scribe', path)), readable, path);
  }
});

test('a routine offered by Chief is a confirmation card: lines, Start it / Not now, the schedule words to edit, and the zone named only away from home', () => {
  const s = { bots: [{ id: 'chief', display: 'Chief' }], asks: [{ id: 1, bot: 'chief', kind: 'propose', at: now, title: 'Every weekday at 8:00 am, Pip will plan the week\'s dinners.', detail: {
    words: 'Every weekday at 8:00 am, Pip will plan the week\'s dinners.',
    routine: { bot: 'pip', schedule: 'weekdays 8am', task: "Plan the week's dinners" },
    preview: { head: 'A new routine', body: 'Every weekday at 8:00 am\nPip will plan the week\'s dinners\nTells you each time it runs\nFirst time: Sat 8:00 am' } } }] };
  const c = A.card(s.asks[0], s);
  assert.equal(c.kind, 'routine');
  assert.deepEqual(c.lines, ['Every weekday at 8:00 am', 'Pip will plan the week\'s dinners', 'Tells you each time it runs', 'First time: Sat 8:00 am']);
  assert.deepEqual(c.choices.map((x: any) => x.label), ['Start it', 'Not now']);
  assert.equal(c.schedule, 'weekdays 8am', 'the words the person edits when they tap Change time');
  assert.equal(c.zoneNote, '', 'same zone, no time-zone talk');
  const away = { ...s, zone: 'Asia/Karachi' };
  const [line, note] = [A.card(away.asks[0], away).lines!.at(-1), A.zoneNote(away)];
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Karachi') { assert.equal(note, ''); }
  else { assert.match(note, /^Times follow the home computer's clock \(Asia\/Karachi\)\.$/); assert.equal(line, note); }
  // Stays off Home like every suggestion, and the last run links out.
  assert.equal(A.needsYou(s).length, 0);
  const rs = { routines: [{ id: 2, bot: 'reel', name: 'Weekly demo', words: 'Every Monday at 9:00', next_at: now, state: 'on', kind: 'task',
    history: [{ at: now, kind: 'routine.fired', state: 'done', task: 7, thing: 7, msg: 21 }] }] };
  assert.deepEqual(A.routines(rs)[0].result, { thing: 7 }, 'the last run opens the thing it made');
  const said = { routines: [{ ...rs.routines[0], history: [{ at: now, kind: 'routine.fired', state: 'done', task: 7, msg: 21 }] }] };
  assert.deepEqual(A.routines(said)[0].result, { msg: 21 }, 'or lands on its line in the helper\'s chat');
  const skipped = { routines: [{ ...rs.routines[0], history: [{ at: now, kind: 'routine.skipped', why: 'overlap' }] }] };
  assert.equal(A.routines(skipped)[0].result, null, 'a skipped run has no result to see');
});

test('Chief-learned memories can be undone from his own page: the same trail, the same endpoint', async () => {
  // The Every-step view admits Chief (he has no card in the crew list), and his own page links to it.
  const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.match(src, /!h && id !== 'chief'/);
  assert.match(src, /'#\/h\/chief\/did'/);
  // The trail shows a learned line with its Undo, and that undo posts where the helpers' trail posts.
  const steps = A.steps([{ seq: 3, at: now, kind: 'memory.learned', bot: 'chief', data: { task: 2, text: 'Umer does not eat pork.' } }]);
  assert.deepEqual(steps.map((s) => [s.undo, s.seq]), [[true, 3]]);
  const calls: string[] = [];
  setTransport((method, path) => { calls.push(`${method} ${path}`); return Promise.resolve({ ok: true }); });
  await api.undoMemory('chief', 3);
  assert.deepEqual(calls, ['POST /api/bots/chief/memory/3/undo']);
});

test('no raw heading markers reach the ask card or its Read-all view', () => {
  const s = { bots: [{ id: 'chief', display: 'Chief' }, { id: 'scout', display: 'Scout' }], asks: [] };
  const offered = A.card({ id: 10, bot: 'scout', kind: 'propose', at: now,
    detail: { words: 'Scout has an idea', preview: { head: 'How Scout would do it', body: '### Step one\nPick the pages' } } }, s);
  assert.ok(!offered.preview!.body.includes('#'), offered.preview!.body);
  // The .8 smoke leak (CREWHOUSE-APK-20): a draft with SEVERAL headings kept every ### but the first, because the
  // strip ran after noTools had folded the blank lines away, so only the opening heading still sat at a line start.
  const draft = ['### Trip plan', '', '### Costs', '', 'Hotel for two nights', 'Train tickets there and back', '', '### Next step', '',
    'Say the word and I book the morning train.'].join('\n');
  const leak = A.card({ id: 11, bot: 'scout', kind: 'propose', at: now,
    detail: { words: 'Scout drafted something for the trip thread. Nothing is sent: you post it yourself.',
      preview: { head: 'Draft for the trip thread', body: draft } } }, s);
  assert.doesNotMatch(leak.preview!.body, /#{1,6}\s/, leak.preview!.body);
  assert.match(leak.preview!.body, /^Trip plan Costs Hotel/);
  // Variation without blank lines: every heading still strips, however many.
  assert.ok(!A.plain('### Plan\n### Costs\nHotel\n### Next\nGo').includes('#'));
  // A hash that is not a heading is content and stays: only line-start heading markers go, never inline ones.
  assert.match(A.plain('Tag it # Fun Friday, see issue C-###-12, topic #fun'), /# Fun Friday, see issue C-###-12, topic #fun/);
  // An account name in crewd's own account sentences keeps its name; engines and models still scrub.
  assert.equal(A.plain('Claude signed you out. That happens after a password change.'), 'Claude signed you out. That happens after a password change.');
  assert.equal(A.plain('The crew uses your Claude account. Sign in when you are ready.'), 'The crew uses your Claude account. Sign in when you are ready.');
  assert.equal(A.plain('I will start the moment you sign in with Claude.'), 'I will start the moment you sign in with Claude.');
  assert.equal(A.plain("Your Claude plan doesn't include helpers yet."), "Your Claude plan doesn't include helpers yet.");
  assert.equal(A.plain('Stopped on an error from claude: 529 overloaded'), 'Stopped on an error from the crew: 529 overloaded');
  assert.equal(A.plain('Done! I ran it with Claude Code.'), 'Done! I ran it with the crew.');
  // The phone sheet renders this same view model verbatim (mobile/App.tsx), so the web assertion is the phone's too.
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.match(app, /\{c\.preview\.body\}/);
});

test('not sure it worked stands apart: in the chat, in Chief\'s thread and in the trail', () => {
  const ls = A.lines({ messages: [{ id: 1, author: 'bot', text: 'Booked it.' }, { id: 2, author: 'bot', text: "Not sure it worked: I pressed Book, but saw no confirmation." },
    { id: 3, author: 'bot', text: "Pip isn't sure “Book the dentist” worked. Worth checking your email." }] }, 'pip');
  assert.deepEqual(ls.map((l) => !!l.unsure), [false, true, true]);
  assert.equal(A.step({ kind: 'task.unsure', data: { title: 'Book the dentist' } }), 'Not sure “Book the dentist” worked');
});

test('a thread never shows a tool call or raw JSON, whoever typed it', () => {
  const ls = A.lines({ messages: [
    { id: 1, author: 'person', text: 'set up the weekly demo [tool crew_routine {"bot":"reel","when":"every Friday 17:00"}]' },
    { id: 2, author: 'bot', text: 'I could do that {"asked":true,"note":"carry on"} — shall I?' },
    { id: 3, author: 'system', text: 'stub chief: crew_routine said {"asked":true,"note":"the person sees a card"}' },
  ] }, 'chief');
  for (const l of ls) assert.doesNotMatch(l.text, /\[tool|\{"|crew_[a-z_]+/);
  assert.equal(ls[0].text, 'set up the weekly demo', 'the person\'s words stay, the machinery goes');
  assert.equal(ls[1].text, 'I could do that — shall I?');
});

test('inline code stays visible in a chat answer: flags keep their names and their bullets', () => {
  // The helper's own words, as the stub engine saved them: two bullets naming --branch and --web.
  const producer = '- `--branch`: View a specific repository branch.\n- `--web`: Open the repository in a web browser.';
  const [line] = A.lines({ messages: [{ id: 150, author: 'bot', text: producer }] }, 'scout');
  assert.equal(line.text, producer, 'the answer reads as written, never scrubbed');
  // What the bubble renders: one list, two items, each keeping its flag name as code.
  const lists = chatTokens(line.text).filter((t: any) => t.type === 'list') as any[];
  assert.equal(lists.length, 1, 'the bullets still render as one list');
  const [list] = lists;
  assert.equal(list.items.length, 2, 'both bullets still render as a list');
  assert.deepEqual(list.items.map((item: any) => item.tokens[0].tokens.filter((x: any) => x.type === 'codespan').map((x: any) => x.text)),
    [['--branch'], ['--web']], 'both flag names reach the screen');
});

test('a patch is only ever a suggested change, never a fix, wherever the app words it', () => {
  assert.equal(A.step({ kind: 'file.delivered', data: { path: 'files/support/7/suggested.patch' } }), 'Suggested a change for the maintainer to review: “Suggested”');
  assert.equal(A.step({ kind: 'file.delivered', data: { path: 'files/notes.txt' } }), 'Made “Notes”');
  const [card] = A.lines({ messages: [{ id: 1, author: 'system', text: 'Delivered files/support/7/suggested.patch: Suggested change (for the maintainer to review)' }] }, 'desk');
  assert.deepEqual([card.text, card.files.length, card.files[0].name], ['Suggested change (for the maintainer to review)', 1, 'Suggested']);
  // One style for a line the person reads: crewd's own words are a note in a helper's chat and in the crew room alike,
  // so the same line never reads as a bubble with somebody's face on it in one and plain words in the other.
  const verdict = 'The suggested change did not pass its own check — the same check still fails after the change.';
  const [said] = A.room({ lines: [{ id: 1, bot: 'desk', author: 'system', text: verdict }] }, { bots: [{ id: 'desk', display: 'Desk' }], events: [] });
  assert.deepEqual([said.author, said.text], ['note', verdict], 'crewd names the work in plain words, so no path reaches the screen to be mangled');
});

test('the week under the share is a third in words, never a number', () => {
  assert.equal(A.share({ share: { choice: 'light', used: false, week: 'fair' } }).week, 'This week the crew has used a fair part of what it may use of your AI plan.');
  assert.equal(A.share({ share: { choice: 'full', used: false } }, 'Claude plan').today, 'When your Claude plan needs a rest, the crew waits and says so.');
  assert.equal(A.shares('Claude plan')[0].says, 'Leave most of my Claude plan for me');
  assert.equal(A.share({ share: { choice: 'full', used: false, week: null } }).week, '');
  for (const w of ['small', 'fair', 'most']) assert.doesNotMatch(A.share({ share: { choice: 'light', week: w } }).week, /\d|%/);
});

test('a failed send keeps the words for a Retry; every chat keeps its own draft', () => {
  keepDraft('chief', 'Please keep this unsent draft');
  keepDraft('reel', 'a different chat');
  sent('chief', false, draftOf('chief').text); // the send failed: nothing left the composer
  assert.equal(draftOf('chief').text, 'Please keep this unsent draft', 'the failed send kept the words');
  assert.equal(draftOf('reel').text, 'a different chat', 'the other chat kept its own draft');
  keepDraft('chief', 'Please keep this unsent draft, with one more word'); // the person edits before retrying
  sent('chief', true, draftOf('chief').text); // the retry went out
  assert.equal(draftOf('chief').text, '', 'a sent message is no longer held');
  assert.equal(draftOf('never-typed').text, '', 'an untouched chat has no draft');
  keepDraft('chief', '');
  assert.equal(draftOf('chief').text, '', 'emptying the box clears the hold');
  // One Retry sends once: the Retry affordance is a plain button, never a second form submit (the duplicate-message
  // regression this pins sent the same words twice). And the pink "Not sent" line reads against its background.
  const parts = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'parts.tsx'), 'utf8');
  assert.match(parts, /send-failed[\s\S]{0,200}type="button"/, 'the composer\u2019s Retry is type="button"');
  const lum = (hex: string) => { const c = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  assert.ok(ratio(color.day.pink, '#ffffff') >= 4.5, `the "Not sent" pink on white is ${ratio(color.day.pink, '#ffffff').toFixed(2)}`);
});

test('the words people read make only claims Crewhouse can keep', () => {
  const web = readFileSync(join(import.meta.dirname, '..', 'web/src/main.tsx'), 'utf8');
  assert.match(web, /<div className="label">You<\/div>/);
  assert.doesNotMatch(web, /People in this house|Others in the house|nobody else in the house/i);
  for (const f of ['web/src/main.tsx', 'web/src/flows.tsx', 'web/src/adapter.ts', 'mobile/App.tsx', 'src/crew.ts']) {
    const src = readFileSync(join(import.meta.dirname, '..', f), 'utf8');
    assert.doesNotMatch(src, /so it's safe|stays in this house|treat them like you|plenty left|never more than this in a month|that's us/i, f);
  }
  // The usage line describes the crew's own share, never a provider balance.
  assert.equal(A.meter({ share: { used: false } }), '');
  assert.equal(A.meter({ share: { used: true } }), 'The crew will carry on tomorrow');
  assert.equal(A.lines({ messages: [{ id: 1, author: 'bot', text: 'Good morning. Everything is quiet.', recap: true }] }, 'chief')[0].recap, true);
  assert.equal(A.share({ share: { choice: 'light', used: false } }).today, 'The crew stays within the share you gave it.');
});

test('a dialog owns the keyboard: Tab cycles inside and wraps, and an outside focus still lands inside', () => {
  let on = '';
  const el = (name: string) => ({ name, focus: () => { on = name; } });
  const [a, b, c] = [el('a'), el('b'), el('c')];
  const list = [a, b, c];
  assert.equal(cycle(list, a), b, 'forward');
  assert.equal(cycle(list, c), a, 'forward wraps');
  assert.equal(cycle(list, c, true), b, 'back');
  assert.equal(cycle(list, a, true), c, 'back wraps');
  assert.equal(cycle(list, null), a, 'focus not yet inside: Tab moves in');
  assert.equal(cycle(list, null, true), c, 'Shift+Tab moves in at the end');
  assert.equal(cycle(list, el('outside')), a);
  assert.equal(cycle([], a), null, 'an empty dialog traps nothing, but nothing is in it');
  assert.equal(on, '', 'deciding a move focuses nothing by itself');
});

test('reading text clears 4.5:1 against the surfaces it sits on, day and night', () => {
  const lum = (hex: string) => { const c = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const [name, pal, bgs] of [
    ['day', color.day, [color.day.surface, color.day.bg, color.day.sunken, color.day.cellIn, color.day.cellCalc]],
    ['night', color.night, [color.night.bg, color.night.surface, color.night.sunken, color.night.cellIn, color.night.cellCalc]],
  ] as const) {
    for (const t of [pal.ink, pal.ink2]) {
      for (const b of bgs) assert.ok(ratio(t, b) >= 4.5, `${name}: ${t} on ${b} is ${ratio(t, b).toFixed(2)}`);
    }
  }
  // Both dialogs own the keyboard through the one hook.
  for (const f of ['web/src/parts.tsx', 'web/src/flows.tsx']) {
    assert.match(readFileSync(join(import.meta.dirname, '..', f), 'utf8'), /useDialogOwn\(/, f);
  }

});

test('a delivered workbook is a card in the chat, and opens as a read-only sheet with tabs', async () => {
  const json = { sheets: [
    { name: 'Daily dashboard', total: 6, rows: [['Today', 'Number', 'Notes'], ['Arrivals', '6', 'from /home/alex/Crewhouse/bots/quill/files/log.xlsx'], ['Rooms ready', '—', '']] },
    { name: 'Rooms & housekeeping', total: 40, rows: [['Room', 'State', 'Checked by'], ['204', 'Ready', 'Rani']] },
  ] };
  const book = A.workbook(json, 'Hotel guest reception');
  assert.deepEqual(book.name, 'Hotel guest reception');
  assert.deepEqual(book.sheets.map((s) => s.name), ['Daily dashboard', 'Rooms & housekeeping']);
  assert.deepEqual(book.sheets[0].head, ['Today', 'Number', 'Notes']);
  assert.deepEqual(book.sheets[1].rows, [['204', 'Ready', 'Rani']]);
  assert.equal(book.sheets[1].total, 40, 'how many rows the sheet really has, not just the ones shown');
  assert.deepEqual(A.workbook({ sheets: [{ name: '', total: 0, rows: [['a']] }] }, 'Empty').sheets[0].name, 'Sheet');
  assert.deepEqual(A.workbook(null, 'Nothing').sheets, []);
  assert.doesNotMatch(shown(book), FORBIDDEN, 'a sheet is words and counts, never a path or the file');
  assert.equal(A.sheetWords(4), '4 sheets');
  assert.equal(A.sheetWords(1), 'One sheet');
  assert.equal(A.sheetWords(0), 'A spreadsheet');

  const [line] = A.lines({ messages: [{ id: 9, author: 'system', text: 'Delivered files/hotel-guest-reception.xlsx: 4 sheets: Daily dashboard, Booking & check-in' }] }, 'quill');
  assert.equal(line.files[0].kind, 'sheet');
  assert.equal(line.text, '', 'the card says what is in it, so the line says nothing twice');
  assert.equal(line.about, '4 sheets: Daily dashboard, Booking & check-in', 'the phone\'s plainer card keeps the words');
  assert.equal(A.lines({ messages: [{ id: 9, author: 'system', text: 'Delivered files/menu.md: dinners for the week' }] }, 'quill')[0].text, 'dinners for the week', 'a written page has no counted card, so it keeps its words');
  assert.equal(A.lines({ messages: [{ id: 9, author: 'system', text: 'Delivered files/receipt.pdf: the receipt' }] }, 'quill')[0].text, 'the receipt', 'any other file keeps its words');
  assert.deepEqual(A.fileSource(line.files[0].url), { bot: 'quill', path: 'files/hotel-guest-reception.xlsx' }, 'what the app asks crewd to read');
  const [thing] = A.things({ tasks: [{ id: 1, bot: 'quill', title: 'Hotel guest reception', state: 'done', updated_at: now, files: ['files/hotel-guest-reception.xlsx'] }] });
  assert.equal(thing.files[0].kind, 'sheet', 'Things opens it the same way');

  const parts = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'parts.tsx'), 'utf8');
  const panel = parts.slice(parts.indexOf('export function PreviewPanel'), parts.indexOf('export function Steps', parts.indexOf('export function PreviewPanel')));
  assert.match(parts, /f\.kind === 'sheet' \|\| f\.kind === 'page'\) return <PreviewCard/, 'a finished file is a card, not a plain file row');
  assert.match(parts, /<b>\{f\.name\}<\/b>[\s\S]{0,300}\{about\}/, 'the card: its name and a line about it');
  assert.match(parts, /<b className="wb-open">Open<\/b>/, 'and Open');
  assert.match(panel, /role="dialog" aria-modal aria-label=\{f\.name\}/, 'the panel is a dialog the keyboard belongs to');
  assert.match(panel, /<nav className="wb-tabs"[\s\S]{0,160}setTab\(i\)/, 'sheet tabs');
  assert.ok(panel.indexOf('<nav className="wb-tabs"') > panel.indexOf('<SheetTable s={s} />'), 'the tabs sit under the sheet, as in its own program');
  assert.match(panel, /className="btn go" href=\{f\.url\}[^>]*>Download</, 'Download hands over the file');

  // The card's peek and the panel's grid, rendered for real: letters over the columns, the file's own row numbers
  // (a gap where a blank row was skipped), a tint for each role, and a four-by-four corner on the card.
  const dir = mkdtempSync(join(process.cwd(), 'test/.sheet-'));
  try {
    await build({ entryPoints: ['web/src/parts.tsx'], outfile: join(dir, 'parts.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'error' });
    const { SheetTable, Thumb } = await import(join(dir, 'parts.mjs'));
    const sheet = A.workbook({ sheets: [{ name: 'Bookings', total: 4, rows: [['Guest', 'Nights', 'Rate', 'Bill', 'Paid'], ['Amina', '3', '95', '285', 'Yes'], ['Bilal', '1', '120', 'auto', 'No']],
      nums: [1, 2, 4], roles: [['head', 'head', 'head', 'head', 'head'], ['', 'in', '', '', 'in'], ['', 'in', '', 'calc', 'in']] }] }, 'Bookings').sheets[0];
    const grid = renderToStaticMarkup(createElement(SheetTable, { s: sheet }));
    assert.match(grid, /<thead><tr><th class="wb-n"><\/th><th>A<\/th><th>B<\/th><th>C<\/th><th>D<\/th><th>E<\/th><\/tr><\/thead>/, 'column letters');
    assert.deepEqual([...grid.matchAll(/<tr><th class="wb-n" scope="row">(\d+)<\/th>/g)].map((m) => m[1]), ['1', '2', '4'], 'row numbers from the file, gap kept');
    assert.match(grid, /<th scope="col" class="head">Guest<\/th>/, 'the heading row is set apart, and names its column for a screen reader');
    assert.match(grid, /<td class="in">3<\/td>/, 'what the person fills in is tinted');
    assert.match(grid, /<td class="calc">auto<\/td>/, 'what works itself out is tinted too');
    assert.match(grid, /and one more row\. /, 'one row is a row');
    assert.match(renderToStaticMarkup(createElement(SheetTable, { s: { ...sheet, total: 9 } })), /and 6 more rows\. /, 'what is not shown is said, not hidden');
    const thumb = renderToStaticMarkup(createElement(Thumb, { name: 'Bookings', book: { name: 'Bookings', sheets: [sheet] }, doc: null, text: null }));
    assert.equal((thumb.match(/<i[ >]/g) ?? []).length, 12, 'the card peeks at the top-left corner: four columns of each of its three rows');
    const tall = { ...sheet, rows: [...sheet.rows, ...sheet.rows, ...sheet.rows] };
    assert.equal((renderToStaticMarkup(createElement(Thumb, { name: 'x', book: { name: 'x', sheets: [tall] }, doc: null, text: null })).match(/<i[ >]/g) ?? []).length, 16, 'four by four at most');
    assert.match(thumb, /^<span class="wb-thumb" aria-hidden="true"[^>]*><i class="head">Guest<\/i><i class="head">Nights<\/i>/);
    assert.match(thumb, /<i class="calc">auto<\/i>/);
    const page = renderToStaticMarkup(createElement(Thumb, { name: 'Handbook', book: null, text: null,
      doc: A.document({ parts: [{ kind: 'heading', text: 'Handbook' }, { kind: 'heading', text: 'Mornings' }, { kind: 'p', text: 'Open the desk at seven.' }, { kind: 'li', text: 'Walk the free rooms' }] }, 'Handbook') }));
    assert.match(page, /class="wb-thumb leaf"[^>]*><b>Mornings<\/b><i style="width:\d+(\.\d+)?%"><\/i><i /, 'a page peeks as its heading over its lines, never the title twice');
    assert.equal(renderToStaticMarkup(createElement(Thumb, { name: 'x', book: null, doc: null, text: null })), '', 'nothing to peek at yet shows nothing');
    assert.equal(renderToStaticMarkup(createElement(Thumb, { name: 'x', book: A.workbook({ sheets: [{ name: 'Plan', rows: [] }] }, 'x'), doc: null, text: null })), '', 'nor does an empty sheet');
    assert.deepEqual([0, 1, 2].map(A.column), ['A', 'B', 'C']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.doesNotMatch(panel, /<input|<textarea|contentEditable|onClick=\{\(\) => (?!setTab\b)(set|edit)/, 'read-only: nothing to type into');
  assert.match(readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8'), /a === 'f' && b && c[\s\S]{0,120}file: decodeURIComponent\(c\)/, '#/f/<helper>/<file> opens the panel beside its chat');
});

// The phone's reader shows a sheet the way the web's panel does: letters, the file's row numbers, the heading row set
// apart, the two tints from the shared tokens, and the tabs under the sheet rather than over it.
test('the phone reads a sheet as a grid with its tabs underneath', () => {
  const app = readFileSync(PHONE_SCREENS[0], 'utf8');
  const grid = app.slice(app.indexOf('function SheetGrid('), app.indexOf('function DocParts('));
  const sheet = app.slice(app.indexOf('function DocSheet('), app.indexOf('function VideoSheet('));
  assert.match(grid, /nums && <View[\s\S]{0,200}A\.column\(c\)/, 'letters over the columns');
  assert.match(grid, /nums\[j\] \?\? j \+ 1/, 'row numbers from the file down the side');
  assert.match(grid, /role === 'in' \? t\.cellIn : role === 'calc' \? t\.cellCalc/, 'fill-in and worked-out cells tinted');
  assert.match(grid, /role === 'head' \? s\.b/, 'the heading row set apart');
  assert.match(sheet, /<SheetGrid head=\{sNow\.head\} rows=\{sNow\.rows\} nums=\{sNow\.nums\} roles=\{sNow\.roles\} \/>/);
  assert.ok(sheet.indexOf('setTab(i)') > sheet.indexOf('</ScrollView>'), 'tabs under the sheet, outside its scroll');
  assert.match(sheet, /more === 1 \? 'one more row' : `\$\{more\} more rows`/, 'one row is a row');
  for (const pal of [color.day, color.night]) assert.ok(pal.cellIn && pal.cellCalc && pal.cellIn !== pal.cellCalc);
});

// The same bar for a document: crewd writes the .docx (crew_document), the chat shows a card, and the panel is the
// document itself — headings, paragraphs, lists and a table — read-only, words only.
test('a delivered document is a card in the chat, and opens as a read-only document', () => {
  const json = { parts: [
    { kind: 'heading', text: 'Front-desk handbook' },
    { kind: 'p', text: 'Claude Code and Codex: see https://www.sec.gov/rules/” for details.' },
    { kind: 'li', text: 'Walk the free rooms' },
    { kind: 'table', head: ['Shift', 'On the desk'], rows: [['Morning', 'Rani']] },
    { kind: 'p', text: '' },
    { kind: 'table', head: [], rows: [] },
  ] };
  const doc = A.document(json, 'Front-desk handbook');
  assert.deepEqual(doc.parts[0], { kind: 'heading', text: 'Front-desk handbook' });
  assert.equal(doc.parts[1].text, json.parts[1].text, 'document content is not rewritten like bot chatter');
  assert.deepEqual(doc.parts[3].head, ['Shift', 'On the desk']);
  assert.equal(doc.parts.length, 4, 'empty parts leave, a table needs its headings');
  assert.deepEqual(A.document(null, 'Nothing').parts, []);
  const source = doc.parts[1].text!;
  const links = A.docLinks(source);
  assert.equal(links.map((p) => p.text).join(''), source, 'reader never changes the source text');
  assert.deepEqual(links.filter((p) => p.href).map((p) => p.href), ['https://www.sec.gov/rules/'], 'source URLs link without the smart quote');
  assert.equal(A.docLinks('javascript:alert(1) and ftp://example.org').some((p) => p.href), false, 'only http(s) is linked');
  assert.deepEqual(A.docLinks('[SEC](https://www.sec.gov/x)'), [{ text: 'SEC', href: 'https://www.sec.gov/x' }],
    'a written citation renders as its link text, never raw brackets');
  const cited = A.docLinks('From [SEC, accessed Sept. 27, 2026](https://www.investor.gov/) and [FDIC EDIE](https://edie.fdic.gov/).');
  assert.deepEqual(cited, [
    { text: 'From ' }, { text: 'SEC, accessed Sept. 27, 2026', href: 'https://www.investor.gov/' }, { text: ' and ' },
    { text: 'FDIC EDIE', href: 'https://edie.fdic.gov/' }, { text: '.' },
  ], 'citations in prose keep their words and lose the bracket syntax');
  assert.equal(A.docLinks('[note](javascript:alert(1))').some((p) => p.href), false, 'a citation to another scheme stays plain text');
  assert.equal(A.pageWords(3), '3 sections');
  assert.equal(A.pageWords(1), 'One section');
  assert.equal(A.pageWords(0), 'A document');
  const long = 'Claude Code and Codex ' + 'a'.repeat(591);
  assert.equal(long.length, 613);
  assert.equal(A.document({ parts: [{ kind: 'p', text: long }] }, 'Brief').parts[0].text, long, '613 characters survive the adapter');

  const [line] = A.lines({ messages: [{ id: 10, author: 'system', text: 'Delivered files/front-desk-handbook.docx: A document in 3 sections: Front-desk handbook' }] }, 'quill');
  assert.equal(line.files[0].kind, 'page', 'a .docx is a page, opened like a workbook');
  const [thing] = A.things({ tasks: [{ id: 2, bot: 'quill', title: 'Front-desk handbook', state: 'done', updated_at: now, files: ['files/front-desk-handbook.docx'] }] });
  assert.equal(thing.files[0].kind, 'page');

  const parts = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'parts.tsx'), 'utf8');
  const panel = parts.slice(parts.indexOf('export function PreviewPanel'), parts.indexOf('export function Steps', parts.indexOf('export function PreviewPanel')));
  assert.match(panel, /<DocBody doc=\{doc\} \/>/, 'the panel shows the document itself');
  const body = parts.slice(parts.indexOf('function DocBody'), parts.indexOf('/**\n * A finished file'));
  assert.match(body, /run\.kind === 'heading' \? <h3 key=\{i\}>/, 'headings as headings');
  assert.match(body, /<ul key=\{i\}>/, 'bullets as bullets');
  assert.match(body, /<DocText text=\{run\.text\} \/>/, 'paragraphs render through the URL linker');
  assert.match(body, /<DocText text=\{r\[c\] \?\? ''\} \/>/, 'table citations are linked too');
  assert.match(parts, /href=\{part\.href\} target="_blank" rel="noopener noreferrer">\{part\.text\}<\/a>/, 'only safe links are tappable');
  assert.doesNotMatch(body, /\*\*|<w:/, 'no raw markup anywhere in the preview');
  const api = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'api.ts'), 'utf8');
  assert.match(api, /\/api\/document/, 'the app asks crewd to read the document, never parses it');
});

// The wait between the answer and the card (?demo=building): while a workbook or document job is live and its
// file hasn't landed, the chat holds its place with a skeleton card — never a tool name, never silence.
test('a file build shows a placeholder card until the file lands', () => {
  const asking = { messages: [
    { id: 1, author: 'person', text: 'create an excel for reception at the hotel' },
    { id: 2, author: 'bot', text: 'One thing before I build it: whose day sheet is it?' },
    { id: 3, author: 'person', text: "the desk's own day sheet" },
  ] };
  const live = { id: 7, title: 'Excel for reception', state: 'working', files: [] };
  assert.equal(A.building(A.lines(asking, 'scribe'), live), true, 'mid-build: the question answered, no file yet');
  const landed = A.lines({ messages: [...asking.messages,
    { id: 4, author: 'system', text: 'Delivered files/hotel-guest-reception.xlsx: 4 sheets: Daily dashboard' }] }, 'scribe');
  assert.equal(A.building(landed, live), false, 'the file landed: its own card takes the placeholder\u2019s place');
  assert.equal(A.building(A.lines(asking, 'scribe'), { ...live, state: 'needs_you' }), false, 'waiting on the person is not building');
  assert.equal(A.building(A.lines(asking, 'scribe'), null), false, 'no live task, no placeholder');
  const flights = A.lines({ messages: [{ id: 1, author: 'person', text: 'find me somewhere nice for dinner' }] }, 'scout');
  assert.equal(A.building(flights, { id: 8, title: 'Saturday dinner', state: 'working', files: [] }), false, 'another kind of job never shows it');
  const doc = A.lines({ messages: [{ id: 1, author: 'person', text: 'put the desk rules together as a word document' }] }, 'scribe');
  assert.equal(A.building(doc, { id: 9, title: 'Front-desk handbook', state: 'working', files: [] }), true, 'a document build holds its place too');

  const main = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.match(main, /A\.building\(lines, live\)/, 'the chat asks the adapter whether a file is on its way');
  assert.match(main, /Building it\. I\u2019ll share it here\./, 'the placeholder says so in plain words');
  assert.match(main, /className="building-card"[\s\S]{0,200}aria-label="Building it"/, 'a skeleton card, named for what it is');
  const demo = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'demo.ts'), 'utf8');
  assert.match(demo, /variant === 'building'/, '?demo=building is wired');
  assert.match(demo, /\?demo=building/, '?demo=building is documented with the other variants');
  const css = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'styles.css'), 'utf8');
  assert.match(css, /\.building-card/, 'the skeleton card has its own style');
});

// The owner's screenshot, fixed: a meal plan delivered as .md must open as a rendered page in the read-only panel —
// never the raw file at its /files/ address — through the shared safe markdown renderer the chat already uses.
test('inline video uses intrinsic portrait aspect without cropping', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'styles.css'), 'utf8');
  const rule = css.match(/video\.media\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(rule, /width:\s*auto/);
  assert.match(rule, /max-width:\s*100%/);
  assert.match(rule, /height:\s*auto/);
  assert.match(rule, /object-fit:\s*contain/);
  assert.doesNotMatch(rule, /aspect-ratio|object-fit:\s*cover/);
});

test('a delivered markdown file opens rendered, and no screen leads to the raw file', () => {
  const [line] = A.lines({ messages: [{ id: 12, author: 'system', text: 'Delivered files/dinners-and-shopping-list.md: Seven dinners and the list, sorted by aisle' }] }, 'scout');
  assert.equal(line.files[0].kind, 'page', 'a .md opens like a document: card, then the rendered panel');
  const target = A.fileTarget(line.files[0]);
  assert.match(target!.href, /^#\/f\/scout\//, 'the tap opens the read-only view');
  assert.doesNotMatch(target!.href, /\/files\//, 'never the raw file address');
  assert.equal(target!.chip, 'MD');
  assert.equal(A.fileTarget({ url: '/files/scout/files/scan.pdf', kind: 'doc', name: 'Scan' })!.href, '/files/scout/files/scan.pdf', 'a PDF keeps its own way');
  assert.equal(A.fileTarget({ url: '/files/scout/files/plan.txt', kind: 'page', name: 'Plan' })!.href.startsWith('#/f/'), true, 'a .txt renders the same way');

  // A delivered page is content, not chatter; its exact text goes to the escaping renderer.
  const page = '# Plan\n\n- [x] Rice\n- [ ] Yoghurt\n\nClaude Code and Codex wrote this.';
  assert.equal(A.mdPlain(page), page);

  const parts = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'parts.tsx'), 'utf8');
  const panel = parts.slice(parts.indexOf('export function PreviewPanel'), parts.indexOf('/** "Show the work"'));
  assert.match(panel, /\{mdBlocks\(chatTokens\(text\)\)\}/, 'a delivered .md renders through the shared safe tokens');
  assert.match(parts, /type="checkbox" checked=\{item.checked\} readOnly/, 'a task-list tick shows read-only');
  assert.doesNotMatch(parts, /dangerouslySetInnerHTML/, 'the preview renders text nodes, never markup');
  const safe = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'chat-md.ts'), 'utf8');
  assert.match(safe, /\/\^https\?:\$\/\.test\(url\.protocol\)/, 'a link opens only for http(s)');

  // What the renderer receives for a meal plan, without a browser: a heading, a table, a ticked list — and nothing
  // that could execute. The same tokens the chat renderer was already trusted with.
  const plan = '# Dinners\n\n| Day | Dinner |\n|-----|--------|\n| Monday | Pilaf |\n\n- [x] Rice\n- [ ] Yoghurt\n\nA [trick](javascript:alert(1)) and an [ok](https://cook.example) link.';
  const tokens = chatTokens(A.mdPlain(plan)) as any[];
  assert.equal(tokens[0].type, 'heading');
  assert.equal(tokens.find((t) => t.type === 'table')?.header.length, 2, 'the table renders as a table');
  const list = tokens.find((t) => t.type === 'list') as any;
  assert.deepEqual(list.items.map((i: any) => [i.task, i.checked]), [[true, true], [true, false]], 'the ticks arrive as read-only data');
  assert.equal(safeLink('javascript:alert(1)'), '', 'a javascript link never opens');
  assert.match(safeLink('https://cook.example'), /^https:/, 'an http(s) link does');
  const demo = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'demo.ts'), 'utf8');
  assert.doesNotMatch(demo, /stub [\w-]+:/i, 'demo replies never expose the test model');
  assert.match(demo, /dinners-and-shopping-list\.md'\) \? \{ text:/, 'the demo serves the plan the way crewd does: its own words');
  const main = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.match(main, /A\.fileTarget\(x\.files\[0\]\)/, 'a chat\'s finished things open the same rendered way (B1 Home sends done work to the tray, which is Things)');
  assert.doesNotMatch(main, /files\[0\]\?\.url/, 'no raw file address on a Home row');
});

// The head-to-head's false label: a delivered MP4 wore a DOCX badge because the chip was a hardcoded
// fallback (XLSX/PDF/else DOCX). Every badge now comes from the file itself; this pins it.
test('a delivered .mp4 shows a video badge, never DOCX', () => {
  const f = A.fileView('reel', 'files/mum-birthday_v2.mp4');
  assert.equal(f.kind, 'video', 'the chat card plays it as a video');
  assert.equal(A.fileTarget(f)!.chip, 'MP4', 'the chip names the real kind');
  const [thing] = A.things({ tasks: [{ id: 9, bot: 'reel', title: "Mum's birthday film", state: 'done', updated_at: now, files: ['files/mum-birthday_v2.mp4'] }] });
  assert.equal(A.fileTarget(thing.files[0])!.chip, 'MP4', 'a chat\'s list and Things show the same file-derived chip');
  const app = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'main.tsx'), 'utf8');
  assert.doesNotMatch(app, /'DOCX'|'XLSX'|'PDF'/, 'no badge is a hardcoded default; every chip comes from the file');
});

// The office holds all of the person's helper jobs, steps, questions and first looks.
const OTN = Date.now();
const oBot = (id: string, name: string, extra: Json = {}) => ({ id, display: name, template: id, role: `${name} helps out`,
  controls: 'bot', computer: false, queued: 0, pausedUntil: null, unread: 0, stuck: false, ...extra });
const oTask = { reel: { id: 41, title: "Mum's birthday video", state: 'working' },
  scout: { id: 42, title: 'Flights to Lahore in December', state: 'working' },
  scribe: { id: 43, title: 'Thank-you note for Aunty Sara', state: 'needs_you' },
  pip: { id: 51, title: 'Car insurance renewal', state: 'working' },
  tracer: { id: 44, title: "Sara Malik's work email", state: 'needs_you' } } as Record<string, Json>;
const oStep = { reel: { seq: 11, at: OTN, kind: 'run.tool', data: { task: 41, words: 'Timing the photos to the music' } },
  scout: { seq: 12, at: OTN, kind: 'task.progress', data: { task: 42, text: 'Comparing three airlines' } },
  pip: { seq: 13, at: OTN, kind: 'run.tool', data: { task: 51, words: 'Putting the prices side by side' } } } as Record<string, Json>;
function officeState(): Json {
  const bots = ['reel', 'scout', 'scribe', 'pip', 'tracer'].map((id) =>
    oBot(id, id[0].toUpperCase() + id.slice(1), { task: { ...oTask[id] }, step: oStep[id] ?? null }));
  const asks = [
    { id: 7, bot: 'scribe', kind: 'permission', at: OTN, detail: { effect: 'send', words: 'Scribe wants to email your thank-you note to Aunty Sara. Send it?',
      preview: { head: 'To Aunty Sara', body: 'Dear Aunty Sara, thank you for Sunday dinner' } } },
    { id: 8, bot: 'tracer', kind: 'permission', at: OTN, detail: { effect: 'spend', spends: true, words: 'Tracer wants one paid lookup to confirm the address. OK?' } },
  ];
  const tasks = [{ id: 21, bot: 'scout', title: "This week's dinners", state: 'done', updated_at: OTN,
    files: ['files/dinners-and-shopping-list.md'], result: 'Seven dinners the kids will actually eat, and one shopping list sorted by aisle.' }];
  const events = [oStep.reel, oStep.scout, oStep.pip,
    { seq: 14, at: OTN, kind: 'file.delivered', bot: 'reel', data: { task: 41, path: 'files/birthday-first-look.png', note: 'A still from the opening' } },
    { seq: 15, at: OTN, kind: 'file.delivered', bot: 'pip', data: { task: 51, path: 'files/car-insurance-prices.xlsx', note: 'This year against two others' } },
  ];
  return { person: { id: 1 }, asks, tasks, events, resting: {}, ideas: [],
    bots: [{ id: 'chief', display: 'Chief', template: 'chief' }, ...bots] };
}
const OJARGON = /\b(relay|noise|tickets?|grants?|daemon|crewd|engine|tokens?|ports?|stub|hosted?|links?|host)\b/i;

test('the office holds the person’s whole crew and all their jobs', () => {
  const room = A.office(officeState());
  assert.deepEqual(room.crew.map((c) => c.id), ['reel', 'scout', 'scribe', 'pip', 'tracer']);
  const reel = room.crew.find((c) => c.id === 'reel')!;
  assert.deepEqual([reel.status, reel.step, reel.ring], ["Mum's birthday video", 'Timing the photos to the music', 'working']);
  assert.equal(reel.things[0].kind, 'image');
  assert.ok(reel.steps.some((s) => s.now));
  const scribe = room.crew.find((c) => c.id === 'scribe')!;
  assert.equal(scribe.ring, 'needs');
  assert.match(scribe.ask?.head ?? '', /ready to send/);
  assert.match(scribe.ask?.words ?? '', /Aunty Sara/);
  const pip = room.crew.find((c) => c.id === 'pip')!;
  assert.equal(pip.status, 'Car insurance renewal');
  assert.equal(pip.things[0].kind, 'sheet');
  assert.equal(room.crew.find((c) => c.id === 'tracer')!.ring, 'needs');
  assert.deepEqual(room.counts, { needs: 2, working: 3, done: 1 });
  assert.doesNotMatch(shown(room), FORBIDDEN);
  const words = (x: unknown): string => typeof x === 'string' ? x : Array.isArray(x) ? x.map(words).join(' ')
    : x && typeof x === 'object' ? Object.entries(x).filter(([k]) => k !== 'url' && k !== 'at').map(([, w]) => words(w)).join(' ') : '';
  assert.doesNotMatch(words(room), OJARGON);
  for (const f of ['web/src/office.tsx', 'mobile/src/office.tsx', 'mobile/App.tsx', 'web/src/adapter.ts'])
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, '..', f), 'utf8'), /busyElsewhere|BUSY_ELSEWHERE/, 'no other-person office state');
});

test('the office moves on live events; the refresh stays the source of truth', () => {
  let v = A.office(officeState());
  v = A.officeEvent(v, { seq: 20, at: OTN, kind: 'run.tool', bot: 'scout', data: { task: 42, words: 'Friday night is cheapest direct' } });
  const scout = v.crew.find((c) => c.id === 'scout')!;
  assert.equal(scout.step, 'Friday night is cheapest direct', 'a step bumps the bubble');
  assert.equal(scout.steps.at(-1)?.now, true);
  v = A.officeEvent(v, { seq: 21, at: OTN, kind: 'file.delivered', bot: 'reel', data: { task: 41, path: 'files/birthday-full-cut.mp4', note: 'Ninety seconds, with the piano song' } });
  const reel = v.crew.find((c) => c.id === 'reel')!;
  assert.equal(reel.things.length, 2, 'a new thing lands on the desk');
  assert.equal(reel.things.at(-1)?.kind, 'video');
  assert.match(reel.step, /Birthday full cut/);
  // All helper steps arrive; unknown helpers change nothing.
  const v2 = A.officeEvent(v, { seq: 22, at: OTN, kind: 'run.tool', bot: 'pip', data: { task: 51, words: 'Reading the renewal letter' } });
  assert.equal(v2.crew.find((c) => c.id === 'pip')!.step, 'Reading the renewal letter');
  assert.equal(A.officeEvent(v, { seq: 23, at: OTN, kind: 'run.tool', bot: 'ghost', data: { task: 1, words: 'Hi' } }), v);
  assert.equal(A.officeEvent(v, { seq: 24, at: OTN, kind: 'reply.partial', bot: 'scout', data: {} }), v, 'a kind the panels do not draw leaves it alone');
  // Done: the jump, and the thing into the tray.
  v = A.officeEvent(v, { seq: 25, at: OTN, kind: 'task.done', bot: 'reel', data: { task: 41, title: "Mum's birthday video", result: 'Ninety seconds of photos, with a gentle piano song.' } });
  const done = v.crew.find((c) => c.id === 'reel')!;
  assert.deepEqual([done.ring, done.mood, done.status, done.step], ['', 'happy', 'Free to help', '']);
  assert.equal(v.done.length, 2);
  assert.equal(v.counts.done, 2);
  assert.match(v.done[0].summary, /Ninety seconds/);
  // A question, then its answer.
  let u = A.office(officeState());
  u = A.officeEvent(u, { seq: 26, at: OTN, kind: 'ask.opened', bot: 'pip', data: { task: 51 } });
  assert.deepEqual([u.crew.find((c) => c.id === 'pip')!.ring, u.crew.find((c) => c.id === 'pip')!.status], ['needs', 'Needs you']);
  assert.equal(u.counts.needs, 2, 'the count waits for the refresh to bring the actual Needs-you row');
  assert.equal(A.seatOf(u.crew.find((c) => c.id === 'pip')!), 'chat', 'and so does Review');
  u = A.officeEvent(u, { seq: 27, at: OTN, kind: 'ask.answered', bot: 'pip', data: { task: 51, answer: 'allow' } });
  assert.equal(u.crew.find((c) => c.id === 'pip')!.ring, 'working', 'answered: back on the job');
  u = A.officeEvent(u, { seq: 28, at: OTN, kind: 'task.failed', bot: 'pip', data: { task: 51, title: 'Car insurance renewal' } });
  assert.equal(u.crew.find((c) => c.id === 'pip')!.mood, 'error');
  for (const view of [v, u]) assert.doesNotMatch(shown(view), FORBIDDEN);
});

test('speaking to Chief stays on the device and only fills the box: the person still taps send', () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
  const web = src('web/src/voice.ts');
  assert.match(web, /processLocally: true/, 'the browser is asked for its on-device recognizer only');
  assert.doesNotMatch(web, /^import|\bfetch\(|XMLHttpRequest|WebSocket|api\./m, 'the voice helper talks to nothing but the recognizer');
  assert.match(src('mobile/modules/crewhouse-net/android/src/main/java/expo/modules/crewhousenet/CrewhouseVoiceModule.kt'), /createOnDeviceSpeechRecognizer/, 'the phone uses its on-device recognizer only');
  assert.doesNotMatch(src('mobile/modules/crewhouse-net/android/src/main/java/expo/modules/crewhousenet/CrewhouseVoiceModule.kt'), /createSpeechRecognizer\(/);
  // The phone hears through @byokit/dictation: the Kotlin recognizer is the system engine the kit asks its app to inject,
  // on the phone only, and the app reaches the kit through that one file.
  const net = src('mobile/modules/crewhouse-net/index.ts');
  assert.match(net, /new Dictation\(\{ engine: systemEngine\(\{/);
  assert.match(net, /dictation\.listen\(\{ onDeviceOnly: true \}\)/);
  assert.match(net, /requireOptionalNativeModule<[^\n]*>\('CrewhouseVoice'\)/);
  const mobile = join(import.meta.dirname, '..', 'mobile');
  assert.deepEqual([...readdirSync(join(mobile, 'src')).map((f) => join('src', f)), 'App.tsx', 'index.ts'].filter((f) => readFileSync(join(mobile, f), 'utf8').includes('@byokit/dictation')), []);
  // What was heard goes into the box through the composer's own change; the send button stays the only way out.
  const parts = src('web/src/parts.tsx'), app = src('mobile/App.tsx');
  assert.match(parts, /useVoice\(chat === 'chief', text, \(t\) => change\(t\)\)/);
  assert.match(app, /mic = chat === 'chief', listen \}/, 'Chief\'s box, and Write it here\'s (mobile/src/panel.tsx), hear');
  assert.match(app, /<Mic on=\{mic\} text=\{text\} put=\{change\} listen=\{listen\} \/>/, 'held bubble: the same mic, started at once, still only filling the box');
  for (const f of [parts.slice(parts.indexOf('function useVoice'), parts.indexOf('export function Composer')), app.slice(app.indexOf('function Mic('), app.indexOf('function Composer('))])
    assert.doesNotMatch(f, /send\(|onSend|api\./, 'the mic never sends');
});

test('a desk shows the job\'s first looks from its task, never a raw path', () => {
  // crewd sends own output first with handed-over inputs marked; photos stay in the chat.
  const task = { id: 41, title: 'Party plan', state: 'working', files: [
    { path: 'files/party-plan-first-look.png', note: 'First look: the table', at: OTN },
    { path: 'files/from-scout/venue-lead.png', note: 'from Scout', at: OTN, input: true },
    { path: 'files/photos/41-1.png', note: 'your photo', at: OTN, photo: true },
  ] };
  const bots: Json[] = [{ id: 'chief', display: 'Chief', template: 'chief' },
    oBot('reel', 'Reel', { live: 'working', task, step: null })];
  const s: Json = { person: { id: 1 }, asks: [],
    tasks: [{ id: 21, bot: 'reel', title: 'Old job', state: 'done', updated_at: OTN, files: [], result: 'Done.' }],
    events: [], resting: {}, ideas: [], bots };
  const h = A.crew(s).find((x) => x.id === 'reel')!;
  assert.deepEqual(h.things.map((f) => f.name), ['Party plan first look', 'Venue lead'], 'own output first, photos off the desk');
  const w = A.work(s).find((x) => x.helper === 'reel')!;
  assert.deepEqual(w.things.map((f) => f.name), h.things.map((f) => f.name), 'the job sheet reads the same desk');
  // The room keeps first looks past the event window: no live event needed.
  const v = A.office(s);
  assert.deepEqual(v.crew.find((c) => c.id === 'reel')!.things.map((f) => f.name), ['Party plan first look', 'Venue lead']);
  for (const view of [h, w, v]) assert.doesNotMatch(shown(view), FORBIDDEN, 'things never render a raw path');
  assert.doesNotMatch(h.things.map((f) => f.name).join(' '), /files\/|\.png/i, 'names are said, not pathed');
});

test('J5 repairs stay in: the night look paints first, the job row is never cut to one line, the panels read one state', () => {
  const read = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', ...p), 'utf8');
  const html = read('web', 'index.html'), main = read('web', 'src', 'main.tsx'), css = read('web', 'src', 'styles.css'), office = read('web', 'src', 'office.tsx');
  // The look is set before the first paint, by the same rule useLook keeps after (a night viewer never sees a day frame).
  const pre = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
  assert.ok(html.indexOf('<script>') < html.indexOf('<body>'), 'the look is set in the head, before the body paints');
  for (const w of ["'crewhouse.look'", "q.has('night')", "q.has('day')", 'h >= 19 || h < 7']) assert.ok(pre.includes(w), `index.html's first look reads ${w}`);
  assert.match(main, /localStorage\.getItem\('crewhouse\.look'\)/); assert.match(main, /hour >= 19 \|\| hour < 7/);
  // The job row: no old inset narrows it, the mock's metrics on both widths, and its line wraps rather than being cut.
  assert.doesNotMatch(css, /^\.jobs \{ padding/m, 'the old .jobs inset is gone');
  assert.match(css, /^\.jobs \.list-row \{ gap: 10px; padding: 10px 12px; \}/m);
  assert.match(main, /j\.says && <span className="small mute clamp">/, 'a job row\'s line wraps to two lines, never an ellipsis on one');
  // No drawn room anywhere: no floor plan, no room tokens, no room markup or styles.
  assert.doesNotMatch(office, /floorPlan|o-room|o-cell|o-strip|o-tag|SpritesIn|handOff|TrayBox|<svg/);
  assert.doesNotMatch(read('web', 'src', 'tokens.ts'), /room/);
  assert.doesNotMatch(css, /\.o-room|\.o-cell|\.o-strip|\.o-tag|\.o-sheet|\.o-tray|\.o-flyer|\.o-sprite|\.o-cap|\.o-ask|r-wall|r-edge/);
  // Chief first, then the whole crew in roster order: nobody capped, nobody counted under "+N".
  assert.match(office, /<ChiefPanel live=\{live\} \/>/);
  assert.match(office, /\{A\.roster\(live\.crew\)\.map\(\(c\) => <HelperPanel/);
  // Phone width renders the grouped list instead of the panels, helmets still.
  assert.match(office, /if \(useNarrow\(\)\) return \(\s*<section className="office" aria-label="The office">\s*<Groups live=\{live\} titles=\{titles\} onDone=\{onDone\} \/>/);
  assert.match(office, /<PalArt kind=\{c\.kind\} mood=\{c\.mood\} d=\{6\} name=\{c\.name\} \/>/, 'grouped rows draw the still helmet, no live scan');
  assert.match(css, /\.grow-row \{ display: flex; gap: 12px; padding: 12px 2px; border-top: 1px solid var\(--line\); \}/);
  // Each panel: the helmet, the current line, one meta line, the last three timed steps, the one action.
  assert.match(office, /steps=\{c\.steps\.slice\(-3\)\}/);
  assert.match(office, /<time className="time">\{A\.clock\(s\.at\)\}<\/time>/, 'times in a column read in mono, never in a sentence');
  assert.match(office, /action=\{c\.ask \? <AskButton c=\{c\.ask\} name=\{c\.name\} onDone=\{onDone\} \/>/, 'a question\'s own yes and no');
  // Only a needs-you row carries a button, and it wears the ask's own words: its yes, or its flow's label.
  assert.match(office, /const label = yes\?\.label \?\? \(c\.reply \? `Answer \$\{name\}…` : c\.review \? 'Review order' : 'Review…'\);/);
  assert.doesNotMatch(office, />Review…<\/a>/, 'no generic Review anywhere in the office');
  assert.match(office, /: file \? <PreviewCard f=\{file\} \/> : null/, 'a finished file opens from the panel');
  // The ask's yes answers exactly as the thread does, then the office refreshes.
  assert.match(read('web', 'src', 'parts.tsx'), /export const answer = \(c: Card, body: Json\)/);
  assert.match(main, /<Office state=\{state\} live=\{live\} night=\{ctx\.night\} onDone=\{refresh\} \/>/);
  // Office header: the slim bar (title, count line, switch, settings), the title on phone width only.
  assert.match(main, /<h1 className="office-title">Office<\/h1>/);
  assert.match(main, /\{summaryOf\(ctx\.live\)\}/, 'one count line from the office view');
  assert.match(css, /@media \(min-width: 900px\) \{ \.office-title \{ display: none; \} \}/);
  // The grid scrolls past six instead of shrinking: three columns on a desk, groups below 900 px.
  assert.match(css, /@media \(min-width: 900px\) \{ \.panels \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \} \}/);
});
test("Chief's hero shows his last real sentence; the sign-in card offers every provider", async () => {
  const chief = (text: string, extra = {}) => ({ bots: [{ id: 'chief', last: { author: 'bot', text, at: now }, ...extra }] });
  assert.equal(A.chiefSaid(chief('4.')), '', 'a bare fragment never reaches the hero');
  assert.equal(A.chiefSaid(chief('Reel is on it.')), 'Reel is on it.');
  assert.equal(A.chiefSaid(chief('All done. 4.')), 'All done.', 'the last real sentence wins');
  assert.equal(A.chiefSaid(chief('- Buy milk')), '- Buy milk', 'a list line is real content');
  assert.equal(A.chiefSaid(chief('What is 2+2?', { last: { author: 'person', text: 'hi', at: now } })), '', "never the person's words");
  const unsigned = A.AIS.map((a) => ({ account: a.key, signedIn: false }));
  const dir = mkdtempSync(join(process.cwd(), 'test/.card-'));
  try {
    await build({ entryPoints: ['web/src/flows.tsx'], outfile: join(dir, 'flows.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'error' });
    const { AccountCard } = await import(join(dir, 'flows.mjs'));
    const card = renderToStaticMarkup(createElement(AccountCard, { accounts: unsigned, onReady: () => {} }));
    assert.equal((card.match(/Sign in with /g) ?? []).length, 6, 'every provider, never ChatGPT alone');
    assert.match(card, /Sign in with Claude/, 'the kit list carries Claude too');
    assert.doesNotMatch(card, /under Settings/, 'no other account hides under Settings');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the paired installed app keeps notifications: its key and address go over the link', async () => {
  // Last in the file on purpose: setLink below stays set for the process, and nothing follows.
  const calls: string[] = [];
  setTransport((method, path) => { calls.push(`${method} ${path}`); return Promise.resolve({ vapid: 'BFx-key', relayStatus: 'online' }); });
  assert.deepEqual(await api.pushKey(), { vapid: 'BFx-key', ready: true }, 'on the computer itself, the key comes from the Phones screen\'s own call');
  setLink({ name: 'your computer', call: (method, path) => { calls.push(`${method} ${path}`); return Promise.resolve({ ok: true, vapid: 'BFx-key', online: true }); },
    subscribe: () => () => {}, desktop: (() => ({})) as any, unpair: async () => {} });
  assert.deepEqual(await api.pushKey(), { vapid: 'BFx-key', ready: true });
  assert.deepEqual(calls, ['GET /api/phones/link', 'POST /api/push'], 'paired, only the one op crewd answers for the calling device');
  await api.push({ web: { endpoint: 'https://fcm.example/ipad', keys: {} } });
  assert.deepEqual(calls.at(-1), 'POST /api/push', 'the address goes back the same way');
});
