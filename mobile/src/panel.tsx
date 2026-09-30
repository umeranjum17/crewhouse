// Chief's panel: what a tap on the bubble opens, over whatever app is in front (src/bubble.ts; index.ts registers it).
// It is its own screen on the phone's one link (src/link.ts), and every quick action is one the app already has: ask
// Chief (typed or spoken), answer what needs you, hand a helper a still of the screen, or open a helper's box with words
// in it. Nothing is sent that the person didn't send. `frame` is the still, when it comes back from the phone's ask.
import { useCallback, useContext, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import { api, setTransport, type Json } from '../../web/src/api.ts';
import { AskSheet, attempt, Btn, Composer, Face, look, s, ShareIn, T, Theme, Toast } from '../App';
import { closePanel, handScreen, showCrew } from './bubble';
import { connect, loadGrant, type Grant, type Status } from './link';

export function Panel({ frame }: { frame?: string }) {
  const t = look(useColorScheme() === 'dark');
  const [paired, setPaired] = useState<Grant | null | undefined>(undefined);
  useEffect(() => { loadGrant().then(setPaired, () => setPaired(null)); }, []);
  return (
    <Theme.Provider value={t}>
      <Pressable style={s.scrim} onPress={() => void closePanel()} accessibilityLabel="Close">
        <KeyboardAvoidingView behavior="padding">
          <Pressable style={[s.sheet, { backgroundColor: t.surface, paddingBottom: 28 }]} onPress={() => {}}>
            <View style={[s.grabber, { backgroundColor: t.line2 }]} />
            {paired === null ? <Unpaired /> : paired ? <Body grant={paired} frame={frame} /> : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
      <Toast />
    </Theme.Provider>
  );
}

function Unpaired() {
  return <>
    <View style={s.row}><Face who="chief" size={40} mood="hello" /><T style={[s.h2, { flex: 1 }]}>Pair this phone first</T></View>
    <T tone="ink2">Open Crewhouse and scan the code on your computer. Then I can help from here.</T>
    <Btn go big label="Open Crewhouse" onPress={() => void open('crewhouse://')} />
  </>;
}

const open = async (url: string) => { await Linking.openURL(url).catch(() => {}); await closePanel(); };

function Body({ grant, frame }: { grant: Grant; frame?: string }) {
  const t = useContext(Theme);
  const [state, setState] = useState<Json | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [asking, setAsking] = useState<A.Card | null>(null);
  const refresh = useCallback(() => { api.state().then((st) => { setState(st); showCrew(st); }).catch(() => {}); }, []);
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const held = connect(grant, () => { clearTimeout(pending); pending = setTimeout(refresh, 120); }, (st) => { setStatus(st); if (st === 'online') refresh(); });
    setTransport(held.call);
    return () => { clearTimeout(pending); held.release(); };
  }, [grant, refresh]);
  const online = status === 'online';
  const canAct = grant.device.role === 'control' && online;
  if (!state) return <View style={s.row}><Face who="chief" size={40} mood="work" /><T tone="ink2" style={{ flex: 1 }}>{status === 'offline' ? "Can't reach the home computer right now." : 'Waking the crew…'}</T></View>;
  if (frame && canAct) return <ShareIn state={state} shared={{ text: '', files: [{ path: frame, mimeType: 'image/png' }] }} go={() => void closePanel()} onDone={() => void closePanel()} />;
  const chief = online ? A.chief(state) : { mood: 'rest' as const, line: "Can't reach the home computer right now" };
  const needs = A.needsYou(state);
  const crew = A.crew(state);
  const actions = A.quick(state, canAct).filter((a) => a.id !== 'needs' && a.id !== 'ask'); // those two are the list and the box
  const toChief = async (text: string, photos: { type: string; data: string }[]) => {
    const ok = await attempt(() => api.post('chief', text, photos.map(({ type, data }) => ({ type, data }))), undefined, true);
    if (ok) await open('crewhouse://ask'); // his chat, where the answer lands
    return ok;
  };
  return <>
    <View style={s.row}>
      <Face who="chief" size={40} mood={chief.mood} />
      <View style={{ flex: 1 }}><T style={s.h2}>Chief</T><T tone="ink2" style={s.small} lines={2}>{chief.line}</T></View>
      <Btn label="Open Crewhouse" onPress={() => void open('crewhouse://')} />
    </View>
    <View style={{ gap: 12 }}>
      {needs.length > 0 && <View style={[s.listGroup, { backgroundColor: t.solid, borderColor: t.line }]}>
        {needs.slice(0, 3).map((c, i) => <Pressable key={c.id} onPress={() => setAsking(c)} accessibilityRole="button" accessibilityLabel={c.head}
          style={[s.listRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
          <Face who={crew.find((h) => h.id === c.helper) ?? 'chief'} size={32} />
          <View style={{ flex: 1 }}><T style={s.rowTitle} lines={1}>{c.head}</T><T tone="ink2" style={s.small} lines={1}>{c.words}</T></View>
          <T tone="mute">›</T>
        </Pressable>)}
        {needs.length > 3 && <Btn ghost label={`See all ${needs.length}`} onPress={() => void open('crewhouse://needs')} />}
      </View>}
      {actions.length > 0 && <View style={s.chips}>{actions.map((a) =>
        <Btn key={a.id} label={a.label} onPress={() => void (a.id === 'screen' ? handScreen() : open(a.url))} />)}</View>}
    </View>
    {canAct ? <Composer placeholder="Ask Chief anything" onSend={toChief} chat="chief" />
      : <T tone="mute" style={s.small}>{online ? "This phone watches the crew; it can't send messages." : 'You can ask once the home computer is back.'}</T>}
    {asking && <AskSheet c={asking} who={crew.find((h) => h.id === asking.helper)} chiefSays={state.asks.find((x: Json) => x.id === asking.id)?.detail?.chief}
      canAct={canAct} onClose={() => { setAsking(null); refresh(); }} />}
  </>;
}
