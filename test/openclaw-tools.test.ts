import assert from 'node:assert/strict';
import { test } from 'node:test';
// Plugin is runtime JavaScript loaded by the pinned Gateway, not part of tsc's sources.
// @ts-expect-error No declaration for the Gateway plugin.
import plugin from '../src/openclaw/plugin/index.js';

test('model-visible crew tools tell the model the required arguments', () => {
  const tools = new Map<string, { description: string; parameters: any }>();
  plugin.register({ on() {}, registerTool(tool: any) { tools.set(tool.name, tool); } } as any);
  const remember = tools.get('crew_remember')!;
  assert.deepEqual(remember.parameters.required, ['text']);
  assert.equal(remember.parameters.properties.text.type, 'string');
  assert.match(remember.description, /text/);
  const document = tools.get('crew_document')!;
  assert.deepEqual(document.parameters.required, ['name', 'blocks']);
  assert.equal(document.parameters.properties.blocks.type, 'array');
  assert.match(document.description, /blocks/);
});
