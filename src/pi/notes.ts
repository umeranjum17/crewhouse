// The `notes` tool on Pi, in the reviewed set (extensions.json): a bot's own memory between turns. Pi starts in the bot's own folder, so the file is <state>/pi/<bot>/work/notes.md, and no input names a path: this code reaches that one file and nothing else. Plain markdown, one `- ` line per note, CAP bytes at most. A person's memory switch is honoured by runtime.ts, which then leaves this tool out.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';

const CAP = 8192, say = (text: string, isError = false) => ({ content: [{ type: 'text', text }], details: {}, isError });

export default function (pi: { registerTool(tool: object): void }) {
  pi.registerTool({
    name: 'notes', label: 'Notes',
    description: `Your own notes, kept between jobs, and not the notes your prompt shows you. Read them only when the person asks about an earlier job. Add one short line only when the person asks you to keep something. One call is enough, then answer. They hold ${CAP} bytes, and only you can see them.`,
    parameters: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['read', 'add', 'forget'] }, text: { type: 'string', description: 'add: the note, one short line. forget: words of the notes to drop.' } } },
    async execute(_call: string, { action, text = '' }: { action: string; text?: string }, _signal: unknown, _update: unknown, { cwd }: { cwd: string }) {
      const file = join(cwd, 'notes.md'), had = existsSync(file) ? readFileSync(file, 'utf8') : '', words = text.replace(/\s+/g, ' ').trim();
      if (action === 'read') return say(had || 'You have no notes yet.');
      if (!words) return say(`Nothing was done: ${action} needs text.`, true);
      if (action === 'add') {
        const line = `- ${words}\n`, used = Buffer.byteLength(had), need = Buffer.byteLength(line);
        if (used + need > CAP) return say(`Your notes are full: ${used} of ${CAP} bytes are used and this note needs ${need}, so it was not saved. Forget something first.`, true);
        appendFileSync(file, line, { mode: 0o600 });
        return say(`Saved. ${used + need} of ${CAP} bytes used.`);
      }
      const lines = had.split('\n').filter(Boolean), kept = lines.filter((l) => !l.toLowerCase().includes(words.toLowerCase()));
      if (kept.length === lines.length) return say('No note has those words, so nothing was dropped.', true);
      writeFileSync(`${file}.new`, kept.map((l) => `${l}\n`).join(''), { mode: 0o600 }); renameSync(`${file}.new`, file); // a crash mid-write leaves the old notes whole
      return say(`Dropped ${lines.length - kept.length}.`);
    },
  });
}
