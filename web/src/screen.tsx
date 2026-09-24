// A bot's own desktop, live through desklink: Watch, Take over, Give back (plan 3, section 3.15).
import { useEffect, useRef, useState } from 'react';
import { CONTROL_PERMISSIONS, DesktopView, useDesktopSession } from '@desklink/react-native';
import { api, desktopSignaling, type Json } from './api.ts';

const STATUS: Record<string, string> = {
  idle: 'not watching', opening: 'starting…', connecting: 'connecting…', live: 'live', reconnecting: 'reconnecting…', ended: 'stopped', failed: 'could not connect',
};

export function Screen({ bot, missing, refresh }: { bot: Json; missing: string[]; refresh: () => void }) {
  const control = bot.controls === 'person';
  const controlRef = useRef(control);
  controlRef.current = control;
  const watching = useRef(false);
  const signaling = useRef<ReturnType<typeof desktopSignaling> | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const session = useDesktopSession({
    authorize: async () => {
      signaling.current?.close();
      signaling.current = desktopSignaling(bot.id);
      return { signaling: signaling.current, session: { permissions: controlRef.current ? CONTROL_PERMISSIONS : ['view'], maxFps: 15 } };
    },
    onError: (f) => setErr(f.message),
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
  const act = (fn: () => Promise<unknown>) => async () => { setErr(''); try { await fn(); refresh(); } catch (e: any) { setErr(e.message); } };

  if (!bot.computer) {
    return (
      <div className="card">
        <b>{bot.display}'s screen</b>
        <p className="muted">{bot.display} has no computer. Grant <b>Computer</b> on the Tools tab to give it its own desktop: a virtual display with its own browser, separate from yours.</p>
        {missing.length > 0 && <p className="muted small">This machine needs {missing.join('; ')}.</p>}
      </div>
    );
  }
  const live = session.snapshot.status;
  return (
    <div className="card">
      <div className="row between">
        <b>{bot.display}'s screen</b>
        <span className="muted tiny">{STATUS[live] ?? live}{bot.desktop ? ` · display ${bot.desktop.display}` : ''}{control ? ' · you have the controls' : ' · view only'}</span>
      </div>
      {control && <div className="chip amber">You have the controls. {bot.display} is paused until you give them back.</div>}
      {/* desklink types through its own hidden textarea; a click on the picture must focus it, or keys never reach the bot's desktop. */}
      <div onPointerDownCapture={() => { if (control) session.showKeyboard(); }}>
        <DesktopView
          sessionId={session.nativeId}
          style={{ width: '100%', aspectRatio: '1280 / 800', borderRadius: 10 }}
          accessibilityLabel={`${bot.display}'s screen`}
          placeholder={<div className="screen" style={{ margin: 0, height: '100%', aspectRatio: 'auto', borderRadius: 0 }}>{live === 'idle' || live === 'ended' ? `Watch ${bot.display}'s own desktop here` : STATUS[live]}</div>}
        />
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row wrap end">
        {live === 'idle' || live === 'ended' || live === 'failed'
          ? <button className="btn primary" onClick={watch}>Watch {bot.display}'s screen</button>
          : <button className="btn" onClick={stop}>Stop watching</button>}
        {!control && <button className="btn" onClick={act(async () => { await api.takeOver(bot.id); watching.current = true; })}>Take over</button>}
      </div>
      {control && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.giveBack(bot.id, note); setNote(''); })(); }}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={`What did you do? ${bot.display} reads this when it resumes`} />
          <button className="btn primary">Give back</button>
        </form>
      )}
      <p className="muted tiny">A virtual display with its own Chromium profile in {bot.display}'s folder; your own screen is never shared. Taking over pauses {bot.display}; giving back resumes its task.</p>
    </div>
  );
}
