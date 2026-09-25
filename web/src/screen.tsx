// A bot's own desktop, live through desklink: Watch, Take over, Give back (plan 3, section 3.15).
import { useEffect, useRef, useState } from 'react';
import { CONTROL_PERMISSIONS, DesktopView, useDesktopSession } from '@desklink/react-native';
import { api, desktopSignaling, type Json } from './api.ts';
import { attempt, Pill } from './parts.tsx';

const STATUS: Record<string, string> = {
  idle: 'Not watching', opening: 'Opening…', connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', ended: 'Stopped', failed: "Couldn't open it",
};

export function Screen({ bot, refresh, showing }: { bot: Json; refresh: () => void; showing?: { words: string } | null }) {
  const control = bot.controls === 'person';
  const controlRef = useRef(control);
  controlRef.current = control;
  const watching = useRef(false);
  const signaling = useRef<ReturnType<typeof desktopSignaling> | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [what, setWhat] = useState<string | null>(null); // "Show Reel how": what it is, before the recorder starts

  const session = useDesktopSession({
    authorize: async () => {
      signaling.current?.close();
      signaling.current = desktopSignaling(bot.id);
      return { signaling: signaling.current, session: { permissions: controlRef.current ? CONTROL_PERMISSIONS : ['view'], maxFps: 15 } };
    },
    onError: () => setErr(`Couldn't open ${bot.display}'s screen. Try again in a moment.`),
  });

  // Input is per session (closing one turns it off), so it is switched on after each connect.
  const open = () => session.connect().then(() => session.setInputEnabled(controlRef.current));
  // Who holds the controls decides the permissions, so a change re-opens the session with the new ones.
  useEffect(() => {
    if (watching.current) void session.close().then(open);
  }, [control]);
  useEffect(() => () => { void session.close(); signaling.current?.close(); }, []);

  const watch = () => { setErr(''); watching.current = true; void open(); };
  const stop = () => { watching.current = false; void session.close().then(() => signaling.current?.close()); };
  const act = (fn: () => Promise<unknown>) => async () => { setErr(''); if (await attempt(fn)) refresh(); };

  const live = session.snapshot.status;
  const idle = live === 'idle' || live === 'ended' || live === 'failed';
  return (
    <div className="card screen">
      <div className="row">
        <b className="grow">{bot.display}'s screen</b>
        <Pill tone={live === 'live' ? 'ok' : 'off'}>{control ? 'You have the wheel' : STATUS[live] ?? 'Opening…'}</Pill>
      </div>
      {control && <p className="nudge-line">You're driving. {bot.display} waits until you hand the wheel back.</p>}
      {/* desklink types through its own hidden textarea; a click on the picture must focus it, or keys never reach the bot's desktop. */}
      <div onPointerDownCapture={() => { if (control) session.showKeyboard(); }}>
        <DesktopView
          sessionId={session.nativeId}
          style={{ width: '100%', aspectRatio: '1280 / 800', borderRadius: 16 }}
          accessibilityLabel={`${bot.display}'s screen`}
          placeholder={<div className="screen-idle">{idle ? `Watch ${bot.display} work on its own computer` : STATUS[live]}</div>}
        />
      </div>
      {err && <p className="nudge-line">{err}</p>}
      <div className="btns">
        {idle ? <button className="btn go" onClick={watch}>Watch {bot.display}</button> : <button className="btn" onClick={stop}>Stop watching</button>}
        {!control && <button className="btn" onClick={act(async () => { await api.takeOver(bot.id); watching.current = true; })}>Take the wheel</button>}
        {!control && what === null && <button className="btn" onClick={() => setWhat('')}>Show {bot.display} how</button>}
      </div>
      {what !== null && !control && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.show(bot.id, what); setWhat(null); watching.current = true; if (idle) watch(); })(); }}>
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
        <form className="row" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.giveBack(bot.id, note); setNote(''); })(); }}>
          <input className="input grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder={`What did you do? ${bot.display} reads this when it carries on`} />
          <button className="btn go">Hand it back</button>
        </form>
      )}
      <p className="mute small">{bot.display} has its own computer at home, separate from yours. Taking the wheel pauses it; handing back lets it carry on.</p>
    </div>
  );
}
