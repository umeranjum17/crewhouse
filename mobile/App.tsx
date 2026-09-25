// The Crewhouse phone app: the web app's screens (Pocket Pals), over the encrypted link to crewd.
// Everything a person reads comes through web/src/adapter.ts, the same plain-words view models as the web app
// (docs/ui-contract.md); the colours are web/src/tokens.ts and the mascots are web/src/art.ts, drawn as dots.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as A from '../web/src/adapter.ts';
import { api, setTransport, trouble, type Json } from '../web/src/api.ts';
import * as art from '../web/src/art.ts';
import { color, radius } from '../web/src/tokens.ts';
import { CONTROL_PERMISSIONS, DesktopView, useDesktopSession } from '@desklink/react-native';
import { desktopAvailable } from '@desklink/react-native/availability';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useShareIntent } from 'expo-share-intent';
import { connect, desktopSignaling, forgetGrant, loadGrant, pair, pairTyped, type Grant, type Status } from './src/link';

// ---------- look ----------
type Look = typeof color.day & { go: string; goInk: string; night: boolean };
const look = (night: boolean): Look => (night ? { ...color.night, go: color.night.ok, goInk: '#07140e', night } : { ...color.day, go: color.day.ink, goInk: '#fff', night });
const Theme = createContext<Look>(look(false));
const useLook = () => useContext(Theme);

// ---------- toasts and actions ----------
let say: (m: string) => void = () => {};
const FRIENDLY = {
  missing: "That isn't ready yet. It arrives with the next Crewhouse update.",
  offline: "Can't reach the home computer right now. Check it's on, then try again.",
  failed: 'That didn’t work. Please try again.',
};
/** Run an action; a failure becomes a friendly toast, never an error message (web/src/parts.tsx attempt). */
async function attempt(fn: () => Promise<unknown>, ok?: string) {
  try { await fn(); if (ok) say(ok); return true; } catch (e: any) { say(FRIENDLY[trouble(e)]); return false; }
}
function Toast() {
  const [m, setM] = useState('');
  const t = useLook();
  useEffect(() => { let x: any; say = (s) => { setM(s); clearTimeout(x); x = setTimeout(() => setM(''), 2600); }; }, []);
  return m ? <Text style={[s.toast, { backgroundColor: t.ink, color: t.bg }]}>{m}</Text> : null;
}

export default function App() {
  const t = look(useColorScheme() === 'dark');
  const [grant, setGrant] = useState<Grant | null | undefined>(undefined);
  useEffect(() => { loadGrant().then(setGrant).catch(() => setGrant(null)); }, []);
  return (
    <Theme.Provider value={t}>
      <SafeAreaProvider>
        <StatusBar style={t.night ? 'light' : 'dark'} />
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
          {grant === undefined ? <Center><ActivityIndicator color={t.pink} /></Center>
            : grant === null ? <Pair onPaired={setGrant} />
            : <Crewhouse grant={grant} onRemoved={() => setGrant(null)} />}
          <Toast />
        </SafeAreaView>
      </SafeAreaProvider>
    </Theme.Provider>
  );
}

// ---------- the mascots, as dots ----------
function Dots({ rows, pal, d }: { rows: art.Bitmap; pal: art.Palette; d: number }) {
  return (
    <View accessible={false}>
      {rows.map((r, y) => (
        <View key={y} style={{ flexDirection: 'row' }}>
          {[...r].map((k, x) => <View key={x} style={{ width: d, height: d, padding: d * 0.06 }}>{pal[k] ? <View style={{ flex: 1, borderRadius: d, backgroundColor: pal[k] }} /> : null}</View>)}
        </View>
      ))}
    </View>
  );
}
function ChiefArt({ mood = 'idle', size }: { mood?: art.Mood; size: number }) {
  const small = size < 60;
  const rows = small ? art.chiefSmall(mood) : art.chief(mood);
  return <Dots rows={rows} pal={useLook().night ? art.CHIEF_PAL_NIGHT : art.CHIEF_PAL} d={size / rows[0].length} />;
}
/** A round face: Chief or a pal, with a ring when it's working (green) or needs you (amber). */
function Face({ who, size = 44 }: { who: A.Helper | 'chief'; size?: number }) {
  const t = useLook();
  const chief = who === 'chief';
  const ring = chief ? '' : who.ring;
  const rows = chief ? [] : art.pal(who.kind, who.mood);
  return (
    <View style={{ width: size, height: size, borderRadius: size, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      backgroundColor: chief ? '#fff7e8' : art.PALS[who.kind].soft, borderWidth: ring ? 3 : 0, borderColor: ring === 'needs' ? t.wait : t.ok }}>
      {chief ? <ChiefArt size={size * 0.72} /> : <Dots rows={rows} pal={art.palPalette(who.kind)} d={(size * 0.78) / rows[0].length} />}
    </View>
  );
}
function Pill({ tone = 'ok', children }: { tone?: 'ok' | 'wait' | 'off'; children: ReactNode }) {
  const t = useLook();
  return (
    <View style={[s.pill, { backgroundColor: t.solid }]}>
      <View style={[s.pillDot, { backgroundColor: tone === 'wait' ? t.wait : tone === 'off' ? t.line : t.ok }]} />
      <Text style={[s.pillText, { color: t.ink }]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

// ---------- small pieces ----------
function Center({ children }: { children: ReactNode }) { return <View style={s.center}>{children}</View>; }
function T({ children, style, tone = 'ink', lines }: { children: ReactNode; style?: any; tone?: 'ink' | 'ink2' | 'mute' | 'pinkInk'; lines?: number }) {
  return <Text style={[s.text, { color: useLook()[tone] }, style]} numberOfLines={lines}>{children}</Text>;
}
function Btn({ label, onPress, go, ghost, big, disabled }: { label: string; onPress: () => void; go?: boolean; ghost?: boolean; big?: boolean; disabled?: boolean }) {
  const t = useLook();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.btn, { backgroundColor: go ? t.go : ghost ? 'transparent' : t.solid, borderColor: go || ghost ? 'transparent' : t.line },
        big && s.btnBig, (pressed || disabled) && { opacity: 0.55 }]}>
      <Text style={[s.btnText, { color: go ? t.goInk : ghost ? t.mute : t.ink }]}>{label}</Text>
    </Pressable>
  );
}
function Card({ children, style, ask }: { children: ReactNode; style?: any; ask?: boolean }) {
  const t = useLook();
  return <View style={[s.card, { backgroundColor: t.card, borderColor: ask ? '#ffcf8f' : t.line, borderWidth: ask ? 2 : 1 }, style]}>{children}</View>;
}
const Label = ({ children }: { children: ReactNode }) => <T tone="mute" style={s.label}>{children}</T>;
function Page({ title, lead, children }: { title?: string; lead?: string; children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      {!!title && <T style={s.h1}>{title}</T>}
      {!!lead && <T tone="ink2" style={{ marginBottom: 6 }}>{lead}</T>}
      {children}
    </ScrollView>
  );
}
type Photo = { type: string; data: string; uri: string };
/** A picked photo, made small enough for the link (about 1280 px, JPEG): a school poster reads fine at that size. */
async function shrink(uri: string): Promise<Photo> {
  const r = await manipulateAsync(uri, [{ resize: { width: 1280 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
  return { type: 'image/jpeg', data: r.base64 ?? '', uri: r.uri };
}

/** The message box: words (the phone keyboard's own mic dictates them) and up to four photos. */
function Composer({ placeholder, onSend, draft = '', photos: canPhoto = true }: { placeholder: string; onSend: (t: string, photos: Photo[]) => unknown; draft?: string; photos?: boolean }) {
  const t = useLook();
  const [text, setText] = useState(draft);
  const [pics, setPics] = useState<Photo[]>([]);
  const ready = !!text.trim() || pics.length > 0;
  const send = () => { if (!ready) return; const x = text.trim(), p = pics; setText(''); setPics([]); onSend(x, p); };
  const pick = () => attempt(async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4 - pics.length, quality: 1 });
    if (r.canceled) return;
    const made = await Promise.all(r.assets.slice(0, 4 - pics.length).map((a) => shrink(a.uri)));
    setPics((p) => [...p, ...made].slice(0, 4));
  });
  return (
    <View style={{ gap: 6 }}>
      {pics.length > 0 && <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 8 }}>
        {pics.map((p, i) => (
          <Pressable key={p.uri} onPress={() => setPics((x) => x.filter((_, j) => j !== i))} accessibilityLabel={`Remove photo ${i + 1}`}>
            <Image source={{ uri: p.uri }} style={{ width: 56, height: 56, borderRadius: 12 }} />
          </Pressable>
        ))}
      </View>}
      <View style={[s.composer, { backgroundColor: t.solid, borderColor: t.line }]}>
        {canPhoto && <Pressable onPress={pick} disabled={pics.length >= 4} accessibilityLabel="Add a photo" style={[s.send, { backgroundColor: 'transparent' }]}>
          <Text style={{ color: t.ink, fontSize: 20 }}>＋</Text>
        </Pressable>}
        <TextInput style={[s.composerInput, { color: t.ink }]} value={text} onChangeText={setText} multiline placeholder={placeholder} placeholderTextColor={t.mute} accessibilityLabel={placeholder} />
        <Pressable onPress={send} disabled={!ready} accessibilityLabel="Send" style={[s.send, { backgroundColor: t.go, opacity: ready ? 1 : 0.4 }]}>
          <Text style={{ color: t.goInk, fontSize: 18, fontWeight: '900' }}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
}
function Steps({ steps, max = 6 }: { steps: A.Step[]; max?: number }) {
  const t = useLook();
  if (!steps.length) return null;
  return (
    <Card>
      {steps.slice(-max).map((x) => (
        <View key={x.seq} style={s.step}>
          <View style={[s.stepDot, { backgroundColor: x.now ? t.ok : x.asked ? t.wait : t.line }]} />
          <T style={{ flex: 1 }}>{x.text}</T>
          <T tone="mute" style={s.small}>{x.now ? 'now' : A.clock(x.at)}</T>
        </View>
      ))}
    </Card>
  );
}
/** Files open on the home computer; the phone shows what they are. */
/** A photo someone sent: fetched over the link as data (this computer's /files address isn't reachable from the phone). */
function PhotoView({ f }: { f: A.FileView }) {
  const [uri, setUri] = useState('');
  const src = A.fileSource(f.url);
  useEffect(() => { if (src) void api.photo(src.bot, src.path).then((p) => setUri(`data:${p.type};base64,${p.data}`)).catch(() => {}); }, [f.url]);
  return uri ? <Image source={{ uri }} style={{ width: 240, height: 240, borderRadius: 16 }} resizeMode="contain" accessibilityLabel="A photo" /> : <FileRow f={f} plain />;
}

function FileRow({ f, plain }: { f: A.FileView; plain?: boolean }) {
  if (!plain && f.kind === 'image' && /\/photos\//.test(f.url)) return <PhotoView f={f} />;
  return <View style={s.row}><T tone="mute">{f.kind === 'video' ? '▶' : f.kind === 'image' ? '▣' : '▤'}</T><T style={{ flex: 1 }}>{f.name}</T><T tone="mute" style={s.small}>on your computer</T></View>;
}

// ---------- pairing ----------
function Pair({ onPaired }: { onPaired: (g: Grant) => void }) {
  const t = useLook();
  const [perm, askPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Grant | null>(null);
  const [words, setWords] = useState('');
  const [typing, setTyping] = useState(false);
  const [relay, setRelay] = useState('');
  const [short, setShort] = useState('');
  const [code, setCode] = useState('');
  const seen = useRef('');
  const typed = async () => {
    setBusy(true);
    setErr('');
    try { setDone(await pairTyped(relay, short, code, setWords)); } catch (e: any) { setErr(e.message); }
    setWords('');
    setBusy(false);
  };
  const tryCode = async (text: string) => {
    if (busy || seen.current === text) return;
    seen.current = text;
    setScanning(false);
    setBusy(true);
    setErr('');
    // @byokit/link's failures are already plain sentences ("That pairing code has run out. Show a new one on your computer.").
    try { setDone(await pair(text, setWords)); } catch (e: any) { seen.current = ''; setErr(e.message); }
    setWords('');
    setBusy(false);
  };
  if (done) {
    return (
      <Center>
        <ChiefArt mood="happy" size={150} />
        <T style={s.h1}>You're in</T>
        <T tone="ink2" style={s.centerText}>This phone is paired with your computer{done.device.role === 'view' ? '. It can watch the crew, not answer' : ''}.</T>
        <Btn go big label="Open Crewhouse" onPress={() => onPaired(done)} />
      </Center>
    );
  }
  if (words) {
    return (
      <Center>
        <ChiefArt mood="listen" size={150} />
        <T style={s.h1}>Check the words</T>
        <T tone="ink2" style={s.centerText}>Your computer is asking whether this phone may join. Say yes there only if it shows these same two words:</T>
        <Text style={[s.fp, { color: t.pinkInk }]}>{words}</Text>
        <ActivityIndicator color={t.pink} />
      </Center>
    );
  }
  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => tryCode(r.data)} />
        <View style={s.scanHint}>
          <Text style={{ color: '#fff', textAlign: 'center', fontSize: 16 }}>Point at the code in Crewhouse on your computer.</Text>
          <Btn label="Cancel" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }
  if (typing) {
    const input = (value: string, set: (v: string) => void, placeholder: string, label: string) => (
      <TextInput style={[s.input, { alignSelf: 'stretch', color: t.ink, borderColor: t.line }]} value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={t.mute}
        accessibilityLabel={label} autoCapitalize={label === 'Relay address' ? 'none' : 'characters'} autoCorrect={false} />
    );
    return (
      <Center>
        <ChiefArt mood="listen" size={120} />
        <T style={s.h1}>Type a code</T>
        <T tone="ink2" style={s.centerText}>On your computer, Settings, Phones, Add a phone, then “Can't scan? Type a code instead”.</T>
        {input(relay, setRelay, 'Your relay, like relay.example.com', 'Relay address')}
        {input(short, setShort, 'Short code, like K7M2QX', 'Short code')}
        {input(code, setCode, 'Pairing code, like 7KQ4-M2XP-9RTH', 'Pairing code')}
        {busy ? <ActivityIndicator color={t.pink} style={{ margin: 20 }} /> : <Btn go big label="Pair" disabled={!relay.trim() || !short.trim() || !code.trim()} onPress={typed} />}
        {!!err && <T tone="pinkInk" style={s.centerText}>{err}</T>}
        <Btn label="Scan instead" onPress={() => { setTyping(false); setErr(''); }} />
      </Center>
    );
  }
  return (
    <Center>
      <ChiefArt mood="hello" size={170} />
      <T style={s.h1}>Crewhouse</T>
      <T tone="ink2" style={s.centerText}>Your crew, in your pocket. On your computer, open Crewhouse, then Settings, Phones, Add a phone.</T>
      {busy ? <ActivityIndicator color={t.pink} style={{ margin: 20 }} /> : (
        <Btn go big label="Scan the code" onPress={async () => {
          const p = perm?.granted ? perm : await askPerm();
          if (p.granted) setScanning(true); else setErr('Crewhouse needs the camera to read the code.');
        }} />
      )}
      {!busy && <Btn label="Type a code" onPress={() => { setTyping(true); setErr(''); }} />}
      {!!err && <T tone="pinkInk" style={s.centerText}>{err}</T>}
      <T tone="mute" style={[s.small, s.centerText, { marginTop: 20 }]}>🔒 Only your computer can read what this phone sends. A relay, if you use one, passes it along without being able to read it.</T>
    </Center>
  );
}

// ---------- the app ----------
type Route = { view: 'home' | 'chief' | 'crew' | 'helper' | 'things' | 'routines' | 'add' | 'phone'; id?: string; tab?: string };
type Ctx = { state: Json; tick: number; refresh: () => void; go: (r: Route, replace?: boolean) => void; canAct: boolean; open: (c: A.Card) => void };

function Crewhouse({ grant, onRemoved }: { grant: Grant; onRemoved: () => void }) {
  const t = useLook();
  // A photo, link or text shared from another app arrives here (Android's share sheet).
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const [state, setState] = useState<Json>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [tick, setTick] = useState(0);
  const [stack, setStack] = useState<Route[]>([{ view: 'home' }]);
  const [sheet, setSheet] = useState<A.Card | null>(null);
  const link = useRef<ReturnType<typeof connect>['link'] | null>(null);
  const heard = useRef(0); // when the home computer last answered
  const route = stack[stack.length - 1];

  const refresh = useCallback(() => {
    api.state().then((st) => { setState(st); heard.current = Date.now(); }).catch(() => {});
    setTick((n) => n + 1);
  }, []);
  useEffect(() => {
    let pending: any;
    const { link: l, call, learn } = connect(grant, () => { clearTimeout(pending); pending = setTimeout(refresh, 120); }, (st) => { setStatus(st); if (st === 'online') { refresh(); void learn(); } if (st === 'removed') onRemoved(); }); // online: first load, and catching up after a reconnect
    link.current = l;
    setTransport(call);
    return () => l.stop();
  }, [grant, refresh, onRemoved]);
  const wasOnline = useRef(false);
  useEffect(() => { if (status === 'online' && wasOnline.current === false && state) say('Back in touch with the home computer ✓'); wasOnline.current = status === 'online'; }, [status]);

  const go = (r: Route, replace = false) => setStack((st) => (replace ? [r] : [...st, r]));
  const back = useCallback(() => {
    if (sheet) { setSheet(null); return true; }
    if (stack.length <= 1) return false;
    setStack((st) => st.slice(0, -1));
    return true;
  }, [stack.length, sheet]);
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', back); return () => sub.remove(); }, [back]);
  const forget = async () => { link.current?.stop(); await forgetGrant(); onRemoved(); };

  if (status === 'refused') {
    return (
      <Center>
        <ChiefArt mood="error" size={140} />
        <T style={s.h1}>Not recognised</T>
        <T tone="ink2" style={s.centerText}>Your computer didn't accept this phone. It may have been removed in Settings, Phones, or Crewhouse was set up again.</T>
        <Btn go big label="Pair again" onPress={forget} />
        <Btn label="Try again" onPress={() => link.current?.retry()} />
      </Center>
    );
  }
  if (!state) {
    return (
      <Center>
        <ChiefArt mood="work" size={140} />
        <T tone="ink2" style={s.centerText}>{status === 'offline' ? "Can't reach the home computer. If it's asleep, the crew has paused and carries on when it wakes. Check it's on, and that this phone is on its Wi-Fi or Tailscale. Trying again by itself." : 'Waking the crew…'}</T>
      </Center>
    );
  }
  const canAct = grant.device.role === 'control';
  const ctx: Ctx = { state, tick, refresh, go, canAct, open: setSheet };
  const shared = hasShareIntent && canAct && state.person.onboarded
    ? { text: [shareIntent.text, shareIntent.webUrl].filter((x, i, a) => x && a.indexOf(x) === i).join('\n'), files: (shareIntent.files ?? []).map((f) => ({ path: f.path, mimeType: f.mimeType })) } : null;
  if (shared) return <ShareIn state={state} shared={shared} go={go} onDone={() => resetShareIntent()} />;
  if (!state.person.onboarded && canAct) return <Hello {...ctx} />;
  const nav: [Route['view'], string, string][] = [['home', 'Chats', '⌂'], ['crew', 'Crew', '☺\uFE0E'], ['things', 'Things', '▤'], ['routines', 'Routines', '↻'], ['phone', 'This phone', '▯']];
  const active = ['chief', 'helper', 'add'].includes(route.view) ? 'crew' : route.view;
  const live = sheet && A.cards(state).find((c) => c.id === sheet.id);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      {status !== 'online' && <Text style={[s.offline, { backgroundColor: t.amber, color: color.day.ink }]}>{`The home computer isn't answering. If it's asleep, the crew has paused and carries on when it wakes.${heard.current ? ` Last heard from it at ${A.clock(heard.current)}.` : ''} Trying again…`}</Text>}
      <View style={{ flex: 1 }}>
        {route.view === 'home' && <Home {...ctx} />}
        {route.view === 'chief' && <ChiefPage {...ctx} />}
        {route.view === 'crew' && <Crew {...ctx} />}
        {route.view === 'helper' && <HelperPage {...ctx} id={route.id!} tab={route.tab ?? 'chat'} setTab={(tab) => setStack((st) => [...st.slice(0, -1), { ...route, tab }])} />}
        {route.view === 'routines' && <Page title="Routines" lead="Jobs the crew does on a schedule. You can also just tell Chief: “every Friday, make a video of the week's photos”."><RoutineList {...ctx} /></Page>}
        {route.view === 'add' && <AddHelper {...ctx} />}
        {route.view === 'things' && <Page title="Things" lead="Everything the crew has made for you."><ThingsList list={A.things(state)} state={state} empty="Videos, lists, letters and plans the crew makes for you land here." /></Page>}
        {route.view === 'phone' && <ThisPhone grant={grant} status={status} onForget={forget} />}
      </View>
      <View style={[s.tabbar, { backgroundColor: t.bg, borderColor: t.line }]}>
        {nav.map(([v, label, icon]) => (
          <Pressable key={v} style={s.tab} onPress={() => go({ view: v }, true)} accessibilityRole="tab" accessibilityLabel={label}>
            <Text style={[s.tabIcon, { color: active === v ? t.ink : t.mute }]}>{icon}</Text>
            <Text style={[s.tabLabel, { color: active === v ? t.ink : t.mute }]}>{label}</Text>
            {v === 'home' && state.asks.length > 0 && <Text style={[s.badge, { backgroundColor: t.wait }]}>{state.asks.length}</Text>}
          </Pressable>
        ))}
      </View>
      {live && <AskSheet c={live} who={A.crew(state).find((h) => h.id === live.helper)} chiefSays={state.asks.find((a: Json) => a.id === live.id)?.detail?.chief} canAct={canAct} onClose={() => { setSheet(null); refresh(); }} />}
    </KeyboardAvoidingView>
  );
}

// ---------- first run ----------
function Hello({ state, refresh, go }: Ctx) {
  const me = state.person;
  const named = me.name && !(me.id === A.OWNER && me.name === 'Owner') ? me.name : '';
  const [address, setAddress] = useState<string>(me.address || named);
  const pick = (ask?: string) => {
    if (!address.trim()) return say('First, what shall I call you?');
    void attempt(async () => { await api.onboard(address.trim(), ask); refresh(); go({ view: 'chief' }, true); });
  };
  return (
    <Page>
      <View style={{ alignItems: 'center' }}><ChiefArt mood="hello" size={150} /></View>
      <T style={[s.h1, s.centerText]}>{A.greeting()}{address.trim() ? `, ${address.trim()}` : ''}</T>
      <T tone="ink2" style={s.centerText}>I'm Chief. I run the crew in this house. I ask before anything leaves the house or costs money.</T>
      <TextInput style={[s.input, { color: useLook().ink, borderColor: useLook().line }]} value={address} onChangeText={setAddress} placeholder="What shall I call you?" placeholderTextColor={useLook().mute} />
      <View style={s.chips}>{['Sir', "Ma'am", ...(named ? [named] : [])].map((q) => <Btn key={q} label={q} onPress={() => setAddress(q)} />)}</View>
      <Label>What can I take off your plate?</Label>
      {A.FIRST_IDEAS.map((i) => <Btn key={i.label} label={`${i.icon}  ${i.label}`} onPress={() => pick(i.label)} />)}
      <Btn go big label="Just say hello" onPress={() => pick()} />
    </Page>
  );
}

// ---------- asks ----------
const answer = (c: A.Card, body: Json) => attempt(() => api.answer(c.id, body), body.answer === 'deny' ? 'OK, not now' : 'Done. Carrying on.');

function AskCard({ c, who, onDone, canAct, open }: { c: A.Card; who: A.Helper | undefined; onDone: () => void; canAct: boolean; open: (c: A.Card) => void }) {
  const [reply, setReply] = useState('');
  const t = useLook();
  const act = async (body: Json) => { if (await answer(c, body)) onDone(); };
  const [yes, ...rest] = c.choices;
  return (
    <Card ask>
      <View style={s.row}>
        {who && <Face who={{ ...who, mood: 'ask' }} size={36} />}
        <View style={{ flex: 1 }}><T style={s.b}>{c.head}</T><T tone="mute" style={s.small}>{A.clock(c.at)}</T></View>
      </View>
      <T style={{ marginVertical: 8 }}>{c.words}</T>
      {!canAct ? <T tone="mute" style={s.small}>This phone watches; answer on another phone or the computer.</T> : c.kind === 'connect' ? (
        <T tone="mute" style={s.small}>Connecting an app is done on the computer: Settings, Your apps.</T>
      ) : c.reply ? (
        <View style={s.row}>
          <TextInput style={[s.input, { flex: 1, color: t.ink, borderColor: t.line }]} value={reply} onChangeText={setReply} placeholder={`Tell ${who?.name ?? 'them'} what to do`} placeholderTextColor={t.mute} />
          <Btn go label="Send" disabled={!reply.trim()} onPress={() => act({ text: reply.trim() })} />
        </View>
      ) : (
        <View style={s.chips}>
          <Btn go label={yes.label} onPress={() => act(yes.body)} />
          {(c.preview || rest.length > 1) && <Btn label={c.preview ? 'Read it first' : 'More'} onPress={() => open(c)} />}
          <Btn label="Not now" onPress={() => act({ answer: 'deny' })} />
        </View>
      )}
    </Card>
  );
}

/** The approval moment: who, what, exactly what goes out, and the choices. */
function AskSheet({ c, who, chiefSays, canAct, onClose }: { c: A.Card; who: A.Helper | undefined; chiefSays?: string; canAct: boolean; onClose: () => void }) {
  const t = useLook();
  const act = async (body: Json) => { if (await answer(c, body)) onClose(); };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose}>
        <Pressable style={[s.sheet, { backgroundColor: t.bg }]} onPress={() => {}}>
          <View style={{ alignItems: 'center', gap: 10 }}>
            {who && <Face who={{ ...who, mood: 'ask' }} size={84} />}
            <Pill tone="wait">{who?.name ?? 'The crew'} · {c.kind === 'spend' ? 'needs a quick OK' : 'needs your OK'}</Pill>
          </View>
          <T style={s.h2}>{c.words}</T>
          {c.preview && <Card>{!!c.preview.head && <T tone="mute" style={s.small}>{c.preview.head}</T>}<T>{c.preview.body}</T></Card>}
          {!!chiefSays && <View style={s.row}><Face who="chief" size={30} /><T style={{ flex: 1 }}><Text style={s.b}>Chief:</Text> {A.plain(chiefSays)}</T></View>}
          {c.kind === 'spend' && <T tone="mute" style={s.small}>Anything that costs money asks you every time.</T>}
          {canAct ? c.choices.map((x, i) => <Btn key={x.label} go={i === 0} big label={x.label} onPress={() => act(x.body)} />) : <Btn big label="Close" onPress={onClose} />}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------- home ----------
function Heartbeat({ state }: { state: Json }) {
  const { mood, line } = A.chief(state);
  return <View style={{ alignItems: 'center', gap: 8 }}><ChiefArt mood={mood} size={120} /><Pill tone={mood === 'ask' ? 'wait' : mood === 'rest' ? 'off' : 'ok'}>{line}</Pill></View>;
}

function Home(ctx: Ctx) {
  const { state, go, refresh, canAct, open } = ctx;
  const crew = A.crew(state);
  const who = (id: string) => crew.find((h) => h.id === id);
  const cards = A.cards(state);
  const toChief = async (x: string, p: Photo[] = []) => { if (await attempt(() => api.post('chief', x, p.map(({ type, data }) => ({ type, data }))))) { refresh(); go({ view: 'chief' }); } };
  const helperRoute = (id: string): Route => (id === 'chief' ? { view: 'chief' } : { view: 'helper', id });
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => go({ view: 'chief' })}><Heartbeat state={state} /></Pressable>
        <T style={[s.h1, s.centerText]}>{A.greeting()}, {state.person.address ?? state.person.name}</T>
        {!!A.resting(state) && <Card><T>{A.resting(state)}. I'll pick things back up then.</T></Card>}
        {cards.map((c) => <AskCard key={c.id} c={c} who={who(c.helper)} onDone={refresh} canAct={canAct} open={open} />)}
        <ChatList state={state} go={go} />
        {canAct && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {A.ideas(state).map((i: Json) => <Btn key={i.bot + i.label} label={`✦ ${i.label}`} onPress={() => attempt(async () => { await api.post(i.bot, i.ask); refresh(); go(helperRoute(i.bot)); })} />)}
          </ScrollView>
        )}
      </ScrollView>
      {canAct && <View style={s.dock}><Composer placeholder="Ask Chief anything…" onSend={toChief} /></View>}
    </View>
  );
}

/** Every chat, like a messaging app: Chief on top, then whoever spoke last; search finds words across them. */
function ChatList({ state, go }: { state: Json; go: Ctx['go'] }) {
  const t = useLook();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Json | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const x = setTimeout(() => api.search(q.trim()).then(setHits).catch(() => {}), 250);
    return () => clearTimeout(x);
  }, [q]);
  const crew = A.crew(state);
  const to = (id: string): Route => (id === 'chief' ? { view: 'chief' } : { view: 'helper', id });
  const face = (id: string) => (id === 'chief' ? <Face who="chief" size={46} /> : <Face who={crew.find((h) => h.id === id) ?? 'chief'} size={46} />);
  const row = (key: string, id: string, name: string, line: string, at: number, unread = 0) => (
    <Pressable key={key} style={s.job} onPress={() => go(to(id))} accessibilityLabel={`${name}${unread ? `, ${unread} new` : ''}`}>
      {face(id)}
      <View style={{ flex: 1 }}><T style={s.b}>{name}</T><T tone={unread ? 'ink' : 'mute'} lines={1}>{line}</T></View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <T tone="mute" style={s.small}>{at ? A.clock(at) : ''}</T>
        {unread > 0 && <Text style={[s.unread, { backgroundColor: t.wait }]}>{A.unreadBadge(unread)}</Text>}
      </View>
    </Pressable>
  );
  const found = A.found(state, hits);
  return (
    <Card>
      <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={q} onChangeText={setQ} placeholder="Search your chats" placeholderTextColor={t.mute} accessibilityLabel="Search your chats" />
      {hits ? (found.length ? found.map((f) => row(f.key, f.bot, f.name, f.text, f.at)) : <T tone="mute" style={s.centerText}>Nothing matches “{q.trim()}”.</T>)
        : A.chats(state).map((c) => row(c.id, c.id, c.name, c.line, c.at, c.unread))}
    </Card>
  );
}

// ---------- a chat ----------
function Chat({ id, state, tick, refresh, canAct, open }: Ctx & { id: string }) {
  const t = useLook();
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.bot(id).then(setPage).catch(() => {}), [id]);
  useEffect(() => { void load(); }, [load, tick]);
  const scroll = useRef<ScrollView>(null);
  const lines = A.lines(page, id);
  const h = A.crew(state).find((x) => x.id === id);
  const b = state.bots.find((x: Json) => x.id === id);
  const trail = b?.task && page ? A.steps(page.trail ?? [], b.task.id, true) : [];
  const cards = A.cards(state).filter((c) => c.helper === id);
  const last = lines.at(-1);
  const name = h?.name ?? 'Chief';
  // Seen: the chat's unread count goes once its newest line is on screen (a watch-only phone can't mark it).
  const newest = last?.id;
  useEffect(() => { if (canAct && newest && b?.unread) void api.read(id).then(refresh).catch(() => {}); }, [canAct, newest, b?.unread, id, refresh]);
  const send = async (x: string, p: Photo[] = []) => { if (await attempt(() => api.post(id, x, p.map(({ type, data }) => ({ type, data }))))) { void load(); refresh(); } };
  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {!lines.length && page && <T tone="mute" style={s.centerText}>Say hello to {name}. Ask for anything, in your own words.</T>}
        {lines.map((l) => (
          <View key={l.id} style={[s.line, l.from === 'me' && { alignSelf: 'flex-end' }, l.from === 'note' && { maxWidth: '92%' }]}>
            {l.from === 'chief' && <T tone="pinkInk" style={[s.small, s.b, { marginLeft: 10 }]}>Chief</T>}
            {!!l.text && (
              <View style={[s.bubbleText, l.from === 'me' ? { backgroundColor: t.night ? '#2a2340' : t.go, borderBottomRightRadius: 6 }
                : l.from === 'note' ? { backgroundColor: t.card } : { backgroundColor: t.solid, borderTopLeftRadius: 6 }]}>
                <Text style={[s.text, { color: l.from === 'me' && !t.night ? t.goInk : t.ink }]}>{l.text}</Text>
              </View>
            )}
            {l.files.map((f) => <Card key={f.url}><FileRow f={f} /></Card>)}
          </View>
        ))}
        {canAct && !!last?.choices.length && <View style={s.chips}>{last.choices.map((c) => <Btn key={c} label={c} onPress={() => send(c)} />)}</View>}
        <Steps steps={trail} />
        {cards.map((c) => <AskCard key={c.id} c={c} who={h} onDone={refresh} canAct={canAct} open={open} />)}
      </ScrollView>
      {canAct ? <View style={s.dock}><Composer placeholder={id === 'chief' ? 'Ask Chief anything…' : `Message ${name}…`} onSend={send} /></View>
        : <T tone="mute" style={[s.small, { padding: 16 }]}>This phone watches the crew; it can't send messages.</T>}
    </View>
  );
}

function Head({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  const t = useLook();
  return (
    <View style={[s.head, { borderColor: t.line }]}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back"><Text style={{ fontSize: 30, color: t.ink, paddingRight: 4 }}>‹</Text></Pressable>
      {children}
    </View>
  );
}

function ChiefPage(ctx: Ctx) {
  const { mood, line } = A.chief(ctx.state);
  return (
    <View style={{ flex: 1 }}>
      <Head onBack={() => ctx.go({ view: 'home' }, true)}>
        <Face who="chief" size={44} />
        <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}><T style={s.b}>Chief</T><Pill tone={mood === 'ask' ? 'wait' : 'ok'}>{line}</Pill></View>
      </Head>
      <Chat {...ctx} id="chief" />
    </View>
  );
}

// ---------- the crew ----------
function Crew(ctx: Ctx) {
  const { state, go } = ctx;
  const t = useLook();
  const chief = A.chief(state);
  const tile = (key: string, face: ReactNode, name: string, pill: ReactNode, role: string, r: Route) => (
    <Pressable key={key} style={[s.palCard, { backgroundColor: t.card, borderColor: t.line }]} onPress={() => go(r)}>
      {face}<T style={s.b}>{name}</T>{pill}<T tone="mute" style={[s.small, s.centerText]} lines={2}>{role}</T>
    </Pressable>
  );
  return (
    <Page title="Your crew" lead="Everyone answers to Chief. Tap a helper to chat.">
      <View style={s.grid}>
        {tile('chief', <ChiefArt mood={chief.mood} size={84} />, 'Chief', <Pill>{chief.line}</Pill>, 'Runs the crew and answers to you', { view: 'chief' })}
        {A.crew(state).map((h) => tile(h.id, <Face who={h} size={84} />, h.name, <Pill tone={h.ring === 'needs' ? 'wait' : h.ring ? 'ok' : 'off'}>{h.status}</Pill>, h.role, { view: 'helper', id: h.id }))}
      </View>
      {ctx.canAct ? <Btn go label="Add a helper" onPress={() => go({ view: 'add' })} /> : null}
    </Page>
  );
}

function HelperPage(ctx: Ctx & { id: string; tab: string; setTab: (t: string) => void }) {
  const { id, tab, setTab, state, tick, refresh, canAct, go } = ctx;
  const t = useLook();
  const h = A.crew(state).find((x) => x.id === id);
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.bot(id).then(setPage).catch(() => {}), [id]);
  useEffect(() => { void load(); }, [load, tick]);
  if (!h) return <Center><T tone="mute">This helper has left the crew.</T></Center>;
  const b = state.bots.find((x: Json) => x.id === id);
  const tabs: [string, string][] = [['chat', 'Chat'], ['did', 'What I did'], ['things', 'Things'], ['routines', 'Routines'],
    ...(h.computer && desktopAvailable ? [['screen', 'Screen'] as [string, string]] : []), ['me', 'About me'], ['remembers', 'Remembers']];
  const trail = A.steps(page?.trail ?? []);
  const memories = A.memories(page?.notes);
  return (
    <View style={{ flex: 1 }}>
      <Head onBack={() => go({ view: 'crew' }, true)}>
        <Face who={h} size={48} />
        <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}><T style={s.b}>{h.name}</T><Pill tone={h.ring === 'needs' ? 'wait' : h.ring ? 'ok' : 'off'}>{h.status}</Pill></View>
        {b?.task && canAct && <Btn label="Stop" onPress={() => attempt(async () => { await api.reset(id); refresh(); }, `Stopped ${h.name}`)} />}
      </Head>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 10, gap: 6 }}>
        {tabs.map(([k, l]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.tabPill, k === tab && { backgroundColor: t.solid, borderColor: t.line }]}>
            <Text style={[s.tabPillText, { color: k === tab ? t.ink : t.mute }]}>{l}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {tab === 'chat' && <Chat key={id} {...ctx} id={id} />}
      {tab === 'did' && <Page lead={`Every step ${h.name} takes, as it happens. Recorded by Crewhouse, not remembered by ${h.name}.`}>
        {trail.length ? <Steps steps={trail} max={40} /> : <Card><T tone="mute">Nothing yet. Give {h.name} something to do.</T></Card>}
      </Page>}
      {tab === 'things' && <Page><ThingsList list={A.things(state).filter((x) => x.helper === id)} state={state} empty={`${h.name}'s finished work shows up here.`} /></Page>}
      {tab === 'routines' && <Page><RoutineList {...ctx} bot={id} /></Page>}
      {tab === 'screen' && <Page><Screen bot={{ ...page?.bot, ...b }} canAct={canAct} refresh={() => { refresh(); void load(); }} /></Page>}
      {tab === 'me' && <Page lead={`Who ${h.name} is, and what it knows how to do. Change it on the computer, or ask Chief.`}>
        <Card>{A.personality(page?.soul).map((l, i) => <T key={i} style={{ paddingVertical: 4 }}>{l}</T>)}</Card>
        {A.knows(page?.skills).length > 0 && <Card><T style={s.b}>Knows how to</T>{A.knows(page?.skills).map((k) => <T key={k.name} style={{ paddingVertical: 4 }}>{`• ${k.says}`}</T>)}</Card>}
      </Page>}
      {tab === 'remembers' && <Page lead={`What ${h.name} has learned about how you like things.`}>
        {memories.length ? <Card>{memories.map((m, i) => <T key={i} style={{ paddingVertical: 6 }}>{m}</T>)}</Card>
          : <Card><T tone="mute">Nothing yet. {h.name} adds a line when it learns something you like.</T></Card>}
      </Page>}
    </View>
  );
}

/** A bot's own screen on the phone, through desklink over the encrypted link: Watch, Take the wheel, Hand it back. */
function Screen({ bot, canAct, refresh }: { bot: Json; canAct: boolean; refresh: () => void }) {
  const t = useLook();
  const control = bot.controls === 'person';
  const controlRef = useRef(control);
  controlRef.current = control;
  const watching = useRef(false);
  const sig = useRef<ReturnType<typeof desktopSignaling> | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const session = useDesktopSession({
    authorize: async () => {
      sig.current?.close();
      sig.current = desktopSignaling(bot.id);
      return { signaling: sig.current as any, session: { permissions: controlRef.current && canAct ? CONTROL_PERMISSIONS : ['view'], maxFps: 15 } };
    },
    onError: () => setErr(`Couldn't open ${bot.display}'s screen. Try again in a moment.`),
  });
  const open = () => session.connect().then(() => session.setInputEnabled(controlRef.current && canAct));
  useEffect(() => { if (watching.current) void session.close().then(open); }, [control]);
  useEffect(() => () => { session.setInputEnabled(false); void session.close(); sig.current?.close(); }, []);
  // Never drive from a phone in someone's pocket: input goes off in the background, and back on when it returns.
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => session.setInputEnabled(st === 'active' && controlRef.current && canAct)); return () => sub.remove(); }, []);
  const watch = () => { setErr(''); watching.current = true; void open(); };
  const stop = () => { watching.current = false; void session.close().then(() => sig.current?.close()); };
  const act = (fn: () => Promise<unknown>) => async () => { setErr(''); if (await attempt(fn)) refresh(); };
  const live = session.snapshot.status;
  const idle = live === 'idle' || live === 'ended' || live === 'failed';
  const words: Record<string, string> = { opening: 'Opening…', connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', failed: "Couldn't open it" };
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T style={[s.b, { flex: 1 }]}>{bot.display}'s screen</T>
        <Pill tone={live === 'live' ? 'ok' : 'off'}>{control ? 'You have the wheel' : words[live] ?? 'Not watching'}</Pill>
      </View>
      {control && <T tone="ink2">You're driving. {bot.display} waits until you hand the wheel back.</T>}
      <View style={{ width: '100%', aspectRatio: 1280 / 800, borderRadius: 16, overflow: 'hidden', backgroundColor: t.line }}>
        <DesktopView sessionId={session.nativeId} style={{ flex: 1 }} accessibilityLabel={`${bot.display}'s screen`} keyboardClearance={120} />
        {idle && <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 16 }]}><T tone="mute" style={s.centerText}>{live === 'failed' ? words.failed : `Watch ${bot.display} work on its own computer`}</T></View>}
      </View>
      {!!err && <T tone="pinkInk">{err}</T>}
      <View style={s.chips}>
        {idle ? <Btn go label={`Watch ${bot.display}`} onPress={watch} /> : <Btn label="Stop watching" onPress={stop} />}
        {canAct && !control && <Btn label="Take the wheel" onPress={act(async () => { await api.takeOver(bot.id); watching.current = true; if (idle) watch(); })} />}
        {canAct && control && !idle && <Btn label="Keyboard" onPress={() => session.showKeyboard()} />}
      </View>
      {canAct && control && (
        <View style={{ gap: 8 }}>
          <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={note} onChangeText={setNote} placeholder={`What did you do? ${bot.display} reads this`} placeholderTextColor={t.mute} accessibilityLabel="What did you do" />
          <Btn go label="Hand it back" onPress={act(async () => { await api.giveBack(bot.id, note); setNote(''); })} />
        </View>
      )}
      <T tone="mute" style={s.small}>{bot.display} has its own computer at home, separate from yours. Taking the wheel pauses it, for a sign-in or anything it's stuck on; handing back lets it carry on.</T>
    </Card>
  );
}

/** Routines on the phone: each one's schedule and latest run, with Do it now, Pause and Remove, and a way to add one. */
function RoutineList({ state, refresh, canAct, bot }: Ctx & { bot?: string }) {
  const t = useLook();
  const crew = A.crew(state);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState(bot ?? crew[0]?.id ?? '');
  const [what, setWhat] = useState('');
  const [when, setWhen] = useState('');
  const [watch, setWatch] = useState('');
  const [preview, setPreview] = useState<Json>(null);
  useEffect(() => {
    if (!when.trim()) { setPreview(null); return; }
    const x = setTimeout(() => api.schedule(when).then(setPreview).catch(() => setPreview({ bad: true })), 250);
    return () => clearTimeout(x);
  }, [when]);
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  const list = A.routines(state, bot);
  const input = (value: string, set: (v: string) => void, placeholder: string, label: string) => (
    <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={t.mute} accessibilityLabel={label} autoCapitalize="none" />
  );
  return (
    <>
      {list.map((r: Json) => (
        <Card key={r.id} style={r.paused && { opacity: 0.7 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Face who={crew.find((h) => h.id === r.helper) ?? 'chief'} size={40} />
            <View style={{ flex: 1 }}><T style={s.b}>{r.name}</T>
              <T tone="mute" style={s.small}>{`${r.watching ? `Keeps an eye on ${r.watching} · ` : ''}${r.when}${r.paused ? ' · paused' : ` · next ${r.next}`}`}</T>
              {!!r.last && <T tone="mute" style={s.small}>{r.last}</T>}</View>
          </View>
          {canAct && <View style={s.chips}>
            <Btn label="Do it now" onPress={() => act(() => api.runRoutine(r.id), 'Started')} />
            <Btn label={r.paused ? 'Resume' : 'Pause'} onPress={() => act(() => api.routine(r.id, { state: r.paused ? 'on' : 'paused' }))} />
            {!r.digest && <Btn ghost label="Remove" onPress={() => act(() => api.removeRoutine(r.id), 'Removed')} />}
          </View>}
        </Card>
      ))}
      {!list.length && !adding && <Card><T tone="mute">Nothing on a schedule yet.</T></Card>}
      {canAct && (adding ? (
        <Card>
          <T style={s.b}>A new routine</T>
          {!bot && <View style={s.chips}>{crew.map((h) => <Btn key={h.id} label={h.name} go={who === h.id} onPress={() => setWho(h.id)} />)}</View>}
          {input(what, setWhat, 'What should they do each time?', 'What to do')}
          {input(watch, setWatch, 'A page to keep an eye on, if any', 'A page to keep an eye on')}
          {input(when, setWhen, 'When? For example: every Saturday 10am', 'When')}
          {!!preview && <T tone="mute" style={s.small}>{preview.bad ? "I didn't catch that time. Try “every Monday 9:00”." : `${preview.words}. First time ${A.clock(preview.next)}.`}</T>}
          <View style={s.chips}>
            <Btn go label="Add routine" disabled={!who || (!what.trim() && !watch.trim()) || !preview || preview.bad}
              onPress={() => act(async () => { await api.addRoutine({ bot: who, task: what, schedule: when, ...(watch.trim() ? { watch: watch.trim() } : {}) }); setAdding(false); setWhat(''); setWhen(''); setWatch(''); }, 'Routine added')} />
            <Btn ghost label="Cancel" onPress={() => setAdding(false)} />
          </View>
        </Card>
      ) : crew.length ? <Btn go label="＋ Add a routine" onPress={() => setAdding(true)} /> : <Card><T tone="mute">Add a helper first; a routine gives one of them a job on a schedule.</T></Card>)}
    </>
  );
}

/** Something shared from another app (a photo of the school poster, a link, some text): who should have it, and a word. */
function ShareIn({ state, shared, onDone, go }: { state: Json; shared: { text: string; files: { path: string; mimeType: string }[] }; onDone: () => void; go: Ctx['go'] }) {
  const t = useLook();
  const [to, setTo] = useState('chief');
  const [text, setText] = useState(shared.text);
  const [pics, setPics] = useState<Photo[] | null>(null);
  useEffect(() => {
    const images = shared.files.filter((f) => f.mimeType.startsWith('image/')).slice(0, 4);
    void Promise.all(images.map((f) => shrink(f.path.startsWith('file:') || f.path.startsWith('content:') ? f.path : `file://${f.path}`))).then(setPics, () => setPics([]));
  }, []);
  const crew = A.crew(state);
  const send = () => attempt(async () => {
    await api.post(to, text.trim(), (pics ?? []).map(({ type, data }) => ({ type, data })));
    onDone();
    go(to === 'chief' ? { view: 'chief' } : { view: 'helper', id: to });
  }, 'Sent');
  return (
    <Page title="Send this to…" lead="Chief will see it into the right hands, or pick a helper yourself.">
      {pics === null ? <ActivityIndicator color={t.pink} /> : pics.length > 0 && <View style={{ flexDirection: 'row', gap: 6 }}>{pics.map((p) => <Image key={p.uri} source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 12 }} />)}</View>}
      <View style={s.chips}>
        <Btn label="Chief" go={to === 'chief'} onPress={() => setTo('chief')} />
        {crew.map((h) => <Btn key={h.id} label={h.name} go={to === h.id} onPress={() => setTo(h.id)} />)}
      </View>
      <TextInput style={[s.input, { color: t.ink, borderColor: t.line, minHeight: 80 }]} value={text} onChangeText={setText} multiline placeholder="What should they do with it? For example: put this in the calendar" placeholderTextColor={t.mute} accessibilityLabel="What should they do with it" />
      <View style={s.chips}>
        <Btn go label="Send" disabled={pics === null || (!text.trim() && !pics.length)} onPress={send} />
        <Btn ghost label="Not now" onPress={onDone} />
      </View>
    </Page>
  );
}

/** Add a helper from the gallery, as on the computer. */
function AddHelper({ state, refresh, go }: Ctx) {
  const t = useLook();
  const [names, setNames] = useState<Record<string, string>>({});
  return (
    <Page title="Add a helper" lead="Each helper has its own little computer at home and gets better as it learns what you like. It always asks before sending, paying or deleting anything.">
      {A.gallery(state).map((g: Json) => {
        const name = (names[g.id] ?? g.name).trim() || g.name;
        return (
          <Card key={g.id}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><Face who={{ kind: g.kind, name: g.name } as any} size={52} /><T tone="ink2" style={{ flex: 1 }}>{g.does}</T></View>
            <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={names[g.id] ?? g.name} onChangeText={(v) => setNames({ ...names, [g.id]: v })} accessibilityLabel={`Name for ${g.name}`} />
            <Btn go label={`Welcome ${name}`} onPress={() => attempt(async () => { const b = await api.recruit(g.id, name); refresh(); go({ view: 'helper', id: b.id }, true); }, `${name} joined the crew`)} />
          </Card>
        );
      })}
      <Card><T style={s.b}>Need something else?</T><T tone="mute">Tell Chief in your own words, like “keep an eye on flats in Phuket”, and he'll suggest the right helper.</T></Card>
    </Page>
  );
}

function ThingsList({ list, state, empty }: { list: A.Thing[]; state: Json; empty: string }) {
  const crew = A.crew(state);
  if (!list.length) return <Card><T tone="mute" style={s.centerText}>{empty}</T></Card>;
  return (
    <>
      {list.map((x) => {
        const h = crew.find((c) => c.id === x.helper);
        return (
          <Card key={x.id} style={{ gap: 6 }}>
            <T style={s.b}>{x.title}</T>
            {!!x.summary && <T tone="mute" lines={3}>{x.summary}</T>}
            {x.files.map((f) => <FileRow key={f.url} f={f} />)}
            <View style={s.row}>{h && <Face who={h} size={26} />}<T tone="mute" style={s.small}>{h?.name ?? 'The crew'} · {A.clock(x.at)}</T></View>
          </Card>
        );
      })}
    </>
  );
}

// ---------- this phone ----------
function ThisPhone({ grant, status, onForget }: { grant: Grant; status: Status; onForget: () => void }) {
  return (
    <Page title="This phone">
      <Card>
        <T style={s.b}>{grant.device.name}</T>
        <T tone="mute">{grant.device.role === 'view' ? 'Watches the crew; can’t answer or give jobs.' : 'Answers the crew and gives them jobs, as you.'}</T>
        <View style={[s.row, { marginTop: 6 }]}><Pill tone={status === 'online' ? 'ok' : 'wait'}>{status === 'online' ? 'With the home computer' : 'Looking for the home computer…'}</Pill></View>
      </Card>
      <T tone="mute" style={s.small}>🔒 Only the computer this phone was paired with can read what it sends.</T>
      <Btn label="Unpair this phone" onPress={onForget} />
      <T tone="mute" style={s.small}>To take a phone's access away for good, remove it on the computer too: Settings, Phones.</T>
    </Page>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  centerText: { textAlign: 'center' },
  page: { padding: 16, gap: 12, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { fontSize: 16, lineHeight: 22 },
  h1: { fontSize: 28, lineHeight: 36, fontWeight: '900', letterSpacing: -0.5, marginVertical: 4 },
  h2: { fontSize: 20, fontWeight: '800', lineHeight: 27 },
  b: { fontWeight: '800' },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 14 },
  fp: { fontSize: 22, fontWeight: '800', letterSpacing: 2.5, fontVariant: ['tabular-nums'], marginVertical: 8, textAlign: 'center' },
  card: { borderRadius: radius.card, padding: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: radius.chip, paddingVertical: 5, paddingLeft: 9, paddingRight: 12, maxWidth: '100%', elevation: 2 },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  btn: { borderRadius: radius.chip, paddingVertical: 11, paddingHorizontal: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnBig: { alignSelf: 'stretch', paddingVertical: 15 },
  btnText: { fontSize: 15, fontWeight: '800' },
  input: { borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 28, borderWidth: 1.5, paddingVertical: 6, paddingRight: 6, paddingLeft: 18 },
  composerInput: { flex: 1, fontSize: 16, paddingVertical: 8, maxHeight: 140 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dock: { paddingHorizontal: 12, paddingVertical: 8 },
  bubble: { alignItems: 'center', gap: 4, width: 64 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  stepDot: { width: 10, height: 10, borderRadius: 5 },
  line: { maxWidth: '84%', gap: 4, alignSelf: 'flex-start' },
  bubbleText: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 22 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  palCard: { width: '48%', borderRadius: radius.card, borderWidth: 1, padding: 14, alignItems: 'center', gap: 8 },
  tabPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.chip, borderWidth: 1.5, borderColor: 'transparent' },
  tabPillText: { fontSize: 14, fontWeight: '800' },
  tabbar: { flexDirection: 'row', borderTopWidth: 1, paddingVertical: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 1, minHeight: 48, justifyContent: 'center' },
  tabIcon: { fontSize: 20 },
  tabLabel: { fontSize: 11.5, fontWeight: '700' },
  unread: { minWidth: 20, height: 20, borderRadius: 10, color: '#2e2a40', fontSize: 12, fontWeight: '900', textAlign: 'center', overflow: 'hidden', paddingHorizontal: 5, lineHeight: 20 },
  badge: { position: 'absolute', top: 0, left: '58%', minWidth: 18, height: 18, borderRadius: 9, color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center', overflow: 'hidden', paddingHorizontal: 4 },
  offline: { textAlign: 'center', padding: 6, fontSize: 13, fontWeight: '700' },
  toast: { position: 'absolute', bottom: 84, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.chip, fontWeight: '700', overflow: 'hidden', maxWidth: '90%' },
  scanHint: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, gap: 12, backgroundColor: '#000a' },
  scrim: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  sheet: { padding: 22, gap: 12, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
});
