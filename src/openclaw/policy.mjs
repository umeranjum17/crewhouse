// Crewhouse's operator install policy (OpenClaw security.installPolicy, protocol 1). Reads one staged-install request
// on stdin, answers with one decision. Only what this file trusts passes; everything else — ClawHub, Git, uploads,
// dependency installers — is blocked by name. Any error fails closed: the answer is block.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const trusted = JSON.parse(readFileSync(join(here, 'trusted-skills.json'), 'utf8'));
const block = (reason) => process.stdout.write(JSON.stringify({ protocolVersion: 1, decision: 'block', reason: String(reason).slice(0, 1000) }));

// Crewhouse's own content: the repo's shipped skills, the bots' skill folders and this plugin directory. Anything the
// household wrote themselves never needs the list.
const OWN_ROOTS = [resolve(here, '../..'), process.env.CREWHOUSE_CREW_DIR].filter(Boolean);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const req = JSON.parse(raw);
    if (req.protocolVersion !== 1) return block('unknown policy protocol');
    const sourcePath = req.sourcePath ? resolve(req.sourcePath) : '';
    if (sourcePath && OWN_ROOTS.some((root) => sourcePath === root || sourcePath.startsWith(root + sep))) {
      // crewhouse's own space — but only as plain skill content, never an installer of more.
      if ((req.request?.kind ?? '').includes('depend')) return block('Crewhouse does not run skill dependency installers');
      return process.stdout.write(JSON.stringify({ protocolVersion: 1, decision: 'allow' }));
    }
    if ((req.request?.kind ?? '').includes('depend')) return block('Crewhouse does not run skill dependency installers');
    // The reserved @openclaw scope (bundled plugin repairs, official releases) is trusted by provenance: the
    // registry's attestation plus the pin's own integrity cover it (spec §5.2). Nothing else from ClawHub passes.
    const officialPackage = req.origin?.packageName === 'string' && req.origin.packageName.startsWith('@openclaw/')
      || typeof req.origin?.slug === 'string' && req.origin.slug.startsWith('@openclaw/')
      || typeof req.request?.requestedSpecifier === 'string' && req.request.requestedSpecifier.startsWith('@openclaw/');
    if (officialPackage) {
      return process.stdout.write(JSON.stringify({ protocolVersion: 1, decision: 'allow' }));
    }
    // A ClawHub/Git/uploaded skill passes only with an exact entry: id, version and content hash all matching.
    const id = req.targetName ?? req.origin?.slug;
    const version = req.origin?.version;
    const entry = trusted.entries.find((e) => e.source === 'bundled' && e.id === id && (!version || e.version === version));
    if (!entry) return block('not on Crewhouse\'s trusted list');
    const skillMd = req.sourcePathKind === 'directory' ? join(sourcePath, 'SKILL.md') : sourcePath;
    let sha = '';
    try { sha = createHash('sha256').update(readFileSync(skillMd)).digest('hex'); } catch { /* unreadable: not trusted */ }
    if (sha !== entry.sha256) return block('not on Crewhouse\'s trusted list');
    return process.stdout.write(JSON.stringify({ protocolVersion: 1, decision: 'allow' }));
  } catch {
    block('Crewhouse could not read the install request');
  }
});
