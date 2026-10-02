import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// Render the real shared sheet (also used by the phone) without making an account request or opening a browser.
test('the shared sign-in sheet reserves ChatGPT instructions for ChatGPT', async () => {
  const dir = mkdtempSync(join(process.cwd(), 'test/.signin-copy-'));
  try {
    await build({ entryPoints: ['web/src/flows.tsx'], outfile: join(dir, 'flows.mjs'), bundle: true,
      platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'ssr-portal', setup(b) {
        b.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'test' }));
        b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const createPortal = (children) => children;', loader: 'js' }));
      } }],
    });
    const names = ['ChatGPT', 'Grok', 'GitHub Copilot', 'OpenRouter', 'MiniMax', 'Claude'];
    for (const phase of ['opening', 'waiting', 'code', 'done', 'work', 'busy', 'cancelled', 'expired', 'failed', 'offline']) {
      (globalThis as any).location = { search: `?demo&phase=${phase}` };
      (globalThis as any).document = { body: {} };
      const { SignIn } = await import(`${join(dir, 'flows.mjs')}?${phase}`);
      for (const name of names) {
        // The demo pin bypasses live requests; each provider is selected via the component's real ai prop.
        const html = renderToStaticMarkup(createElement(SignIn, { me: 1, owner: 'Owner', ai: { key: name === 'ChatGPT' ? 'chatgpt' : name === 'GitHub Copilot' ? 'copilot' : name.toLowerCase(), name }, onReady() {}, onClose() {} }));
        assert.match(html, new RegExp(`Sign in with ${name}`));
        const words = html.replace(/<[^>]*>/g, '');
        assert.doesNotMatch(words, /Codex|device code|engine|Settings.*Security|ChatGPT signed in/i, `${phase}: ${name}`);
        assert.equal(html.includes('Open ChatGPT settings'), phase === 'code' && name === 'ChatGPT');
        if (phase === 'waiting' || phase === 'busy') assert.equal(html.includes('Use a code instead'), name === 'ChatGPT');
        if (phase === 'busy') {
          assert.match(html, /Another sign-in is already in progress/);
          assert.doesNotMatch(html, /signing in to/);
        }
      }
    }
  } finally { delete (globalThis as any).location; delete (globalThis as any).document; rmSync(dir, { recursive: true, force: true }); }
});
