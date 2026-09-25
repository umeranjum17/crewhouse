// A helper's way out to the internet, when its template names the only hosts it may reach (`net` in bot.json). Its
// sandbox then has no network at all, only a socket to this proxy: a CONNECT to a listed host goes through, anything
// else is refused with a plain 403 and reported, so an attempt is seen rather than silently dropped.
import { connect, createServer, type Server } from 'node:net';

/** An entry is a host (HTTPS, port 443) or `host:port`. */
export const allowed = (list: string[], host: string, port: number) => list.some((e) => e === `${host}:${port}` || (e === host && port === 443));

/** The proxy on a Unix socket; `refused` hears every host it turns away. */
export function proxy(sock: string, list: string[], refused: (host: string, port: number) => void): Server {
  return createServer((c) => {
    c.on('error', () => c.destroy());
    // ponytail: reads the request line from the first chunk; tools send CONNECT in one small write.
    c.once('data', (head) => {
      const line = head.toString('latin1').split('\r\n')[0];
      const m = /^CONNECT \[?([^\s\]]+?)\]?:(\d+) HTTP\/1\.[01]$/.exec(line);
      const host = (m?.[1] ?? (URL.canParse(line.split(' ')[1] ?? '') ? new URL(line.split(' ')[1]).hostname : '?')).toLowerCase().slice(0, 253);
      const port = Number(m?.[2] ?? 80);
      if (!m || !allowed(list, host, port)) {
        refused(host, port);
        return void c.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nCrewhouse: ${host} is not on this helper's list of places it may reach.\n`);
      }
      const up = connect(port, host, () => { c.write('HTTP/1.1 200 Connection established\r\n\r\n'); up.pipe(c); c.pipe(up); });
      up.on('error', () => c.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
    });
  }).listen(sock);
}

/** Inside the sandbox, on crewd's own node: the tools' proxy address on the sandbox's loopback, piped to the socket. */
export const BRIDGE = "const n=require('net');n.createServer(c=>{const u=n.connect(process.argv[1]);c.pipe(u);u.pipe(c);u.on('error',()=>c.destroy());" +
  "c.on('error',()=>u.destroy())}).listen(3128,'127.0.0.1',()=>require('fs').writeFileSync('/tmp/.crewhouse-net',''))";
