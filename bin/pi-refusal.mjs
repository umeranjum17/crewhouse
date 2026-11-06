// The words a bot on Pi reads when bubblewrap stops it: a Pi extension, loaded for every bot, that runs inside the wall with its folder as the
// working directory. It refuses nothing: the call really runs and really fails, so the wall holds with or without this file. The path says
// what happened, not the error: a target whose parent the wall leaves out fails with ENOENT, one it shows read-only with EROFS.
import { resolve } from 'node:path';

const LINE = "That's outside my folder, so I can't open it.";
export default (pi) => pi.on('tool_result', ({ isError, input }) => isError && typeof input?.path === 'string' && !`${resolve(input.path)}/`.startsWith(`${process.cwd()}/`) ? { content: [{ type: 'text', text: LINE }] } : undefined);
