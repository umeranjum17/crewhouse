// Motion proof for one interaction: a CDP screencast of the page the browser tool
// is already driving, written to a single .webm with real frame timing.
//
//   CHROME_DEVTOOLS_AXI_CHROME_ARGS="--remote-debugging-port=$CDP_PORT" chrome-devtools-axi open "$URL"
//   node scripts/record.mjs --cdp "$CDP_PORT" --out "$EV/motion/chat-send.webm" --seconds 8 &
//   chrome-devtools-axi click @e3      # the interaction being proved, while it records
//   wait                                  # then read the printed summary; non-zero exit on failure
//
// --match <substring> picks the page when the browser holds several; the default is
// the first http(s) target, which is the app under proof. --frames-to-lead keeps a
// moment of the screen before the interaction starts.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? fallback : process.argv[i + 1]
}
const cdp = Number(arg('cdp', process.env.CDP_PORT ?? 0))
const out = arg('out', '')
const seconds = Number(arg('seconds', 8))
const match = arg('match', '')
const quality = Number(arg('quality', 80))
const maxWidth = Number(arg('max-width', 1440))
if (!cdp || !out) {
  console.error('usage: record.mjs --cdp <port> --out <file.webm> [--seconds 8] [--match <url substring>]')
  process.exit(2)
}

const targets = await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()
if (!Array.isArray(targets)) {
  console.error(`port ${cdp} is not a Chrome debugging port (${Object.keys(targets).join(', ')}): it is probably the bridge port — give --remote-debugging-port a port of its own`)
  process.exit(2)
}
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && (!match || t.url.includes(match)))
  ?? targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url.startsWith('http'))
if (!page) {
  console.error(`no page target on cdp ${cdp}${match ? ` matching ${match}` : ''}: ${targets.map((t) => t.url).join(', ')}`)
  process.exit(2)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
const dir = mkdtempSync(join(tmpdir(), 'ch-record.'))
const frames = []
let sendId = 0
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++sendId, method, params }))
const stop = (code) => {
  if (ws.readyState === WebSocket.OPEN) send('Page.stopScreencast')
  ws.close()
  rmSync(dir, { recursive: true, force: true })
  process.exit(code)
}

await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error(`cannot attach to ${page.webSocketDebuggerUrl}`))
})
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.method !== 'Page.screencastFrame') return
  frames.push({ t: msg.params.metadata.timestamp, jpeg: Buffer.from(msg.params.data, 'base64') })
  send('Page.screencastFrameAck', { sessionId: msg.params.sessionId })
}
send('Page.startScreencast', { format: 'jpeg', quality, maxWidth, everyNthFrame: 1 })
console.error(`recording ${page.url} for up to ${seconds}s — drive the interaction now`)
process.on('SIGINT', () => stop(0))

// Wait out the capture window rather than the first frame: an interaction that
// starts before the first frame would record a jump cut. This wait is the clock —
// a second timer would race it and exit with nothing written.
await new Promise((r) => setTimeout(r, seconds * 1000))
send('Page.stopScreencast')
ws.close()
if (frames.length < 2) {
  rmSync(dir, { recursive: true, force: true })
  console.error(`only ${frames.length} screencast frame(s): nothing moved, or the page is not the one under proof`)
  process.exit(1)
}

// Real durations from the frame timestamps: a constant framerate would play a
// slow capture back fast and time the motion wrongly.
const list = frames.map((f, i) => {
  writeFileSync(join(dir, `${String(i).padStart(5, '0')}.jpg`), f.jpeg)
  const next = frames[i + 1]?.t ?? f.t + 0.25
  return `file '${String(i).padStart(5, '0')}.jpg'\nduration ${(next - f.t).toFixed(4)}`
}).join('\n')
const last = String(frames.length - 1).padStart(5, '0')
writeFileSync(join(dir, 'frames.txt'), `${list}\nfile '${last}.jpg'\n`)
mkdirSync(dirname(out), { recursive: true })
const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' })
rmSync(dir, { recursive: true, force: true })
if (ff.status !== 0) {
  console.error(`ffmpeg failed: ${ff.stderr.trim()}`)
  process.exit(1)
}
// A screencast only sends a frame when the page paints, so the span below is first
// to last paint: the leading lead-in and the trailing idle are trimmed, and a static
// screen yields one frame (caught above).
const span = (frames.at(-1).t - frames[0].t).toFixed(1)
console.log(`${out}  ${frames.length} frames, ${span}s first paint to last of ${page.url}`)
