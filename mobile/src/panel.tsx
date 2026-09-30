// Chief's panel: what a tap on the bubble opens, over whatever app is in front (src/bubble.ts; index.ts registers it).
// It is its own screen on the phone's one link (src/link.ts), and every quick action is one the app already has: ask
// Chief (typed or spoken), answer what needs you, hand a helper a still of the screen, open a helper's box with words
// in it, or Write it here: the writer drafts for the box the person was typing in, and Put it in fills that box.
// Nothing is sent that the person didn't send. `frame` is the still, when it comes back from the phone's ask.
import { useCallback, useContext, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, useColorScheme, View } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import { api, setTransport, type Json } from '../../web/src/api.ts';
import { AskSheet, attempt, Btn, Composer, Face, look, s, ShareIn, T, Theme, Toast } from '../App';
import { closePanel, handScreen, putIn, restrictedWords, showCrew, tappedBox, type Box } from './bubble';
import { connect, loadGrant, type Grant, type Status } from './link';

export function Panel({ frame }: { frame?: string }) {
  const t = look(useColorScheme() === 'dark');
  const [paired, setPaired] = useState<Grant | null | undefined>(undefined);
  const [box, setBox] = useState<Box>(null);
  useEffect(() => { loadGrant().then(setPaired, () => setPaired(null)); tappedBox().then(setBox, () => {}); }, []);
  return (
    <Theme.Provider value={t}>
      <Pressable style={s.scrim} onPress={() => void closePanel()} accessibilityLabel="Close">
        <KeyboardAvoidingView behavior="padding">
          <Pressable style={[s.sheet, { backgroundColor: t.surface, paddingBottom: 28 }]} onPress={() => {}}>
            <View style={[s.grabber, { backgroundColor: t.line2 }]} />
            {paired === null ? <Unpaired /> : paired ? <Body grant={paired} frame={frame} box={box} /> : null}
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

function Body({ grant, frame, box }: { grant: Grant; frame?: string; box: Box }) {
  const t = useContext(Theme);
  const [state, setState] = useState<Json | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [asking, setAsking] = useState<A.Card | null>(null);
  const [writing, setWriting] = useState(false);
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
  const writer = A.writer(state);
  // Only a phone that may ask; a link blip keeps the job (and its draft) on screen until the link is back.
  if (writing && box && writer && grant.device.role === 'control') return <Write box={box} who={writer} state={state} />;
  const chief = online ? A.chief(state) : { mood: 'rest' as const, line: "Can't reach the home computer right now" };
  const needs = A.needsYou(state);
  const crew = A.crew(state);
  const actions = A.quick(state, canAct, box !== null).filter((a) => a.id !== 'needs' && a.id !== 'ask'); // those two are the list and the box
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
        <Btn key={a.id} label={a.label} onPress={() => void (a.id === 'screen' ? handScreen() : a.id === 'write' ? setWriting(true) : open(a.url))} />)}</View>}
    </View>
    {canAct ? <Composer placeholder="Ask Chief anything" onSend={toChief} chat="chief" />
      : <T tone="mute" style={s.small}>{online ? "This phone watches the crew; it can't send messages." : 'You can ask once the home computer is back.'}</T>}
    {asking && <AskSheet c={asking} who={crew.find((h) => h.id === asking.helper)} chiefSays={state.asks.find((x: Json) => x.id === asking.id)?.detail?.chief}
      canAct={canAct} onClose={() => { setAsking(null); refresh(); }} />}
  </>;
}

/** Write it here: what the box should say, the writer's draft when its job replies, and Put it in. Nothing is sent: the
 *  words land in the box and the person presses the app's own Send. The first time, the phone's switch comes first. */
function Write({ box, who, state }: { box: Exclude<Box, null>; who: A.Helper; state: Json }) {
  const t = useContext(Theme);
  const [want, setWant] = useState('');
  const [task, setTask] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [waits, setWaits] = useState('');
  const [trying, setTrying] = useState(false);
  // Every refresh (something landed on the link) looks at the writer's page for this job's reply.
  useEffect(() => { if (task) api.bot(who.id).then((p) => { setDraft(A.draftOf(p, task)); setWaits(A.waitOf(p, task)); }, () => {}); }, [state, task, who.id]);
  if (box === 'off') return <>
    <View style={s.row}><Face who="chief" size={40} mood="hello" /><T style={[s.h2, { flex: 1 }]}>Let Chief see the box you're typing in</T></View>
    <T tone="ink2">{`Switch on Crewhouse on the next page. Then tap me in any box and pick Write it here. ${restrictedWords()}`}</T>
    <Btn go big label="Open the settings" onPress={() => void Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() => {}).then(closePanel)} />
  </>;
  // The first ask's box says "Not sent" itself; Try again has only the toast.
  const ask = async (words: string, not = '', quiet = true) => {
    let r: Json = null;
    if (!await attempt(async () => { r = await api.post(who.id, A.writeAsk(words, box, not)); }, undefined, quiet) || !r?.task) return false;
    setWant(words); setDraft(null); setWaits(''); setTask(r.task);
    return true;
  };
  const sofar = (box.picked || box.text).trim().split('\n')[0];
  if (!task) return <>
    <View style={s.row}><Face who={who} size={40} /><T style={[s.h2, { flex: 1 }]}>What should it say?</T></View>
    {!!sofar && <T tone="ink2" style={s.small} lines={1}>{`${box.picked ? 'You picked' : 'It says'}: “${sofar}”`}</T>}
    <Composer placeholder="Say no politely, offer Thursday" onSend={(words) => ask(words)} photos={false} mic />
  </>;
  if (draft === null) return <>
    <View style={s.row}><Face who={who} size={40} /><T tone="ink2" style={{ flex: 1 }}>{waits || `${who.name} is writing…`}</T></View>
    <View style={s.chips}>
      {!!waits && <Btn label="Open Crewhouse" onPress={() => void Linking.openURL('crewhouse://').catch(() => {}).then(closePanel)} />}
      <Btn ghost label="Not now" onPress={() => void closePanel()} />
    </View>
  </>;
  return <>
    <View style={s.row}><Face who={who} size={40} /><T style={[s.h2, { flex: 1 }]}>{draft ? 'Here it is' : `${who.name} couldn't write this one`}</T></View>
    {!!draft && <ScrollView style={[s.listGroup, { backgroundColor: t.solid, borderColor: t.line, maxHeight: 240 }]} contentContainerStyle={{ padding: 12 }}>
      <T>{draft}</T>
    </ScrollView>}
    <View style={s.chips}>
      {!!draft && <Btn go label="Put it in" onPress={() => void putIn(draft, who.name, box)} />}
      <Btn label="Try again" disabled={trying} onPress={() => { setTrying(true); void ask(want, draft, false).finally(() => setTrying(false)); }} />
      <Btn ghost label="Not now" onPress={() => void closePanel()} />
    </View>
  </>;
}
