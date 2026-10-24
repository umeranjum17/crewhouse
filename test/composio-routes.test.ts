// Chief gets the same tools on every route. The Claude route (the Claude CLI) is offered the engine's tools only through its
// tool policy, with no code-mode catalog behind exec like MiniMax's: final-run-6 (Claude) made zero tool calls and said
// Composio was unreachable, while final-run-5 (MiniMax) had "code-mode: cataloged 35 tools behind exec/wait". Runs on the kit's fake Gateway.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { faked } from './kit-fake.ts';

const recorded = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as { kind: string, data: { account?: string, tool?: string } }[];

test('the Claude route and the MiniMax route are offered the same tools, Composio included', async () => {
  const minimax = recorded('connect-apps-run5-events.json'), claude = recorded('connect-apps-run6-events.json');
  assert.equal(minimax.find((e) => e.kind === 'run.started')!.data.account, 'minimax');
  assert.equal(claude.find((e) => e.kind === 'run.started')!.data.account, 'claude');
  assert.equal(claude.filter((e) => e.kind === 'run.call').length, 0, 'the recorded Claude turn was offered nothing it could call');
  const lab = faked();
  try {
    await lab.started;
    const { tools } = JSON.parse(readFileSync(join(lab.state, 'openclaw/openclaw.json'), 'utf8')) as { tools: { alsoAllow: string[], deny: string[] } };
    // MiniMax also reaches Composio through the code-mode catalog; the Claude CLI only through this policy, so the policy must admit it.
    for (const tool of ['crew_connect', 'crew_status']) assert.ok(tools.alsoAllow.includes(tool), tool);
    assert.ok(tools.alsoAllow.includes('bundle-mcp'), 'MCP tools are admitted by the engine policy, not only through code mode');
    assert.ok(!tools.deny.some((d) => ['bundle-mcp', 'group:plugins'].includes(d)));
  } finally { await lab.done(); }
});
