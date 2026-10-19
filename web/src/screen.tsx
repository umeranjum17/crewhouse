// A bot's own desktop, live through desklink: Watch, Take control, Hand it back (plan 3, section 3.15).
import { useEffect, useRef, useState } from 'react';
import { CONTROL_PERMISSIONS, DesktopView, useDesktopSession } from '@desklink/react-native';
import { api, desktopSignaling, type Json } from './api.ts';
import * as A from './adapter.ts';
import { attempt, Icon, Pill, SiteIcon } from './parts.tsx';

const STATUS: Record<string, string> = {
  idle: 'Not watching', opening: 'Opening…', connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', ended: 'Stopped', failed: "Couldn't open it",
};

/** One plain line for a screen that would not open. desklink's own failure text is diagnostic, never shown; a path
 *  that never formed ('never-connected') will not reopen itself, so say what to check instead of "try again". */
const failWords = (name: string, code?: string) => code === 'never-connected'
  ? `This device can't reach ${name}'s computer directly. Bring it onto the home Wi-Fi, then try again.`
  : `Couldn't open ${name}'s screen. Try again in a moment.`;

/** One live session on a bot's screen, with input on while the person holds the wheel. */
function useBotScreen(bot: Json, control: boolean, setErr: (e: string) => void) {
  const controlRef = useRef(control);
  controlRef.current = control;
  const signaling = useRef<ReturnType<typeof desktopSignaling> | null>(null);
  const session = useDesktopSession({
    authorize: async () => {
      signaling.current?.close();
      signaling.current = desktopSignaling(bot.id);
      return { signaling: signaling.current, session: { permissions: controlRef.current ? CONTROL_PERMISSIONS : ['view'], maxFps: 15 } };
    },
    onError: (fail) => setErr(failWords(bot.display, fail.code)),
  });
  // Input is per session (closing one turns it off), so it is switched on after each connect.
  const open = () => session.connect().then(() => session.setInputEnabled(controlRef.current));
  useEffect(() => () => { void session.close(); signaling.current?.close(); }, []);
  return { session, open, stop: () => session.close().then(() => signaling.current?.close()) };
}

/** Chief's profile: a live, watch-only look at the crew's computer, open while it is on screen. */
export function ScreenPeek({ bot, who }: { bot: Json; who: string }) {
  const [err, setErr] = useState('');
  const { session, open } = useBotScreen(bot, false, setErr);
  useEffect(() => { void open(); }, []);
  const live = session.snapshot.status;
  return <>
    <div className="peek-head"><span className={`peek-live${live === 'live' ? ' on' : ''}`}>{live === 'live' ? 'Live' : STATUS[live] ?? 'Opening…'}</span><span className="mute small">{who}</span></div>
    <DesktopView sessionId={session.nativeId} style={{ width: '100%', aspectRatio: '1280 / 800', borderRadius: 12 }} accessibilityLabel={`${bot.display}'s screen`}
      placeholder={<div className="screen-idle">{err || STATUS[live] || 'Opening…'}</div>} />
  </>;
}

/** A helper's sign-in ask, answered (J8): the helper's screen over the whole window, already driving, the site on top
 *  and one Done. Done hands the wheel back and the helper carries on by itself; a note is optional. */
export function SiteSignIn({ c, bot, onClose }: { c: A.Card; bot: Json; onClose: () => void }) {
  const site = c.site!;
  const [err, setErr] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [driving, setDriving] = useState(false), [failed, setFailed] = useState(false);
  const { session, open } = useBotScreen(bot, driving, setErr);
  useEffect(() => { void attempt(() => api.takeOver(site.bot)).then((ok) => (ok ? setDriving(true) : setFailed(true))); }, [site.bot]);
  useEffect(() => { if (driving) void open(); }, [driving]);
  const done = async () => { if (await attempt(() => api.giveBack(site.bot, note ?? ''))) onClose(); };
  return (
    <div className="signin-full" role="dialog" aria-modal="true" aria-label={c.head}>
      <header className="signin-bar">
        <SiteIcon site={site} />
        <div className="grow"><b>{c.head}</b><span className="small">{driving ? <>You're driving {bot.display}'s screen. Sign in as you always do.<span className="phone-only"> Pinch to zoom in.</span></> : failed ? `${bot.display}'s screen didn't open.` : 'Opening…'}</span></div>
        {failed ? <button className="btn" onClick={onClose}>Back</button> : <button className="btn go" disabled={!driving} onClick={() => void done()}>Done</button>}
      </header>
      {/* desklink types through its own hidden textarea; a tap on the picture must focus it, or keys never reach the bot's desktop.
          A tap, not every touch: a pinch or a pan would raise the phone's keyboard over the picture it is zooming. */}
      <div className="signin-stage" onClick={() => session.showKeyboard()}>
        <DesktopView sessionId={session.nativeId} style={{ width: '100%', height: '100%' }} accessibilityLabel={`${bot.display}'s screen`}
          placeholder={<div className="screen-idle">{driving && session.snapshot.status !== 'idle' ? STATUS[session.snapshot.status] : 'Opening…'}</div>} />
      </div>
      <footer className="signin-foot">
        {err && <span className="nudge-line">{err}</span>}
        {note === null ? <button className="link" onClick={() => setNote('')}>Add a note</button>
          : <input className="input grow" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Anything ${bot.display} should know? Never a password.`} />}
      </footer>
    </div>
  );
}

export function Screen({ bot, refresh, showing }: { bot: Json; refresh: () => void; showing?: { words: string } | null }) {
  const control = bot.controls === 'person';
  const watching = useRef(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [what, setWhat] = useState<string | null>(null); // "Show Reel how": what it is, before the recorder starts
  // The give-back sheet's ticks: the hosts crewd read off its own tabs while the wheel is held — never what the bot
  // or the note claims. The tab on screen comes first and starts ticked; the rest start clear.
  const [tabs, setTabs] = useState<string[]>([]);
  const [keep, setKeep] = useState<string[]>([]);
  useEffect(() => {
    if (!control) { setTabs([]); setKeep([]); return; }
    let on = true;
    api.pages(bot.id).then((p) => { if (on) { setTabs(p); setKeep(A.signTicks(p)); } }).catch(() => { if (on) setTabs([]); });
    return () => { on = false; };
  }, [control, bot.id]);

  const { session, open, stop: close } = useBotScreen(bot, control, setErr);
  // Who holds the controls decides the permissions, so a change re-opens the session with the new ones. Holding the
  // controls always shows the screen: Take control on Chief's profile lands here already holding them.
  useEffect(() => {
    if (watching.current || control) { watching.current = true; void session.close().then(open); }
  }, [control]);

  const watch = () => { setErr(''); watching.current = true; void open(); };
  const stop = () => { watching.current = false; void close(); };
  const act = (fn: () => Promise<unknown>) => async () => { setErr(''); if (await attempt(fn)) refresh(); };

  const live = session.snapshot.status;
  const idle = live === 'idle' || live === 'ended' || live === 'failed';
  return (
    <div className="card screen">
      <div className="row">
        <b className="grow screen-h">{bot.display}'s screen</b>
        <Pill tone={live === 'live' ? 'ok' : 'off'}>{control ? 'You have control' : STATUS[live] ?? 'Opening…'}</Pill>
      </div>
      {control && <p className="screen-hand"><Icon name="hand" size={22} />{bot.display} is paused until you hand it back.</p>}
      {/* desklink types through its own hidden textarea; a tap on the picture must focus it (a tap, not a pinch), or keys never reach the bot's desktop. */}
      <div className={control ? 'screen-held' : undefined} onClick={() => { if (control) session.showKeyboard(); }}>
        <DesktopView
          sessionId={session.nativeId}
          style={{ width: '100%', aspectRatio: '1280 / 800', borderRadius: 16 }}
          accessibilityLabel={`${bot.display}'s screen`}
          placeholder={<div className="screen-idle">{idle ? `Watch ${bot.display} work on its own computer` : STATUS[live]}</div>}
        />
      </div>
      {err && <p className="nudge-line">{err}</p>}
      {!control && <p className="screen-hand"><Icon name="hand" size={22} />While you have control, {bot.display} waits.</p>}
      {!control && <div className="btns screen-btns">
        {idle ? <button className="btn go" onClick={watch}>Watch {bot.display}</button> : <button className="btn soft" onClick={stop}>Stop watching</button>}
        <button className="btn" onClick={act(async () => { await api.takeOver(bot.id); watching.current = true; })}>Take control</button>
        {what === null && <button className="btn" onClick={() => setWhat('')}>Show {bot.display} how</button>}
      </div>}
      {what !== null && !control && (
        <form className="hand-back" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.show(bot.id, what); setWhat(null); watching.current = true; if (idle) watch(); })(); }}>
          <input className="input grow" autoFocus value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What are you showing? For example: pull the newsletter stats" />
          <button className="btn go" disabled={!what.trim()}>Start</button>
          <button type="button" className="btn ghost" onClick={() => setWhat(null)}>Cancel</button>
        </form>
      )}
      {showing && (
        <div className="card nudge row"><span className="grow">{showing.words} I write down where you go and what you click, never what you type.</span>
          <button className="btn go" onClick={act(() => api.shown(bot.id, true))}>Done showing</button>
          <button className="btn ghost" onClick={act(() => api.shown(bot.id, false))}>Cancel</button></div>
      )}
      {control && !showing && (
        <form className="hand-back" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.giveBack(bot.id, note, keep); setNote(''); })(); }}>
          <input className="input grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Anything ${bot.display} should know?`} aria-label={`A note for ${bot.display}`} />
          <button className="btn go big">Hand it back</button>
        </form>
      )}
      {control && !showing && tabs.length > 0 && (
        <div className="card list">
          {tabs.map((h) => (
            <label key={h} className="row-item">
              <input type="checkbox" checked={keep.includes(h)} aria-label={A.signTick(bot.display, h)}
                onChange={(e) => setKeep(e.target.checked ? [...keep, h] : keep.filter((x) => x !== h))} />
              <span className="grow">{A.signTick(bot.display, h)}</span>
            </label>
          ))}
        </div>
      )}
      <p className="mute small">{control ? `${bot.display} picks up where it left off, and reads your note.` : `${bot.display} has its own computer at home, separate from yours. Taking control pauses it; handing it back lets it carry on.`}</p>
    </div>
  );
}
