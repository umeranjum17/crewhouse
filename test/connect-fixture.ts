// A real kit sign-in against an OS-assigned loopback provider; no stored-grant shortcuts or real accounts.
import { createServer } from 'node:http';
import type { Connections } from '../src/connections.ts';

export const setUpGoogle = (connections: Connections) => connections.setHouseGoogle(`123-fixture.apps.google${'usercontent'}.com`, ['GOCSPX', 'abcdefghijklmnopqrstuvwxyz12'].join('-'));

export async function signInApp(connections: Connections, id: string, access = 'tok') {
  await connections.ready;
  if (connections.connected(id)) return;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ access_token: access, token_type: 'Bearer', expires_in: 3600, scope: connections.apps[id].scopes?.join(' ') }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await connections.ready;
    if (!connections.houseGoogle()) await setUpGoogle(connections);
    connections.apps[id] = { ...connections.apps[id], mcpUrl: undefined, oauth: { authorize: `${base}/authorize`, token: `${base}/token` } };
    const flow = await connections.connect(id);
    const callback = new URL(new URL(flow.url!).searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', new URL(flow.url!).searchParams.get('state')!);
    callback.searchParams.set('code', 'test-code');
    const words = await connections.finish(callback);
    if (!words.includes('is connected,')) throw new Error(words);
  } finally { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
}
