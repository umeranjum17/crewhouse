// Chief's panel: what a tap on the bubble opens, over whatever app is in front (src/bubble.ts; index.ts registers it).
// It is its own screen on the phone's one link (src/link.ts): who is on what, what needs you (with that helper's
// screen a tap away), up to three buttons for this screen (A.quick's rules table: fixed words to one helper, its reply
// shown here; Remember this keeps words for the whole crew), and Chief's box, typed or spoken, which answers who is on
// what and what the crew knows about the person itself. Write it here: the writer drafts for the box the person was
// typing in, and Put it in fills it.
// Nothing is sent that the person didn't send. `frame` is a still back from the phone's ask, for helper `to` with
// `words` in the box; `listen` opens with the mic on (a long press on the bubble).
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, useColorScheme, View } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import { api, setTransport, type Json } from '../../web/src/api.ts';
import { AskSheet, attempt, Btn, Composer, Face, look, s, say, ShareIn, T, Theme, Toast } from '../App';
import { closePanel, handScreen, logTap, putIn, restrictedWords, showCrew, tappedBox, used as usedIn, type Box } from './bubble';
import { connect, loadGrant, type Grant, type Status } from './link';

export function Panel({ frame, to, words, listen }: { frame?: string; to?: string; words?: string; listen?: string }) {
  const t = look(useColorScheme() === 'dark');
  const [paired, setPaired] = useState<Grant | null | undefined>(undefined);
  const [box, setBox] = useState<Box>(null);
  const [used, setUsed] = useState<Record<string, number>>({});
  useEffect(() => {
    loadGrant().then(setPaired, () => setPaired(null));
    tappedBox().then((b) => { setBox(b); return usedIn(b && b !== 'off' ? b.app : '').then(setUsed); }).catch(() => {});
  }, []);
  return (
    <Theme.Provider value={t}>
      <Pressable style={s.scrim} onPress={() => void closePanel()} accessibilityLabel="Close">
        <KeyboardAvoidingView behavior="padding">
          <Pressable style={[s.sheet, { backgroundColor: t.surface, paddingBottom: 28 }]} onPress={() => {}}>
            <View style={[s.grabber, { backgroundColor: t.line2 }]} />
            {paired === null ? <Unpaired /> : paired ? <Body grant={paired} still={frame ? { path: frame, mimeType: 'image/png', to: to ?? '', words: words ?? '' } : undefined} box={box} used={used} listen={!!listen} /> : null}
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

type Shared = { path: string; mimeType: string; to: string; words: string };

function Body({ grant, still, box, used, listen }: { grant: Grant; still?: Shared; box: Box; used: Record<string, number>; listen: boolean }) {
  const t = useContext(Theme);
  const [state, setState] = useState<Json | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [asking, setAsking] = useState<A.Card | null>(null);
  const [writing, setWriting] = useState('');
  const [shared, setShared] = useState(still);
  const [asked, setAsked] = useState<{ to: string; task: number } | null>(null);
  const [hold, setHold] = useState(listen);
  const [said, setSaid] = useState<{ ask: string; answer: string; title: string } | null>(null);
  const [kept, setKept] = useState('');
  const hired = useRef('');
  const refresh = useCallback(() => { api.state().then((st) => { setState(st); showCrew(st); }).catch(() => {}); }, []);
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const held = connect(grant, () => { clearTimeout(pending); pending = setTimeout(refresh, 120); }, (st) => { setStatus(st); if (st === 'online') refresh(); });
    setTransport(held.call);
    return () => { clearTimeout(pending); held.release(); };
  }, [grant, refresh]);
  const online = status === 'online';
  const canAct = grant.device.role === 'control' && online;
  // A held bubble starts the mic once per opening: the box's first mount takes it, and a link blip that brings the box
  // back never starts it again.
  useEffect(() => { if (state && canAct) setHold(false); }, [!!state, canAct]);
  // The helper a job goes to, hired (the general Helper) only when nobody fits and only once there is something to
  // send; the panel waits for the crew to show it before going on.
  const hire = async (h: A.Hand) => {
    let id = h.id || hired.current;
    if (!id) await attempt(async () => { id = hired.current = (await api.recruit('helper', h.name)).id; const st = await api.state(); setState(st); showCrew(st); });
    return id;
  };
  // A still back from the phone's ask with nobody picked yet: its helper is hired now.
  useEffect(() => { if (shared && !shared.to && state && canAct) void hire(A.handTo(state, 'scout')).then((to) => (to ? setShared({ ...shared, to }) : closePanel())); }, [!!state, canAct]);
  if (!state) return <View style={s.row}><Face who="chief" size={40} mood="work" /><T tone="ink2" style={{ flex: 1 }}>{status === 'offline' ? "Can't reach the home computer right now." : 'Waking the crew…'}</T></View>;
  const crew = A.crew(state);
  if (shared && canAct && shared.to) return <ShareIn state={state} to={shared.to} shared={{ text: shared.words, files: [shared] }} go={() => void closePanel()} onDone={() => void closePanel()} />;
  if (writing === 'off' && box === 'off') return <SwitchOn />;
  const writer = crew.find((h) => h.id === writing);
  // Only a phone that may ask; a link blip keeps the job (and its draft) on screen until the link is back.
  if (writer && box && grant.device.role === 'control') return <Write box={box} who={writer} state={state} />;
  const replier = asked && crew.find((h) => h.id === asked.to);
  if (said) return <Said {...said} canAct={canAct} onDone={() => setSaid(null)} />;
  if (kept) return <Kept line={kept} />;
  if (replier && asked) return <Reply who={replier} task={asked.task} state={state} onAsk={setAsking} asking={asking} canAct={canAct} refresh={refresh} />;
  const chief = online ? A.chief(state) : { mood: 'rest' as const, line: "Can't reach the home computer right now" };
  const line = online ? A.crewLine(state) : '';
  const needs = A.needsYou(state);
  const top = needs.slice(0, 3).map((c) => crew.find((h) => h.id === c.helper)).find((h) => h?.computer);
  const buttons = A.quick(state, { box, used }, canAct);
  const toChief = async (text: string, photos: { type: string; data: string }[]) => {
    // Who is on what and what the crew knows about you: answered here, from what the phone has, with no model.
    const kind = photos.length ? '' : A.cannedOf(text);
    const plan = A.planDay(state); // with Google not connected it goes to Chief like any other ask
    if (kind === 'plan' && !plan.needs.length) return press(plan).then(() => true);
    if (kind === 'status') { setSaid({ ask: text, title: 'Who is on what', answer: A.canned(state, kind) }); return true; }
    if (kind === 'details') return attempt(async () => setSaid({ ask: text, title: 'What the crew knows about you', answer: A.canned(state, kind, (await api.about())?.notes ?? '') }));
    const ok = await attempt(() => api.post('chief', text, photos.map(({ type, data }) => ({ type, data }))), undefined, true);
    if (ok) await open('crewhouse://ask'); // his chat, where the answer lands
    return ok;
  };
  // A button's job: the box, a still, a photo, or the words, to its helper (A.handTo).
  const press = async (b: A.BubbleButton) => {
    if (b.id !== 'plan') logTap(box && box !== 'off' ? box.app : '', b.id);
    if (b.needs.length) return open('crewhouse://settings');
    // Remember this: refused on the phone when it looks like a secret, before anything is sent; nobody is hired for it.
    if (b.from === 'keep') return attempt(async () => {
      const r = A.keep((await api.about())?.notes ?? '', b.ask);
      if ('refuse' in r) return say(r.refuse);
      await api.setAbout(r.notes);
      setKept(r.line);
    });
    if (b.from === 'box' && box === 'off') return setWriting('off'); // the switch first; nobody is hired for it
    if (b.from === 'screen') return handScreen(b.to.id || hired.current, b.ask); // a helper is hired once the still is back
    if (b.from === 'camera') {
      if (!(await ImagePicker.requestCameraPermissionsAsync().catch(() => null))?.granted) return say('Allow the camera for Crewhouse in your phone settings, then try again.');
      const r = await ImagePicker.launchCameraAsync({ quality: 1 }).catch(() => null);
      const a = r && !r.canceled ? r.assets[0] : null;
      const to = a ? await hire(b.to) : '';
      if (a && to) setShared({ path: a.uri, mimeType: a.mimeType ?? 'image/jpeg', to, words: b.ask });
      return;
    }
    const to = await hire(b.to);
    if (!to) return;
    if (b.from === 'box') return setWriting(to);
    await attempt(async () => { const r: Json = await api.post(to, b.ask); if (r?.task) setAsked({ to, task: r.task }); });
  };
  return <>
    <View style={s.row}>
      <Face who="chief" size={40} mood={chief.mood} />
      <View style={{ flex: 1 }}><T style={s.h2}>Chief</T><T tone="ink2" style={s.small} lines={2}>{chief.line}</T></View>
      <Btn label="Open Crewhouse" onPress={() => void open('crewhouse://')} />
    </View>
    {!!line && line !== `${chief.line}.` && <T tone="ink2" style={s.small} lines={3}>{line}</T>}
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
      {/* Stuck on a sign-in or a page: that helper's own screen, to take the wheel or just watch. */}
      {top && online && <View style={s.chips}>
        {canAct && <Btn label={`Take the wheel from ${top.name}`} onPress={() => void attempt(async () => { await api.takeOver(top.id); await open(`crewhouse://screen?bot=${top.id}`); })} />}
        <Btn ghost label={`Watch ${top.name}`} onPress={() => void open(`crewhouse://screen?bot=${top.id}&watch=1`)} />
      </View>}
      {buttons.length > 0 && <View style={s.chips}>
        {buttons.map((b) => <Btn key={b.id} ghost={b.needs.length > 0} label={b.label} onPress={() => void press(b)} />)}
      </View>}
    </View>
    {canAct ? <Composer placeholder="Ask Chief anything" onSend={toChief} chat="chief" listen={hold} />
      : <T tone="mute" style={s.small}>{online ? "This phone watches the crew; it can't send messages." : 'You can ask once the home computer is back.'}</T>}
    {asking && <AskSheet c={asking} who={crew.find((h) => h.id === asking.helper)} chiefSays={state.asks.find((x: Json) => x.id === asking.id)?.detail?.chief}
      canAct={canAct} onClose={() => { setAsking(null); refresh(); }} />}
  </>;
}

/** A button's job, answered here: an honest wait while the helper works, why it waits (an OK to give, with its card a
 *  tap away), then the reply, with the chat a tap away. */
function Reply({ who, task, state, onAsk, asking, canAct, refresh }: { who: A.Helper; task: number; state: Json; onAsk: (c: A.Card | null) => void; asking: A.Card | null; canAct: boolean; refresh: () => void }) {
  const t = useContext(Theme);
  const [reply, setReply] = useState<string | null>(null);
  const [waits, setWaits] = useState('');
  useEffect(() => { api.bot(who.id).then((p) => { setReply(A.draftOf(p, task)); setWaits(A.waitOf(p, task)); }, () => {}); }, [state, task, who.id]);
  const card = A.needsYou(state).find((c) => c.helper === who.id);
  const chat = () => void open(`crewhouse://ask?to=${state.bots.find((b: Json) => b.id === who.id)?.template ?? ''}`);
  return <>
    <View style={s.row}><Face who={who} size={40} /><T style={[s.h2, { flex: 1 }]}>{reply ? `${who.name} says` : reply === '' ? `${who.name} couldn't do this one` : waits || `${who.name} is on it…`}</T></View>
    {!!reply && <ScrollView style={[s.listGroup, { backgroundColor: t.solid, borderColor: t.line, maxHeight: 280 }]} contentContainerStyle={{ padding: 12 }}>
      <T>{reply}</T>
    </ScrollView>}
    <View style={s.chips}>
      {reply === null && card && <Btn go label="See what it needs" onPress={() => onAsk(card)} />}
      <Btn label={`Open ${who.name}'s chat`} onPress={chat} />
      <Btn ghost label={reply === null ? 'Not now' : 'Done'} onPress={() => void closePanel()} />
    </View>
    {asking && <AskSheet c={asking} who={who} canAct={canAct} onClose={() => { onAsk(null); refresh(); }} />}
  </>;
}

/** Chief's own answer to who is on what or what the crew knows about you, with Chief one tap away for more. */
function Said({ ask, answer, title, canAct, onDone }: { ask: string; answer: string; title: string; canAct: boolean; onDone: () => void }) {
  const t = useContext(Theme);
  return <>
    <View style={s.row}><Face who="chief" size={40} /><T style={[s.h2, { flex: 1 }]}>{title}</T></View>
    <ScrollView style={[s.listGroup, { backgroundColor: t.solid, borderColor: t.line, maxHeight: 280 }]} contentContainerStyle={{ padding: 12 }}><T>{answer}</T></ScrollView>
    <View style={s.chips}>
      {canAct && <Btn label="Ask Chief anyway" onPress={() => void attempt(() => api.post('chief', ask)).then((ok) => { if (ok) void open('crewhouse://ask'); })} />}
      <Btn ghost label="Done" onPress={onDone} />
    </View>
  </>;
}

/** Remember this, kept: the line every helper now reads, with Undo. */
function Kept({ line }: { line: string }) {
  const [gone, setGone] = useState(false);
  return <>
    <View style={s.row}><Face who="chief" size={40} mood={gone ? 'idle' : 'happy'} /><T style={[s.h2, { flex: 1 }]}>{gone ? 'Taken back out' : 'The whole crew knows now'}</T></View>
    <T tone="ink2">{`“${line}”`}</T>
    <View style={s.chips}>
      {!gone && <Btn label="Undo" onPress={() => void attempt(async () => { await api.setAbout(A.unkeep((await api.about())?.notes ?? '', line)); setGone(true); })} />}
      <Btn ghost label="Done" onPress={() => void closePanel()} />
    </View>
  </>;
}

/** Write it here, before the phone lets Chief see the box: where its switch is. */
function SwitchOn() {
  return <>
    <View style={s.row}><Face who="chief" size={40} mood="hello" /><T style={[s.h2, { flex: 1 }]}>Let Chief see the box you're typing in</T></View>
    <T tone="ink2">{`Switch on Crewhouse on the next page. Then tap me in any box and pick Write it here. ${restrictedWords()}`}</T>
    <Btn go big label="Open the settings" onPress={() => void Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() => {}).then(closePanel)} />
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
  if (box === 'off') return <SwitchOn />;
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
