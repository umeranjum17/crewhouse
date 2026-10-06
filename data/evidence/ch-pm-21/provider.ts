// A lane's stand-in app for ch-pm-21: a real OAuth 2.1 + remote MCP server on loopback, with a real consent page and a
// real notes store. It stands in for Pocket Notes (a person's notes app) so the product's own Connect flow, callback,
// first use and proof can be driven end to end without anyone's account.
import { createServer } from 'node:http';

export type Lab = { base: string; notes: { title: string; body: string }[]; calls: string[]; close: () => Promise<void> };

export async function standIn(): Promise<Lab> {
  const notes = [{ title: 'Swimming lesson', body: 'Tuesdays 5pm, bring the goggles.' }, { title: 'Library card', body: 'Renews in March.' }];
  const calls: string[] = [];
  const tokens = new Map<string, { refresh: string }>();
  let n = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = (x: unknown, status = 200, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(x)); };
    const page = (html: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset=utf-8><title>Pocket Notes</title><style>body{font:16px/1.5 system-ui;margin:12vh auto;max-width:30rem;padding:0 1.5rem;color:#1b1b1f;background:#fbfbfd}h1{font-size:1.4rem}a.Allow{display:inline-block;padding:.7rem 1.2rem;border-radius:10px;background:#2e2a40;color:#fff;text-decoration:none}</style>${html}`); };
    const url = new URL(req.url!, 'http://x');
    const p = url.pathname;
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];

    if (p === '/lane-log') return json({ calls, notes });   // the lane's own log of what this app actually served
    if (p === '/.well-known/oauth-protected-resource/mcp' || p === '/.well-known/oauth-protected-resource') return json({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['notes'] });
    if (p === '/.well-known/oauth-authorization-server') return json({ issuer: base, code_challenge_methods_supported: ['S256'], authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register` });
    if (p === '/register') return json({ client_id: 'crewhouse-pocket', client_name: 'Crewhouse' }, 201);
    // The app's own consent page, as a person meets it: what it is asking for, and one Allow.
    if (p === '/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri')!, base);
      back.searchParams.set('code', 'the-code'); back.searchParams.set('state', url.searchParams.get('state') ?? '');
      page(`<h1>Pocket Notes</h1><p>Crewhouse is asking to read your notes and add new ones.</p><p>Your password stays here. Nothing is sent anywhere else.</p><a class="Allow" href="${back.href}">Allow</a>`);
      return;
    }
    if (p === '/token') {
      const f = Object.fromEntries(new URLSearchParams(body));
      if (f.grant_type === 'authorization_code') { const t = `pn${++n}`; tokens.set(t, { refresh: 'R1' }); return json({ access_token: t, token_type: 'Bearer', refresh_token: 'R1', expires_in: 3600 }); }
      if (f.grant_type === 'refresh_token' && tokens.get(bearer ?? '')?.refresh === f.refresh_token) return json({ access_token: bearer, token_type: 'Bearer', expires_in: 3600 });
      return json({ error: 'invalid_grant' }, 400);
    }
    if (p === '/mcp') {
      if (!bearer || !tokens.has(bearer)) { res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }); return res.end(); }
      if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
      if (!body) { res.writeHead(405); return res.end(); }
      const m = JSON.parse(body);
      const ok = (result: unknown) => json({ jsonrpc: '2.0', id: m.id, result });
      if (m.method === 'initialize') return ok({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Pocket Notes', version: '1' } });
      if (m.method === 'tools/list' && url.searchParams.get('silent')) return json({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'nothing for you' } }, 500);
      if (m.method === 'tools/list') return ok({ tools: [
        { name: 'search-notes', title: 'search your notes', description: "Find the person's notes by a word.", inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }, annotations: { readOnlyHint: true } },
        { name: 'add-note', title: 'add a note', description: 'Write a new note.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] } },
      ] });
      if (m.method === 'tools/call') {
        calls.push(m.params.name);
        if (m.params.name === 'add-note') notes.unshift({ title: String(m.params.arguments.title), body: String(m.params.arguments.body ?? '') });
        const found = m.params.name === 'search-notes'
          ? notes.filter((x) => `${x.title} ${x.body}`.toLowerCase().includes(String(m.params.arguments.q ?? '').toLowerCase()))
          : notes;
        return ok({ content: [{ type: 'text', text: found.map((x) => `${x.title}: ${x.body}`).join('\n') || 'nothing found' }] });
      }
      res.writeHead(202); return res.end();
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, notes, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}
