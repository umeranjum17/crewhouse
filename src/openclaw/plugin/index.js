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
      name, description: `Crewhouse ${name.slice(5).replaceAll('_', ' ')}. The person sees the result in their crew.`,
      parameters: name === 'crew_report'
        ? { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
        : { type: 'object', additionalProperties: true },
      async execute(_id, params) {
        const { __crewhouse_run: key, __crewhouse_permit: permit, ...input } = params;
        if (!key || !permit) throw new Error('Missing Crewhouse permission');
        const result = await relay({ kind: 'call', key, permit, tool: name, input });
        if (typeof result.text !== 'string') throw new Error('Crewhouse refused the call');
        return { content: [{ type: 'text', text: result.text }] };
      },
    });
  },
};
