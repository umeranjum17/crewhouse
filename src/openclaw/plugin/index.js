import { connect } from 'node:net';
import { readFileSync } from 'node:fs';

// Framed one-request-per-connection JSON. Socket paths and decisions come from crewd, not the model.
function relay(message, signal) {
  return new Promise((resolve, reject) => {
    const socket = connect(process.env.CREWHOUSE_SOCK);
    let response = '';
    const fail = (error) => { socket.destroy(); reject(error); };
    const abort = () => fail(new Error('Tool call cancelled'));
    const timeout = setTimeout(() => fail(new Error('Crewhouse gate timed out')), 195_000);
    signal?.addEventListener('abort', abort, { once: true });
    socket.once('error', fail);
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.length > 1_000_000) return fail(new Error('Gate reply too large'));
      if (response.includes('\n')) {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        socket.end();
        try { resolve(JSON.parse(response.slice(0, response.indexOf('\n')))); } catch (error) { reject(error); }
      }
    });
    socket.once('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.once('close', () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); });
  });
}

// The model-visible schemas. Names are Crewhouse's: `bash` is crewd's sandboxed shell, `browser` the bot's own browser,
// `calendar`/`mail` the two read-mostly app AXIs, `crew_app` a remote app's tools, `crew_*` the crew's own.
const SCHEMAS = {
  bash: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
  browser: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false },
  calendar: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false },
  mail: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false },
  crew_app: { type: 'object', properties: { tool: { type: 'string' }, input: { type: 'object', additionalProperties: true } }, required: ['tool'], additionalProperties: false },
  crew_remember: { type: 'object', properties: {
    text: { type: 'string', description: 'One short line stating the lasting preference to save.' },
    replaces: { type: 'string', description: 'Words of an old note this corrects, if any.' },
    everyone: { type: 'boolean', description: 'True if every helper should know it; otherwise it stays in your notes.' },
  }, required: ['text'], additionalProperties: false },
  crew_document: { type: 'object', properties: {
    name: { type: 'string', description: 'Title of the finished document.' },
    blocks: { type: 'array', description: 'Document content in order: {heading}, {text}, {bullets: [strings]} or {table: {head: [cells], rows: [[cells]]}}.',
      items: { type: 'object', additionalProperties: true }, minItems: 1 },
  }, required: ['name', 'blocks'], additionalProperties: false },
};
const ABOUT = {
  bash: 'Run a shell command in your own space (a sandbox: your folder is the only writable part of the disk). Long output is cut to the last lines.',
  browser: 'Your own browser (playwright-axi): goto <url>, snapshot, find <text>, click <ref>, fill <ref> <text>, press <key>, go-back.',
  calendar: "The person's own Google Calendar: see the day or week, find free time, add, move or cancel events, as `args`.",
  mail: "The person's own Gmail, read-only: what is new, search it, read a conversation, as `args`. It cannot send or change mail.",
  crew_app: "Use one of the person's connected apps' tools: `tool` names it (the run's prompt lists them) and `input` carries its arguments.",
  crew_remember: 'Save a lasting preference: pass {text: "one short line"}; optionally replaces and everyone. Do not save how to address the person.',
  crew_document: 'Write and deliver an editable document: pass {name: "title", blocks: [{heading: "Title"}, {text: "Paragraph"}, {bullets: ["Item"]}]}. Crewhouse writes the file; do not make it yourself.',
};

export default {
  id: 'crewhouse', name: 'Crewhouse',
  register(api) {
    api.on('before_tool_call', async (event, ctx) => {
      try {
        const decision = await relay({ kind: 'gate', key: ctx.sessionKey, tool: event.toolName, input: event.params }, ctx.abortSignal);
        if (!decision.allow) return { block: true, blockReason: decision.reason || 'The person has not approved this.' };
        if (event.toolName.startsWith('crew_'))
          return { params: { ...event.params, __crewhouse_run: ctx.sessionKey, __crewhouse_permit: decision.permit } };
        return undefined;
      } catch { return { block: true, blockReason: 'Crewhouse cannot check this action right now.' }; }
    });
    const manifest = JSON.parse(readFileSync(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
    for (const name of manifest.contracts.tools) api.registerTool({
      name,
      description: ABOUT[name] ?? `Crewhouse ${name.slice(5).replaceAll('_', ' ')}. The person sees the result in their crew.`,
      parameters: SCHEMAS[name] ?? (name === 'crew_report'
        ? { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
        : { type: 'object', additionalProperties: true }),
      async execute(_id, params) {
        const { __crewhouse_run: key, __crewhouse_permit: permit, ...input } = params;
        // crew_* tools carry a one-use permit from their gate; crewd's own tools were gated by the hook just now.
        if (name.startsWith('crew_') && (!key || !permit)) throw new Error('Missing Crewhouse permission');
        const result = await relay({ kind: 'call', key, permit, tool: name, input });
        if (typeof result.text !== 'string') throw new Error('Crewhouse refused the call');
        return { content: [{ type: 'text', text: result.text }] };
      },
    });
  },
};
