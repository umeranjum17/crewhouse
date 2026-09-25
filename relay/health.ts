// Is the relay up? `node relay/health.ts [base url]`: exits 0 when its /health says ok. The Dockerfile's HEALTHCHECK
// runs it; point it at the public address (e.g. https://relay.example) to check through TLS as well.
const base = process.argv[2] || `http://127.0.0.1:${process.env.PORT || 7300}`;
try {
  const res = await fetch(new URL('/health', base), { signal: AbortSignal.timeout(5000) });
  const body = await res.json() as { ok?: boolean };
  if (!res.ok || body.ok !== true) throw new Error(`status ${res.status}`);
  console.log(`relay ok: ${base}`);
} catch (e: any) {
  console.error(`relay not ok: ${base}: ${e.message}`);
  process.exit(1);
}
