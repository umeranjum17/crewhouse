import { marked } from 'marked';

// Parse, never inject HTML. Renderers only display known token types; unknown/raw HTML becomes text.
export const chatTokens = (text: string) => marked.lexer(text, { gfm: true });
export const safeLink = (href: string) => {
  try { const url = new URL(href); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
};
