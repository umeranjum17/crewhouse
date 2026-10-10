// The Crewhouse phone app: the web app's screens (Pocket Pals), over the encrypted link to crewd.
// Everything a person reads comes through web/src/adapter.ts, the same plain-words view models as the web app
// (docs/ui-contract.md); the colours are web/src/tokens.ts and the mascots are web/src/art.ts, drawn as dots.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFonts } from 'expo-font';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, Clipboard, Image, KeyboardAvoidingView, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, useColorScheme, useWindowDimensions, View,} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as A from '../web/src/adapter.ts';
import { chatTokens, safeLink } from '../web/src/chat-md.ts';
import { api, setTransport, trouble, type Json } from '../web/src/api.ts';
import { draftOf, keepDraft, sent } from '../web/src/draft.ts';
import * as art from '../web/src/art.ts';
import { color, radius } from '../web/src/tokens.ts';
import { CONTROL_PERMISSIONS, DesktopView, useDesktopSession } from '@desklink/react-native';
import { desktopAvailable } from '@desklink/react-native/availability';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';

// React Native always defines this; @types/react-native is not installed, so say so once for tsc.
declare const __DEV__: boolean;
import * as Notifications from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import { VideoView, useVideoPlayer } from 'expo-video';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useShareIntent } from 'expo-share-intent';
import { qrMatrix } from '@byokit/ui-core';
import * as motion from './src/motion';
import { MARKS } from './src/marks';
import { askOf, sharedOf } from './src/ask';
import { BUBBLE_DP, bubbleOff, bubbleOn, bubbleResume, bubbleState, bubbleWords, openBubblePermission, showCrew, useBubbleEdge, wanted, type OverlayState } from './src/bubble';
import { chip, chipSettings, chipState, chipWords, onChip, type StatusState } from './src/chip';
import { island } from './src/island';
import { Office, useOffice } from './src/office';
import { crewPill, chiefPill } from './src/crew-status';
import { canHear, hear, stopHearing } from './modules/crewhouse-net';
import { connect, desktopSignaling, forgetGrant, kept, LINK_WORDS, loadGrant, onLive, pair, pairTypedCode, type Grant, type Status } from './src/link';

// ---------- look ----------
type Look = typeof color.day & { go: string; goInk: string; solid: string; soft: string; card: string; ok: string; wait: string; pinkInk: string; night: boolean };
const look = (night: boolean): Look => {
  const c = night ? color.night : color.day;
  return { ...c, go: c.accent, goInk: c.onAccent, solid: c.surface, soft: c.sunken, card: c.surface, ok: c.green, wait: c.pink, pinkInk: c.pink, night };
};
const Theme = createContext<Look>(look(false));
const useLook = () => useContext(Theme);

/** Two token colours blended (RN has no CSS color-mix): the ask card's border is 40% pink into the line. */
const mix = (a: string, b: string, f: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(p(a, i) * f + p(b, i) * (1 - f)).toString(16).padStart(2, '0')).join('');
};

// ---------- toasts and actions ----------
// Each mounted Toast (the app's, and the bubble's panel's over other apps) takes its turn; the newest one speaks.
const toasts: ((m: string) => void)[] = [];
const say = (m: string) => toasts.at(-1)?.(m);
const FRIENDLY = {
  missing: "That isn't ready yet. It arrives with the next Crewhouse update.",
  offline: "Can't reach the home computer right now. Check it's on, then try again.",
  failed: 'That didn’t work. Please try again.',
};
/** Run an action; a failure becomes a friendly toast, never an error message (web/src/parts.tsx attempt). `quiet`
 *  leaves the word to the caller — the composer's own "Not sent. Retry" line. */
async function attempt(fn: () => Promise<unknown>, ok?: string, quiet = false) {
  try { await fn(); if (ok) say(ok); return true; } catch (e: any) { if (!quiet) say(FRIENDLY[trouble(e)]); return false; }
}
function Toast() {
  const [m, setM] = useState('');
  const t = useLook();
  useEffect(() => {
    let x: any;
    const mine = (s: string) => { setM(s); clearTimeout(x); x = setTimeout(() => setM(''), 2600); };
    toasts.push(mine);
    return () => { clearTimeout(x); toasts.splice(toasts.indexOf(mine), 1); };
  }, []);
  return m ? <Text style={[s.toast, { backgroundColor: t.ink, color: t.bg }]}>{m}</Text> : null;
}

export default function App() {
  const t = look(useColorScheme() === 'dark');
  const [fontsReady, fontError] = useFonts({ Inter: require('./assets/fonts/InterVariable.ttf') });
  const [grant, setGrant] = useState<Grant | null | undefined>(undefined);
  useEffect(() => { loadGrant().then(setGrant).catch(() => setGrant(null)); }, []);
  return (
    <Theme.Provider value={t}>
      <SafeAreaProvider>
        <StatusBar barStyle={t.night ? 'light-content' : 'dark-content'} backgroundColor={t.bg} />
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
          {!fontsReady && !fontError ? <Center><ActivityIndicator color={t.ink} /></Center>
            : grant === undefined ? <Center><ActivityIndicator color={t.ink} /></Center>
            : grant === null ? <Pair onPaired={setGrant} />
            : <Crewhouse grant={grant} onRemoved={() => setGrant(null)} />}
          <Toast />
        </SafeAreaView>
      </SafeAreaProvider>
    </Theme.Provider>
  );
}

// ---------- the mascots, as dots ----------
function Dots({ rows, pal, d, crisp = false }: { rows: art.Bitmap; pal: art.Palette; d: number; crisp?: boolean }) {
  return (
    <View accessible={false}>
      {rows.map((r, y) => (
        <View key={y} style={{ flexDirection: 'row' }}>
          {[...r].map((k, x) => <View key={x} style={{ width: d, height: d, padding: crisp ? 0 : d * 0.06 }}>{pal[k] ? <View style={{ flex: 1, borderRadius: crisp ? 0 : d, backgroundColor: pal[k] }} /> : null}</View>)}
        </View>
      ))}
    </View>
  );
}
/** Chief or a helper in dots (art.helmetDots): the phone sets no text in mono, so the shading rides on dot
 *  opacity. Every helper wears the same small helmet; `whole` draws all of it. */
function Ink({ who, mood = 'idle', size, whole, wave }: { who: art.Kind | 'chief'; mood?: art.Mood; size: number; whole?: boolean; wave?: boolean }) {
  const t = useLook();
  const cols = whole ? 30 : 20;
  const { rows, pal } = art.helmetDots(cols, art.helmetOf(mood), t.night, 0);
  return <Dots rows={rows} pal={pal} d={size / cols} />;
}
function ChiefArt({ mood = 'idle', size, whole, wave }: { mood?: art.Mood; size: number; whole?: boolean; wave?: boolean }) {
  return <Ink who="chief" mood={mood} size={size} whole={whole} wave={wave} />;
}
/** A round face: Chief or a pal, with a ring when it's working or needs you. */
function Face({ who, size = 44, mood }: { who: A.Helper | 'chief' | { kind: art.Kind; name: string; mood?: art.Mood }; size?: number; mood?: art.Mood }) {
  const t = useLook();
  const chief = who === 'chief';
  const ring = chief || !('ring' in who) ? '' : who.ring;
  return (
    <View style={{ width: size, height: size, borderRadius: size, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      backgroundColor: chief && t.night ? '#2A2622' : t.surface, borderWidth: ring ? 2 : 0, borderColor: ring === 'needs' ? t.pink : t.green }}>
      <Ink who={chief ? 'chief' : who.kind} mood={chief ? mood : who.mood} size={size * 0.8} />
    </View>
  );
}
/** The dot colour for a tone: the app's own ok green, wait pink, off grey, plus the crew rail's
 *  colours (danger red, amber, ink, and work — the rail's hollow ink ring). */
function pillDot(t: Look, tone: 'ok' | 'wait' | 'off' | 'danger' | 'amber' | 'ink' | 'work') {
  if (tone === 'work') return { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: t.ink };
  const c = tone === 'wait' ? t.wait : tone === 'off' ? t.line : tone === 'danger' ? t.danger : tone === 'amber' ? t.amber : tone === 'ink' ? t.ink : t.ok;
  return { backgroundColor: c };
}
function Pill({ tone = 'ok', children }: { tone?: 'ok' | 'wait' | 'off' | 'danger' | 'amber' | 'ink' | 'work'; children: ReactNode }) {
  const t = useLook();
  return (
    <View style={[s.pill, { backgroundColor: t.solid }]}>
      <View style={[s.pillDot, pillDot(t, tone)]} />
      <Text style={[s.pillText, { color: t.ink }]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

/** An AI account's own mark, white on its brand tile. */
function AiMark({ ai, size = 32 }: { ai: { key: string; bg: string }; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: ai.bg, alignItems: 'center', justifyContent: 'center' }}>
    <Image source={MARKS[ai.key]} style={{ width: size * 0.56, height: size * 0.56 }} accessibilityIgnoresInvertColors />
  </View>;
}

// ---------- small pieces ----------
/** Chief's warm halo, where he greets you: first run, pairing, the words to check. */
function Halo({ children }: { children: ReactNode }) {
  const t = useLook();
  return <View style={[s.halo, s.warmRing, { backgroundColor: t.night ? '#2A2638' : '#EEF1F6', borderColor: t.night ? '#221F2E' : '#F6F7F9' }]}>{children}</View>;
}
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
      <Text style={[s.btnText, { color: go ? t.goInk : ghost ? t.ink2 : t.ink }]}>{label}</Text>
    </Pressable>
  );
}
function ChatText({ text }: { text: string }) {
  const t = useLook();
  const [more, setMore] = useState(false);
  const long = text.length > 700 || text.split('\n').length > 10;
  const shown = long && !more ? text.slice(0, 650).replace(/\s+\S*$/, '') : text;
  const inline = (tokens: any[]): ReactNode => tokens.map((x, i) => x.type === 'strong' ? <Text key={i} style={s.b}>{inline(x.tokens)}</Text>
    : x.type === 'em' ? <Text key={i} style={{ fontStyle: 'italic' }}>{inline(x.tokens)}</Text>
    : x.type === 'link' && safeLink(x.href) ? <Text key={i} accessibilityRole="link" onPress={() => void Linking.openURL(safeLink(x.href))} style={{ textDecorationLine: 'underline', backgroundColor: t.soft, color: t.ink }}>{inline(x.tokens)}</Text>
    : x.type === 'html' ? x.raw : x.tokens ? <Text key={i}>{inline(x.tokens)}</Text> : x.text ?? x.raw);
  const blocks = (tokens: any[]): ReactNode => tokens.map((x, i) => x.type === 'heading' ? <T key={i} style={{ fontSize: 18, lineHeight: 25, fontWeight: '600', marginTop: 8 }}>{inline(x.tokens)}</T>
    : x.type === 'paragraph' || x.type === 'text' ? <T key={i}>{inline(x.tokens ?? [{ text: x.text }])}</T>
    : x.type === 'list' ? <View key={i} style={{ gap: 5 }}>{x.items.map((item: any, j: number) => <View key={j} style={{ flexDirection: 'row', gap: 6 }}><T>{item.task ? item.checked ? '☑' : '☐' : '•'}</T><View style={{ flex: 1 }}>{blocks(item.tokens.filter((y: any) => y.type !== 'checkbox'))}</View></View>)}</View>
    : x.type === 'table' ? <Wide key={i}><View>{[x.header, ...x.rows].map((row: any[], j: number) => <View key={j} style={{ flexDirection: 'row' }}>{row.map((c, k) => <View key={k} style={{ minWidth: 90, maxWidth: 200, padding: 6, borderWidth: 1, borderColor: t.line }}><T style={j ? undefined : s.b}>{inline(c.tokens)}</T></View>)}</View>)}</View></Wide>
    : x.type === 'code' ? <T key={i} style={{ backgroundColor: t.soft }}>{x.text}</T>
    : x.type === 'html' ? <T key={i}>{x.raw}</T> : null);
  return <View style={{ gap: 10, maxWidth: 560 }}>{blocks(chatTokens(shown))}{long && <Pressable onPress={() => setMore(!more)} accessibilityRole="button"><T style={s.b}>{more ? 'Less' : 'More'}</T></Pressable>}</View>;
}

function ChiefAsk({ l }: { l: { text: string; detail: string } }) {
  const [open, setOpen] = useState(false);
  return <View style={{ paddingLeft: 36, gap: 4 }}>
    <T>{l.text}</T>
    <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityLabel={open ? 'Hide details' : 'Show details'} hitSlop={6}>
      <T style={s.b}>{open ? 'Hide details' : 'Show details'}</T>
    </Pressable>
    {open && <ChatText text={l.detail} />}
  </View>;
}

/** An empty list, said warmly: the shared ornament and a plain line, never a blank box. */
function Empty({ children }: { children: ReactNode }) {
  return <Card style={{ alignItems: 'center', paddingVertical: 22 }}><T tone="mute" style={s.small}>{art.ORNAMENT}</T><T tone="ink2" style={s.centerText}>{children}</T></Card>;
}
function Card({ children, style, ask, onTouchStart }: { children: ReactNode; style?: any; ask?: boolean; onTouchStart?: () => void }) {
  const t = useLook();
  return <View onTouchStart={onTouchStart} style={[s.card, { backgroundColor: t.card, borderColor: ask ? mix(t.pink, t.line, 0.4) : t.line, borderWidth: 1 }, ask && s.askCard, style]}>{children}</View>;
}
/** The Add-a-phone card in Chief's chat, on the phone. It refreshes itself like the computer's card: a new code while
 *  it is on screen and someone is about (ten minutes), then a Show-a-new-code button — never directions to go elsewhere. */
function PhoneCard({ offer, reload }: { offer: NonNullable<ReturnType<typeof A.phoneOffer>>; reload: () => void }) {
  const [current, setCurrent] = useState(offer);
  const [now, setNow] = useState(Date.now());
  const active = useRef(Date.now());
  const busy = useRef(false);
  useEffect(() => { if (offer.token !== current.token) setCurrent(offer); }, [offer.token]);
  const renew = async () => {
    if (busy.current) return;
    busy.current = true;
    try { setCurrent(await api.refreshPhone(current.message)); reload(); } catch { active.current = 0; say('Could not show a new code'); }
    finally { busy.current = false; }
  };
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (now >= current.expires && now - active.current < 10 * 60_000 && !offer.waiting && !offer.joined) void renew(); }, [now, current.expires, offer.waiting, offer.joined]);
  const left = Math.max(0, Math.ceil((current.expires - now) / 1000));
  const qr = current.qr.startsWith('byokit-link:') ? qrMatrix(current.qr, { border: 0 }) : null;
  return <Card style={{ gap: 10, marginLeft: 36 }} onTouchStart={() => { active.current = Date.now(); }}>
    <T style={s.b}>Add a phone</T>
    {!offer.joined && <T tone="mute">The other phone will answer the crew and give them jobs, as you.</T>}
    {!offer.joined && !offer.waiting && left > 0 && qr && <View accessibilityLabel="Scan to pair another phone" style={{ width: 220, height: 220, backgroundColor: 'white', padding: 8 }}><View style={{ flex: 1 }}>{qr.map((row, y) => <View key={y} style={{ flex: 1, flexDirection: 'row' }}>{row.map((dark, x) => <View key={x} style={{ flex: 1, backgroundColor: dark ? 'black' : 'white' }} />)}</View>)}</View></View>}
    {offer.joined ? <T style={s.b}>Paired: {offer.joined}</T> : offer.waiting ? <><T>{offer.waiting.name} is waiting. Check these two words: {offer.waiting.words}</T><T tone="mute">For your safety, approve on the computer where this code was shown.</T></> : left ? <><T>Scan this with the other phone, or type this code there. Approve on the computer.</T><T style={s.b}>{current.typed}</T><Btn label="Copy code" onPress={() => { Clipboard.setString(current.typed); say('Code copied'); }} /><T tone="mute">Works once · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</T></>
      : <><T tone="mute">That code has run out.</T><Btn go label="Show a new code" onPress={() => { active.current = Date.now(); void renew(); }} /></>}
  </Card>;
}
/** A section's name, in small capitals; `count` is the pink number beside Needs you. */
function Label({ children, count }: { children: ReactNode; count?: number }) {
  const t = useLook();
  return <View style={s.labelRow}><T tone="ink2" style={s.label}>{children}</T>{!!count && <Text style={[s.count, { backgroundColor: t.pink, color: t.night ? '#1A0F14' : '#fff' }]}>{count}</Text>}</View>;
}
/** A screen of its own. `back` is its way out (B1 has no tab bar): "‹ Home", or the screen it came from. */
function Page({ title, lead, back, children }: { title?: string; lead?: string; back?: [string, () => void]; children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      {!!back && <Pressable onPress={back[1]} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}><T tone="ink2" style={s.b}>{`\u2039 ${back[0]}`}</T></Pressable>}
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

/** The voice note to Chief: a mic in the box when this phone can hear on the phone itself (web/src/parts.tsx
 *  useVoice). What was said lands after what is already there, for the person to read and send; speaking sends nothing. */
function Mic({ on, text, put, listen = false }: { on: boolean; text: string; put: (t: string) => void; listen?: boolean }) {
  const t = useLook();
  const [can, setCan] = useState(false);
  const [listening, setListening] = useState(false);
  const now = useRef(text);
  now.current = text;
  const shown = useRef(true);
  useEffect(() => () => { shown.current = false; }, []);
  useEffect(() => (listening ? () => stopHearing() : undefined), [listening]); // leaving the box turns the mic off
  const start = async () => {
    setListening(true);
    const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, { title: 'Speak to Chief',
      message: 'Crewhouse hears you only while the mic is on, on this phone. Your words wait in the box until you send them.', buttonPositive: 'OK' });
    if (!shown.current) return;
    if (mic !== PermissionsAndroid.RESULTS.GRANTED) { setListening(false); return say('Allow the microphone for Crewhouse in your phone settings, then try again.'); }
    hear().then((w) => { if (w) put(now.current.trim() ? `${now.current.trimEnd()} ${w}` : w); else say("I didn't catch that. Try again."); },
      (e) => say(/blocked/.test(`${e?.code} ${e?.message}`) ? 'Allow the microphone for Crewhouse in your phone settings, then try again.'
        : "Speaking isn't ready on this phone yet. Type instead, or use the keyboard's mic."))
      .finally(() => setListening(false));
  };
  // `listen`: opened by holding the bubble, so the mic starts at once (it is this screen's, never the bubble's).
  useEffect(() => { if (on) void canHear().then((c) => { setCan(c); if (c && listen && shown.current) void start(); }); }, [on]);
  if (!can) return null;
  return <Pressable onPress={() => (listening ? stopHearing() : void start())} accessibilityRole="button" accessibilityLabel={listening ? 'Stop listening' : 'Speak to Chief'}
    accessibilityState={{ selected: listening }} style={[s.send, { backgroundColor: listening ? t.pink : 'transparent' }]}>
    {listening ? <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: '#fff' }} />
      : <View style={{ alignItems: 'center' }}>
        <View style={{ width: 10, height: 15, borderRadius: 5, borderWidth: 2, borderColor: t.ink2 }} />
        <View style={{ width: 16, height: 7, marginTop: -4, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 2, borderTopWidth: 0, borderColor: t.ink2 }} />
        <View style={{ width: 2, height: 3, backgroundColor: t.ink2 }} />
      </View>}
  </Pressable>;
}

/** The message box: words (the phone keyboard's own mic dictates them; Chief's box has its own) and up to four
 *  photos. A send that didn't go through keeps both with a Retry; each chat holds its own words (web/src/draft.ts). */
function Composer({ placeholder, onSend, chat, photos: canPhoto = true, away, mic = chat === 'chief', listen }: { placeholder: string; onSend: (t: string, photos: Photo[]) => unknown; chat?: string; photos?: boolean; mic?: boolean; listen?: boolean; away?: boolean }) {
  const t = useLook();
  const [text, setText] = useState(() => (chat ? draftOf(chat).text : ''));
  const [pics, setPics] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = !!text.trim() || pics.length > 0;
  // Chief's box (B1): the send stays dark while there is nothing to send, never a faded accent.
  const dark = chat === 'chief', on = ready && !busy && !away;
  const change = (x: string) => { setText(x); setFailed(false); if (chat) keepDraft(chat, x); };
  const send = async () => {
    if (away || busy || (!text.trim() && !pics.length)) return;
    const x = text.trim(), p = pics;
    setBusy(true);
    let ok = false;
    try { ok = !!(await onSend(x, p)); } catch { ok = false; }
    setBusy(false);
    if (ok) { setText(''); setPics([]); if (chat) keepDraft(chat, ''); } else { setFailed(true); if (chat) sent(chat, false, text); }
  };
  const pick = () => attempt(async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4 - pics.length, quality: 1 });
    if (r.canceled) return;
    const made = await Promise.all(r.assets.slice(0, 4 - pics.length).map((a) => shrink(a.uri)));
    setPics((p) => [...p, ...made].slice(0, 4));
  });
  return (
    <View style={{ gap: 6 }}>
      {away && <T tone="ink2" style={[s.small, { paddingHorizontal: 8 }]}>Reconnecting… your words stay here until the home computer answers.</T>}
      {!away && failed && <View style={s.row}>
        <T tone="pinkInk" style={[s.small, { flex: 1 }]}>Not sent — it's kept here.</T>
        <Btn label="Retry" onPress={() => void send()} />
      </View>}
      {pics.length > 0 && <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 8 }}>
        {pics.map((p, i) => (
          <Pressable key={p.uri} onPress={() => setPics((x) => x.filter((_, j) => j !== i))} accessibilityLabel={`Remove photo ${i + 1}`}>
            <Image source={{ uri: p.uri }} style={{ width: 56, height: 56, borderRadius: 12 }} />
          </Pressable>
        ))}
      </View>}
      <View style={[s.composer, { backgroundColor: t.solid, borderColor: t.line, opacity: busy ? 0.7 : 1 }]}>
        {canPhoto && <Pressable onPress={pick} disabled={pics.length >= 4} accessibilityLabel="Add a photo" style={[s.send, { backgroundColor: 'transparent' }]}>
          <Text style={{ color: t.ink, fontSize: 20 }}>＋</Text>
        </Pressable>}
        <TextInput style={[s.composerInput, { color: t.ink }]} value={text} onChangeText={change} multiline placeholder={placeholder} placeholderTextColor={t.mute} accessibilityLabel={placeholder} />
        <Mic on={mic} text={text} put={change} listen={listen} />
        <Pressable onPress={() => void send()} disabled={away || !ready || busy} accessibilityLabel="Send" accessibilityState={{ disabled: away || !ready || busy }} style={[s.send, dark ? { backgroundColor: on ? t.go : t.ink, borderRadius: 10 } : { backgroundColor: t.go, opacity: on ? 1 : 0.4 }]}>
          <Text style={{ color: dark && !on ? t.solid : t.goInk, fontSize: 18, fontWeight: '900' }}>↑</Text>
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
/** A photo someone sent: fetched over the link as data (this computer's /files address isn't reachable from the phone). */
function PhotoView({ f }: { f: A.FileView }) {
  const [uri, setUri] = useState('');
  const src = A.fileSource(f.url);
  useEffect(() => { if (src) void api.photo(src.bot, src.path).then((p) => setUri(`data:${p.type};base64,${p.data}`)).catch(() => {}); }, [f.url]);
  return uri ? <Image source={{ uri }} style={{ width: 240, height: 240, borderRadius: 16 }} resizeMode="contain" accessibilityLabel="A photo" /> : <FileRow f={f} plain />;
}

/** Files open right here, through the same crewd-parsed words the web's reader shows — a document (.docx, .md, .txt),
 *  a spreadsheet (.xlsx), a video fetched in pieces over the link. Anything else really is on the computer. */
function FileRow({ f, plain }: { f: A.FileView; plain?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!plain && f.kind === 'image' && /\/photos\//.test(f.url)) return <PhotoView f={f} />;
  const t = useLook();
  const readable = A.phoneReadable(f);
  const word = f.kind === 'video' ? 'Play' : 'Read';
  const kind = f.kind === 'video' ? 'Video' : f.kind === 'image' ? 'Picture' : f.kind === 'sheet' ? 'Spreadsheet' : 'Document';
  // The name gets the room: a tile, the name on up to two lines with its kind under it, then Read or Play.
  const row = <View style={s.row}>
    <View style={[s.fileIc, { backgroundColor: t.solid, borderColor: t.line }]}><T tone={f.kind === 'sheet' ? undefined : 'ink2'} style={[s.fileGlyph, f.kind === 'sheet' && { color: t.ok }]}>{f.kind === 'video' ? '▶' : f.kind === 'image' ? '▣' : f.kind === 'sheet' ? '▦' : '▤'}</T></View>
    <View style={{ flex: 1, gap: 2 }}><T style={[s.rowTitle, s.b]} lines={2}>{f.name}</T><T tone="mute" style={s.small} lines={1}>{readable ? kind : `${kind} · on your computer`}</T></View>
    {readable && <View style={[s.fileOpen, { backgroundColor: t.solid, borderColor: t.line2 }]}><T style={s.btnText}>{word}</T></View>}
  </View>;
  if (!readable) return row;
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${word} ${f.name}`} onPress={() => setOpen(true)}
      style={({ pressed }) => [pressed && { opacity: 0.55 }]}>{row}</Pressable>
    {open && (f.kind === 'video'
      ? <VideoSheet f={f} onClose={() => setOpen(false)} />
      : <DocSheet f={f} onClose={() => setOpen(false)} />)}
  </View>;
}

/** A wide table on a narrow screen: the columns are reachable, so say how — a quiet line under the table. */
function Wide({ children }: { children: ReactNode }) {
  const [box, setBox] = useState(0);
  const [wide, setWide] = useState(false);
  return <View>
    <View onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} onContentSizeChange={(w) => setWide(w > box + 8)}>{children}</ScrollView>
    </View>
    {wide && <T tone="mute" style={[s.small, { textAlign: 'right' }]}>Swipe sideways to see it all ›</T>}
  </View>;
}

/** A table as a grid. A sheet's (given its row numbers and cell roles) reads like the web's panel: letters over the
 *  columns, row numbers down the side, the heading row set apart, soft yellow to fill in, soft blue worked out.
 *  RN has no table layout, so every column gets one width from its longest words and the rows line up. */
function SheetGrid({ head, rows, nums, roles }: { head: string[]; rows: string[][]; nums?: number[]; roles?: string[][] }) {
  const t = useLook();
  const all = [head, ...rows];
  const cols = [...Array(Math.max(0, ...all.map((r) => r.length))).keys()];
  const w = cols.map((c) => Math.min(200, Math.max(90, 14 + 7.5 * Math.max(...all.map((r) => (r[c] ?? '').length)))));
  const edge = { width: 36, padding: 4, borderWidth: 1, borderColor: t.line, backgroundColor: t.soft, alignItems: 'center' as const };
  const tint = (role: string) => (role === 'in' ? t.cellIn : role === 'calc' ? t.cellCalc : t.solid);
  return <View>
    {nums && <View style={{ flexDirection: 'row' }}><View style={edge} />{cols.map((c) =>
      <View key={c} style={[edge, { width: w[c] }]}><T tone="mute" style={s.small}>{A.column(c)}</T></View>)}</View>}
    {all.map((row, j) => <View key={j} style={{ flexDirection: 'row' }}>
      {nums && <View style={edge}><T tone="mute" style={s.small}>{String(nums[j] ?? j + 1)}</T></View>}
      {cols.map((k) => { const role = roles?.[j]?.[k] || (j ? '' : 'head');
        return <View key={k} style={{ width: w[k], padding: 6, borderWidth: 1, borderColor: t.line, backgroundColor: tint(role), borderBottomWidth: role === 'head' ? 2 : 1, borderBottomColor: role === 'head' ? t.line2 : t.line }}>
          <T style={role === 'head' ? s.b : undefined}>{row[k] ?? ''}</T></View>; })}
    </View>)}
  </View>;
}

/** A document's parts as the web's reader shows them: headings, paragraphs, bullets and tables. */
function DocParts({ parts }: { parts: A.DocPart[] }) {
  const runs: (A.DocPart | A.DocPart[])[] = [];
  parts.forEach((p) => { const last = runs.at(-1); if (p.kind === 'li' && Array.isArray(last)) last.push(p); else if (p.kind === 'li') runs.push([p]); else runs.push(p); });
  return <View style={{ gap: 12, paddingTop: 12, paddingBottom: 24 }}>{runs.map((run, i) => Array.isArray(run)
    ? <View key={i} style={{ gap: 6 }}>{run.map((li, j) => <View key={j} style={{ flexDirection: 'row', gap: 8 }}><T style={s.read}>•</T><T style={[s.read, { flex: 1 }]}>{li.text}</T></View>)}</View>
    : run.kind === 'heading' ? <T key={i} style={{ fontSize: 18, lineHeight: 25, fontWeight: '600', marginTop: i ? 6 : 0 }}>{run.text}</T>
    : run.kind === 'table' ? <Wide key={i}><SheetGrid head={run.head ?? []} rows={run.rows ?? []} /></Wide>
    : <T key={i} style={[s.read, run.bold && s.b]}>{run.text}</T>)}</View>;
}

/** One rendered file over the link, read-only: a spreadsheet is its sheets as tables, a document its headings,
 *  paragraphs and tables, a written page its own words through the shared safe markdown renderer. */
function DocSheet({ f, onClose }: { f: A.FileView; onClose: () => void }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  const [page, setPage] = useState<Json | null>(null);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    const src = A.fileSource(f.url);
    if (src) void (f.kind === 'sheet' ? api.workbook(src.bot, src.path) : api.document(src.bot, src.path)).then(setPage).catch(() => {});
  }, [f.url]);
  const book = f.kind === 'sheet' && page ? A.workbook(page, f.name) : null;
  const doc = f.kind === 'page' && page && Array.isArray(page?.parts) ? A.document(page, f.name) : null;
  const text = page && !book && !doc ? A.mdPlain(String(page?.text ?? '')) : null;
  const sheets = book?.sheets ?? [];
  const sNow = sheets[Math.min(tab, Math.max(0, sheets.length - 1))];
  const more = sNow ? sNow.total - sNow.rows.length - 1 : 0;
  return <Modal visible transparent animationType={motion.sheet(reduce)} onRequestClose={onClose}>
    <Pressable style={s.scrim} onPress={onClose}>
      <Pressable style={[s.sheet, { backgroundColor: t.bg, maxHeight: '88%' }]} onPress={() => {}}>
        <View style={[s.row, { paddingBottom: 12, borderBottomWidth: 1, borderColor: t.line }]}>
          <View style={[s.fileIc, { backgroundColor: t.solid, borderColor: t.line }]}><T tone={f.kind === 'sheet' ? undefined : 'ink2'} style={[s.fileGlyph, f.kind === 'sheet' && { color: t.ok }]}>{f.kind === 'sheet' ? '▦' : '▤'}</T></View>
          <T style={[s.h2, { flex: 1 }]} lines={2}>{f.name}</T><Btn label="Close" onPress={onClose} /></View>
        <ScrollView style={{ flexShrink: 1 }}>
          {page === null && <T tone="mute">Opening “{f.name}”…</T>}
          {page !== null && !book && !doc && !text && <T tone="mute">There is nothing in it to show yet.</T>}
          {sNow && <View style={{ gap: 8, paddingTop: 12 }}><Wide><SheetGrid head={sNow.head} rows={sNow.rows} nums={sNow.nums} roles={sNow.roles} /></Wide>
            {more > 0 && <T tone="mute" style={s.small}>{`…and ${more === 1 ? 'one more row' : `${more} more rows`}. Open it on the computer to see the whole sheet.`}</T>}</View>}
          {doc && (doc.parts.length ? <DocParts parts={doc.parts} /> : <T tone="mute">There is nothing in it to show yet.</T>)}
          {text != null && text !== '' && <ChatText text={text} />}
        </ScrollView>
        {/* the sheet's tabs sit under it, as in the file's own program */}
        {sheets.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, borderTopWidth: 1, borderColor: t.line, paddingTop: 8 }}
          contentContainerStyle={{ gap: 8 }}>{sheets.map((x, i) => <Btn key={`${x.name}-${i}`} go={x === sNow} label={x.name} onPress={() => setTab(i)} />)}</ScrollView>}
      </Pressable>
    </Pressable>
  </Modal>;
}

/** A finished video, brought over the link in pieces and played here — the phone can't reach the computer's own address. */
function VideoSheet({ f, onClose }: { f: A.FileView; onClose: () => void }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  const [part, setPart] = useState(0); // bytes fetched so far
  const [size, setSize] = useState(0);
  const [uri, setUri] = useState('');
  const [err, setErr] = useState('');
  const player = useVideoPlayer(uri ? { uri } : null);
  // The frame takes the video's own shape, so a portrait video fills it instead of sitting in black bands.
  const [shape, setShape] = useState(16 / 9);
  const screen = useWindowDimensions();
  useEffect(() => {
    const sub = player.addListener('sourceLoad', ({ availableVideoTracks: [v] }) => { if (v?.size.width && v.size.height) setShape(v.size.width / v.size.height); });
    return () => sub.remove();
  }, [player]);
  useEffect(() => {
    const src = A.fileSource(f.url);
    if (!src) { setErr("This video can't open here."); return; }
    let on = true;
    const file = new File(Paths.cache, `crewhouse-video-${Date.now()}${(f.url.match(/\.(mp4|webm|mov)$/i) ?? ['.mp4'])[0]}`);
    (async () => {
      try {
        file.create();
        let after = 0;
        for (;;) {
          const chunk = await api.video(src.bot, src.path, after);
          if (!on) return;
          file.write(chunk.data, { encoding: 'base64', append: after > 0 });
          after += Math.floor(chunk.data.length * 3 / 4);
          setSize(chunk.size);
          setPart(after);
          if (!chunk.more) break;
        }
        if (on) setUri(file.uri);
      } catch { if (on) setErr("Couldn't bring it over. Check the home computer is awake, then try again."); }
    })();
    return () => { on = false; file.delete(); };
  }, [f.url]);
  useEffect(() => { if (uri) player.play(); }, [uri]);
  return <Modal visible transparent animationType={motion.sheet(reduce)} onRequestClose={onClose}>
    <Pressable style={s.scrim} onPress={onClose}>
      <Pressable style={[s.sheet, { backgroundColor: t.bg }]} onPress={() => {}}>
        <View style={s.row}><T tone="mute">▶</T><T style={[s.h2, { flex: 1 }]}>{f.name}</T><Btn label="Close" onPress={onClose} /></View>
        {uri ? <VideoView player={player} contentFit="contain" style={{ width: Math.min(screen.width - 44, screen.height * 0.62 * shape), aspectRatio: shape, alignSelf: 'center', borderRadius: 12 }} accessibilityLabel={`Playing ${f.name}`} />
          : err ? <T tone="pinkInk">{err}</T>
          : <T tone="mute">Getting it from your computer… {size ? `${Math.min(100, Math.round((part / size) * 100))}%` : ''}</T>}
      </Pressable>
    </Pressable>
  </Modal>;
}

// ---------- pairing ----------
/** One plain line for a pairing failure, and the retry is the action — never the machinery's own words.
 *  The link's own sentences already say which mistake it was (the computer said no, the code didn't match, that
 *  address is unreachable), so a message the link owns passes through as it is; only machinery text is replaced. */
const pairWords = (e: any): string => {
  const m = String(e?.message ?? e ?? '');
  if (/isn't a pairing code/i.test(m)) return "That's not a Crewhouse code. Point the camera at the code on your computer, then try again.";
  if (/run out|expired/i.test(m)) return 'That code has run out. Show a new one on your computer, then try again.';
  if (/copy the whole code/i.test(m)) return m; // already said for the person
  if ((Object.values(LINK_WORDS) as string[]).includes(m)) return m; // the link's own sentence for this exact failure
  if (/match|refus|wrong|no such|not found|unknown/i.test(m)) return "That code didn't match. Show a fresh one and try again.";
  if (/reach|network|timeout|address|relay|host/i.test(m)) return "Couldn't reach your computer. Check it's awake, then try again.";
  return 'That didn\'t go through. Check the code, then try again.';
};
/** What this phone knows about its own news: allowed and working (on), said no (off), or this build can't push at all
 *  (missing — the phone still shows everything the moment the app is opened). */
async function pushState(ask = false): Promise<'on' | 'off' | 'missing'> {
  const { status } = ask ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
  if (status !== 'granted') return 'off';
  const token = await Notifications.getExpoPushTokenAsync().then((x) => x.data,
    (e: Error & { code?: string }) => (e.code === 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID' || /firebase|fcm|google-services/i.test(e.message) ? '' : undefined));
  return token === '' ? 'missing' : 'on';
}
const PUSH_WORDS = {
  on: 'On',
  off: 'Notifications are off for Crewhouse on this phone',
  missing: "Notifications aren't switched on yet. You'll see news when you open Crewhouse.",
};

function Pair({ onPaired }: { onPaired: (g: Grant) => void }) {
  const t = useLook();
  const [perm, askPerm] = useCameraPermissions();
  const [push, setPush] = useState<'on' | 'off' | 'missing' | null>(null);
  const [checked, setChecked] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Grant | null>(null);
  const [words, setWords] = useState('');
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState('');
  const seen = useRef('');
  // Whether the camera itself is the problem, kept as its own answer: the "Open phone settings" button belongs to
  // that, and no pairing sentence can be read for it (the wrong-code sentence talks about pointing the camera).
  const [noCamera, setNoCamera] = useState(false);
  const typed = async () => {
    setBusy(true);
    setErr('');
    try { setDone(await pairTypedCode(code, setWords)); } catch (e: any) { setErr(pairWords(e)); }
    setWords('');
    setBusy(false);
  };
  const tryCode = async (text: string) => {
    if (busy || seen.current === text) return;
    seen.current = text;
    setScanning(false);
    setBusy(true);
    setErr('');
    // @byokit/pair's failures are already plain sentences ("That pairing code has run out. Show a new one on your computer.").
    try { setDone(await pair(text, setWords)); } catch (e: any) { seen.current = ''; setErr(pairWords(e)); }
    setWords('');
    setBusy(false);
  };
  // Dev-only QR bypass (QA-283): an emulator's virtual camera can show the code without ever firing
  // onBarcodeScanned, so a dev build accepts the same scanned text by link
  // (`adb shell am start -a android.intent.action.VIEW -d "crewhouse://pair?code=<url-encoded QR text>"`)
  // through the same tryCode handler the camera uses. Release builds ignore it.
  const devPairUrl = Linking.useURL();
  useEffect(() => {
    if (!__DEV__ || !devPairUrl) return;
    const m = /^crewhouse:\/\/pair\?code=(.+)$/.exec(devPairUrl);
    if (m) void tryCode(decodeURIComponent(m[1]));
  }, [devPairUrl]);
  // The pairing success says the news state once ('missing' when this build has no push credential).
  useEffect(() => { if (!done) return; void pushState(true).then((p) => { setPush(p); setChecked(true); }).catch(() => setChecked(true)); }, [!!done]);
  if (done) {
    return (
      <Center>
        <ChiefArt mood="happy" size={104} whole />
        <T style={s.display}>You're in</T>
        <T tone="ink2" style={s.centerText}>This phone is paired with your computer{done.device.role === 'view' ? '. It can watch the crew, not answer' : ''}.</T>
        {checked && push === 'missing' && <T tone="mute" style={s.centerText}>{PUSH_WORDS.missing}</T>}
        <Btn go big label="Open Crewhouse" onPress={() => onPaired(done)} />
      </Center>
    );
  }
  if (words) {
    return (
      <Center>
        <ChiefArt mood="listen" size={104} whole />
        <T style={s.display}>Check the words</T>
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
    // The keyboard takes half a small screen: the window shrinks to what's left and the form scrolls, so the field and Pair stay reachable.
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
        <ScrollView contentContainerStyle={s.centerScroll} keyboardShouldPersistTaps="handled">
          <ChiefArt mood="listen" size={72} whole />
          <T style={[s.h1, s.serif, { fontSize: 32, lineHeight: 36 }]}>Type a code</T>
          <T tone="ink2" style={s.centerText}>Enter the code under Add a phone on your computer, or one someone there sent you.</T>
          <TextInput style={[s.input, { alignSelf: 'stretch', color: t.ink, borderColor: t.line }]} value={code} onChangeText={setCode} placeholder="Type or paste the code" placeholderTextColor={t.mute}
            accessibilityLabel="Pairing code" autoCapitalize="characters" autoCorrect={false} />
          {busy ? <ActivityIndicator color={t.pink} style={{ margin: 20 }} /> : <Btn go big label="Pair" disabled={!code.trim()} onPress={typed} />}
          {!!err && <T tone="pinkInk" style={s.centerText}>{err}</T>}
          <Btn label="Scan instead" onPress={() => { setTyping(false); setErr(''); }} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }
  // Scrolls on short screens: a centered View spills past both safe-area edges instead.
  return (
    <ScrollView contentContainerStyle={s.centerScroll}>
      <ChiefArt mood="hello" size={104} whole />
      <T style={s.display}>Crewhouse</T>
      <T tone="ink2" style={[s.centerText, { marginTop: -6 }]}>Your personal assistant, in your pocket.</T>
      <Card style={{ alignSelf: 'stretch', gap: 10, marginVertical: 6 }}>
        {['On your computer, open Crewhouse, then Settings, Phones, Add a phone.', 'Scan the code it shows, or type it in here.'].map((l, i) =>
          <View key={l} style={[s.row, { alignItems: 'flex-start' }]}><Text style={[s.stepNum, { backgroundColor: t.soft, color: t.ink }]}>{i + 1}</Text><T tone="ink2" style={{ flex: 1 }}>{l}</T></View>)}
      </Card>
      {busy ? <ActivityIndicator color={t.pink} style={{ margin: 20 }} /> : (
        <Btn go big label="Scan the code" onPress={async () => {
          const p = perm?.granted ? perm : await askPerm();
          if (p.granted) { setNoCamera(false); setScanning(true); } else { setNoCamera(true); setErr('Crewhouse needs the camera to read the code.'); }
        }} />
      )}
      {!!err && <T tone="pinkInk" style={s.centerText}>{err}</T>}
      {noCamera && <Btn label="Open phone settings" onPress={() => void Linking.openSettings()} />}
      {!busy && <Btn label="Type a code" onPress={() => { setTyping(true); setErr(''); }} />}
      <T tone="mute" style={[s.small, s.centerText, { marginTop: 20 }]}>{A.awake('your computer')}</T>
      <T tone="mute" style={[s.small, s.centerText]}>🔒 Only your computer can read what this phone sends. Anything passing it along can't read it.</T>
    </ScrollView>
  );
}

// ---------- the app ----------
type Route = { view: 'home' | 'chief' | 'room' | 'crew' | 'helper' | 'things' | 'routines' | 'add' | 'phone'; id?: string; tab?: string; m?: number };
/** `offline`: the screens show what this phone kept, read-only, until the home computer answers again. */
type Ctx = { state: Json; tick: number; refresh: () => void; go: (r: Route, replace?: boolean) => void; back: () => void; canAct: boolean; offline: boolean; open: (c: A.Card) => void; writer?: boolean };

function Crewhouse({ grant, onRemoved }: { grant: Grant; onRemoved: () => void }) {
  const t = useLook();
  // A photo, link or text shared from another app arrives here (Android's share sheet).
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntent();
  // A share the phone wouldn't let Crewhouse read: said plainly, and nothing else happens.
  useEffect(() => {
    if (!shareError) return;
    say("That photo couldn't be opened here. Share it again from your gallery, or tap + in a chat to pick it.");
    resetShareIntent();
  }, [shareError]);
  // Opens on what this phone kept, so recent chats read even while the home computer is asleep.
  const [first] = useState(() => kept.load(grant.host));
  const [state, setState] = useState<Json>(first.state);
  const [status, setStatus] = useState<Status>('connecting');
  const [why, setWhy] = useState(false);
  const reduce = motion.useReduceMotion();
  const [tick, setTick] = useState(0);
  const [stack, setStack] = useState<Route[]>([{ view: 'home' }]);
  const [sheet, setSheet] = useState<A.Card | null>(null);
  const link = useRef<ReturnType<typeof connect>['link'] | null>(null);
  const heard = useRef(first.at); // when the home computer last answered
  const [missing, setMissing] = useState('');
  // Connecting for longer than a bound counts as out of touch: no spinner without an end.
  const [late, setLate] = useState(false);
  const facts = useRef<ReturnType<typeof connect>['facts'] | null>(null);
  const route = stack[stack.length - 1];

  const refresh = useCallback(() => {
    api.state().then((st) => { setState(st); heard.current = Date.now(); kept.state(st); }).catch(() => {});
    setTick((n) => n + 1);
  }, []);
  useEffect(() => {
    let pending: any;
    const { link: l, call, learn, facts: f, push, release } = connect(grant, () => { clearTimeout(pending); pending = setTimeout(refresh, 120); }, (st) => { setStatus(st); if (st === 'online') { refresh(); void learn(); void push(); } if (st === 'removed') onRemoved(); }); // online: first load, and catching up after a reconnect
    link.current = l;
    facts.current = f;
    setTransport(call);
    return release;
  }, [grant, refresh, onRemoved]);
  // Going quiet is time passing, not news, so no event says it: look again while on screen, as the computer's app does.
  const awake = motion.useAwake();
  useEffect(() => {
    if (status !== 'online' || !awake) return;
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [status, awake, refresh]);
  useEffect(() => {
    if (status === 'online') { setLate(false); return; }
    const t = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(t);
  }, [status]);
  const out = status === 'offline' || late;
  // The crew in the status bar (Android) or the Dynamic Island (iPhone), from the same refresh as every screen: out of
  // touch or gone, it goes too.
  const show = (s: A.CrewStatus | null) => { chip(s); island(s); };
  useEffect(() => { if (out) show(null); else if (status === 'online' && state) show(A.status(state, grant.device.role === 'control')); }, [state, status, out]);
  useEffect(() => () => show(null), []);
  // Chief on the screen, when the person left him on: his face follows this same refresh while the app is open.
  useEffect(() => { void bubbleResume(grant); }, [grant]);
  const edge = useBubbleEdge();
  useEffect(() => { if (out || state) showCrew(out ? null : state, out); }, [state, out]);
  // Out of touch: say what the phone observed and what to try, looked at again every few seconds (Tailscale switched
  // on, back on the Wi-Fi, the computer woke); each look is bounded, and the link keeps retrying by itself meanwhile.
  useEffect(() => {
    if (!out) return;
    const check = () => facts.current?.().then((f) => setMissing(A.away(f))).catch(() => {});
    void check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [out]);
  const was = useRef<Status>('connecting');
  useEffect(() => { if (status === 'online' && was.current === 'offline' && state) say('Back in touch with the home computer ✓'); was.current = status; }, [status]);

  const go = (r: Route, replace = false) => setStack((st) => (replace ? [r] : [...st, r]));
  const back = useCallback(() => {
    if (sheet) { setSheet(null); return true; }
    if (stack.length <= 1) return false;
    setStack((st) => st.slice(0, -1));
    return true;
  }, [stack.length, sheet]);
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', back); return () => sub.remove(); }, [back]);
  // A shortcut or control opened crewhouse://ask (src/ask.ts): its words wait in that chat's box, never sent. The app
  // opens that address itself, often while starting up, so the last one opened is read on mount, not only heard.
  const [asked, setAsked] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setAsked(Linking.getLinkingURL());
    const sub = Linking.addEventListener('url', (e) => setAsked(e.url));
    const off = onChip(setAsked); // the status bar's actions open the same addresses
    return () => { sub.remove(); off(); };
  }, []);
  useEffect(() => {
    if (asked && /^crewhouse:\/\/needs\/?$/.test(asked)) { setAsked(null); Linking.clearInitialURL(); go({ view: 'home' }, true); return; } // Home leads with what needs you
    // The bubble's panel: Settings (a button waiting on an app), or a helper's own screen to take the wheel or watch.
    const to = asked && (/^crewhouse:\/\/settings\/?$/.test(asked) ? { view: 'phone' as const } : /^crewhouse:\/\/screen\?bot=([a-z0-9-]+)(&watch=1)?$/.exec(asked));
    if (to) { setAsked(null); Linking.clearInitialURL(); go(Array.isArray(to) ? { view: 'helper', id: to[1], tab: to[2] ? 'watch' : 'screen' } : to); return; }
    const picked = asked ? sharedOf(asked) : null;
    if (picked !== null) { setAsked(null); Linking.clearInitialURL(); setPicked(picked); return; } // "Ask Crewhouse" on text in another app
    const a = asked && state ? askOf(asked, A.crew(state).map((h) => ({ id: h.id, template: state.bots.find((b: Json) => b.id === h.id)?.template }))) : null;
    if (!a) return;
    setAsked(null);
    Linking.clearInitialURL();
    if (a.text) keepDraft(a.chat, a.text);
    go(a.chat === 'chief' ? { view: 'chief' } : { view: 'helper', id: a.chat });
  }, [asked, !!state]);
  const forget = async () => { await bubbleOff().catch(() => {}); link.current?.stop(); await forgetGrant(); onRemoved(); };

  if (status === 'refused') {
    return (
      <Center>
        <ChiefArt mood="error" size={112} whole />
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
        <ChiefArt mood="work" size={112} whole />
        <T tone="ink2" style={s.centerText}>{out ? `Can't reach the home computer. ${missing || 'Checking why…'} Trying again by itself.` : 'Waking the crew…'}</T>
      </Center>
    );
  }
  const offline = status !== 'online';
  const canAct = grant.device.role === 'control' && !offline;
  const ctx: Ctx = { state, tick, refresh, go, back: () => { back(); }, canAct, offline, open: setSheet, writer: grant.device.role === 'control' };
  const shared = hasShareIntent && canAct && state.person.onboarded
    ? { text: [shareIntent.text, shareIntent.webUrl].filter((x, i, a) => x && a.indexOf(x) === i).join('\n'), files: (shareIntent.files ?? []).map((f) => ({ path: f.path, mimeType: f.mimeType })) } : null;
  if (shared) return <ShareIn state={state} shared={shared} go={go} onDone={() => resetShareIntent()} />;
  if (picked !== null && canAct && state.person.onboarded) return <ShareIn state={state} shared={{ text: picked, files: [] }} go={go} onDone={() => setPicked(null)} />;
  if (!state.person.onboarded && canAct) return <Hello {...ctx} />;
  const live = sheet && A.cards(state).find((c) => c.id === sheet.id);
  const toHome: [string, () => void] = ['Home', () => go({ view: 'home' }, true)];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      {offline && (
        <Pressable onPress={() => setWhy(true)} style={[s.offline, { backgroundColor: t.amber }]} accessibilityRole="button" accessibilityHint="Explains what is happening">
          <Text style={[s.offlineText, { color: color.day.ink }]} numberOfLines={1}>{`Can't reach the home computer${heard.current ? ` · last heard ${A.clock(heard.current)}` : ''}`}</Text>
        </Pressable>
      )}
      <Modal visible={why} transparent animationType={motion.sheet(reduce)} onRequestClose={() => setWhy(false)}>
        <Pressable style={s.scrim} onPress={() => setWhy(false)}>
          <Pressable style={[s.sheet, { backgroundColor: t.bg }]} onPress={() => {}}>
            <View style={{ alignItems: 'center' }}><ChiefArt mood="rest" size={72} whole /></View>
            <T style={s.h2}>The home computer isn't answering</T>
            <T tone="ink2">{missing || 'Checking why…'} If it's asleep, the crew has paused and carries on when it wakes. This phone keeps trying by itself.</T>
            <T tone="ink2">Meanwhile you can read your recent chats. You can reply once it's back.</T>
            <Btn go big label="OK" onPress={() => setWhy(false)} />
          </Pressable>
        </Pressable>
      </Modal>
      <View style={[{ flex: 1 }, edge && { [edge === 'left' ? 'paddingLeft' : 'paddingRight']: BUBBLE_DP }]}>
        {route.view === 'home' && <Home {...ctx} />}
        {route.view === 'chief' && <ChiefPage key={stack.length} {...ctx} m={route.m} />}
        {route.view === 'room' && <Room {...ctx} />}
        {route.view === 'crew' && <Crew {...ctx} />}
        {route.view === 'helper' && <HelperPage key={stack.length} {...ctx} id={route.id!} tab={route.tab ?? 'chat'} m={route.m} setTab={(tab) => setStack((st) => [...st.slice(0, -1), { ...route, tab }])} />}
        {route.view === 'routines' && <Page title="Routines" lead="Jobs the crew does on a schedule." back={toHome}><RoutineList {...ctx} /></Page>}
        {route.view === 'add' && <AddHelper {...ctx} />}
        {route.view === 'things' && <Page title="Things" lead="Everything the crew has made for you." back={toHome}><ThingsList list={A.things(state)} state={state} empty="Videos, lists, letters and plans the crew makes for you land here." /></Page>}
        {route.view === 'phone' && <ThisPhone grant={grant} status={status} go={go} back={toHome} onForget={forget} onClear={() => { kept.clear(); say('Cleared from this phone ✓'); }} />}
      </View>
      {live && <AskSheet c={live} who={A.crew(state).find((h) => h.id === live.helper)} chiefSays={state.asks.find((a: Json) => a.id === live.id)?.detail?.chief} canAct={canAct} onClose={() => { setSheet(null); refresh(); }} />}
    </KeyboardAvoidingView>
  );
}

// ---------- first run ----------
function Hello({ state, refresh, go }: Ctx) {
  const me = state.person;
  const [address, setAddress] = useState<string>(me.address || '');
  const [own, setOwn] = useState(false);
  const [words, setWords] = useState('');
  const t = useLook();
  // Ask for the name first when it has not been set yet.
  const name = <>
    <Label>What shall I call you?</Label>
    <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={address} onChangeText={setAddress} placeholder="What shall I call you?" placeholderTextColor={t.mute} accessibilityLabel="What shall I call you?" />
  </>;
  const pick = (ask?: string, bot?: string) => {
    if (!address.trim()) return say('First, what shall I call you?');
    void attempt(async () => { await api.onboard(address.trim(), ask, bot); refresh(); go({ view: 'chief' }, true); });
  };
  const reduce = motion.useReduceMotion();
  return (
    <Page>
      <motion.Rise reduce={reduce}><View style={{ alignItems: 'center', paddingTop: 8 }}><ChiefArt mood="hello" size={96} whole /></View></motion.Rise>
      <motion.Rise reduce={reduce} delay={80}><View style={[s.speech, { backgroundColor: t.solid, borderColor: t.line }]}>
        <View style={[s.speechTail, { backgroundColor: t.solid, borderColor: t.line }]} />
        <T style={[s.h1, s.serif, s.centerText, { fontSize: 34, lineHeight: 38, marginVertical: 0 }]}>{A.greeting()}{address.trim() ? `, ${address.trim()}` : ''}</T>
        <T tone="ink2" style={s.centerText}>I'm Chief, your personal assistant. I run your crew of helpers.</T>
      </View></motion.Rise>
      <motion.Rise reduce={reduce} delay={160}><Card style={{ gap: 10 }}>
        {[...A.atHome('the home computer'), "I'll ask before sending messages, deleting things or spending money."].map((l) =>
          <View key={l} style={[s.row, { alignItems: 'flex-start' }]}><T style={{ color: t.ok, fontWeight: '700' }}>✓</T><T tone="ink2" style={{ flex: 1 }}>{l}</T></View>)}
      </Card></motion.Rise>
      {name}
      <Label>What can I take off your plate?</Label>
      {A.firstIdeas(state).map((i) => <Pressable key={i.label} onPress={() => pick(i.label, i.bot)} accessibilityRole="button" accessibilityLabel={i.label}
        style={({ pressed }) => [s.idea, { backgroundColor: t.card, borderColor: t.line }, pressed && { opacity: 0.6 }]}>
        <View style={[s.ideaIcon, { backgroundColor: t.soft }]}><Text style={{ fontSize: 18 }}>{i.icon}</Text></View>
        <T style={{ flex: 1, fontWeight: '500' }}>{i.label}</T><T tone="mute">›</T>
      </Pressable>)}
      {own ? <>
        <TextInput style={[s.input, { color: useLook().ink, borderColor: useLook().line }]} value={words} onChangeText={setWords} placeholder="Ask for anything…" placeholderTextColor={useLook().mute} accessibilityLabel="Your first ask" />
        <Btn go big label="Send" disabled={!words.trim()} onPress={() => pick(words.trim())} />
      </> : <Btn ghost label="Or ask in your own words" onPress={() => setOwn(true)} />}
    </Page>
  );
}

// ---------- asks ----------
const answer = (c: A.Card, body: Json) => c.mailSend ? api.answer(c.id, body).then(() => { say(body.answer === 'deny' ? 'Nothing sent.' : body.answer === 'dismiss' ? 'OK.' : 'Sent from your Gmail.'); return true; }, e => { say(e.message); return false; }) : attempt(() => api.answer(c.id, body), body.change ? 'Chief will change the plan' : body.answer === 'deny' ? 'OK, not now' : 'Done. Carrying on.');

/** The ask's evidence in the sunken block, mirroring web/src/parts.tsx AskEvidence (§4.4): the order's lines with
 *  the total above a hairline, a form's or a job's label-over-value lines, a draft, the routine's confirmation
 *  lines, or exactly what goes out. Long bodies clamp until `open`; `readAll` is the caller's way of opening them. */
function AskEvidence({ c, open, readAll }: { c: A.Card; open: boolean; readAll?: ReactNode }) {
  const t = useLook();
  const body = c.preview?.body ?? '';
  if (c.review) return <View style={[s.ev, { backgroundColor: t.sunken }]}>{body.split('\n').map((l, i) => {
    const m = l.match(/^(.*?)[\s—]+(\$[\d.,]+)$/);
    const total = /^Total/.test(l);
    return <View key={i} style={[s.orderRow, total && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 2 }]}>
      {m ? <><T style={{ flex: 1, ...(total && s.b) }}>{m[1]}</T><T style={total ? s.b : undefined}>{m[2]}</T></> : <T style={total ? s.b : undefined}>{l}</T>}
    </View>;
  })}</View>;
  if (c.evidence === 'lines') return <View style={[s.ev, { backgroundColor: t.sunken }]}>{body.split('\n').filter(Boolean).map((l, i) => {
    const at = l.indexOf(': ');
    return at > 0 ? <View key={i} style={{ gap: 2 }}><T tone="mute" style={s.label2}>{l.slice(0, at)}</T><T style={{ fontWeight: '500' }}>{l.slice(at + 2)}</T></View>
      : <T key={i}>{l}</T>;
  })}</View>;
  if (c.evidence === 'draft') {
    return <View style={[s.ev, { backgroundColor: t.sunken }]}>
      {!!c.mailFrom && <T tone="mute" style={s.small}>From {c.mailFrom}</T>}
      {!!c.draftTo && <T tone="mute" style={s.small}>To {c.draftTo}</T>}
      {!!c.draftSubject && <T style={{ fontWeight: '500' }}>Subject: {c.draftSubject}</T>}
      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled><T tone="ink2">{body}</T></ScrollView>
    </View>;
  }
  if (c.lines) return <View style={[s.ev, { backgroundColor: t.sunken }]}>{c.lines.map((l, i) =>
    <T key={i} tone={i && c.kind === 'routine' ? 'mute' : 'ink'} style={i && c.kind === 'routine' ? s.small : undefined}>{l}</T>)}</View>;
  if (c.preview) return <View style={[s.ev, { backgroundColor: t.sunken }]}>
    {!!c.preview.head && <T tone="mute" style={s.small}>{c.preview.head}</T>}
    <T tone="ink2" lines={open ? undefined : 3}>{c.preview.body}</T>
    {!open && readAll}
  </View>;
  return null;
}

/** The ask inline in the thread: the name, the status flag with the dot, then the words. No face, no clock. */
function AskHead({ c, who }: { c: A.Card; who: A.Helper | undefined }) {
  const t = useLook();
  const name = c.helper === 'chief' ? 'Chief' : who?.name ?? c.head;
  return <View style={{ gap: 2 }}>
    <T style={{ fontWeight: '600', color: t.pinkInk }}>{name}</T>
    <View style={s.askStatus}><View style={[s.statusDot, { backgroundColor: t.pink }]} /><T tone="ink2" style={s.small}>{c.status}</T></View>
  </View>;
}

/** A helper's draft takes the person's own words before the yes (web/src/parts.tsx useDraftEdit): their version
 *  replaces the draft, and still nothing is sent. The yes copies the words they see and opens the draft's link. */
function useDraftEdit(c: A.Card) {
  const t = useLook();
  const [words, setWords] = useState<string | null>(null);
  const changed = words !== null && words.trim() !== c.draftText;
  return {
    can: c.evidence === 'draft' && !!c.draftText, editing: words !== null, empty: words !== null && !words.trim(),
    toggle: () => setWords(words === null ? c.draftText ?? '' : null),
    box: words !== null && <TextInput style={[s.input, { color: t.ink, borderColor: t.line, minHeight: 160, textAlignVertical: 'top' }]} value={words} onChangeText={setWords}
      multiline autoFocus accessibilityLabel="Your version of the message" />,
    yes: (body: Json) => {
      if (c.evidence !== 'draft' || c.mailSend) return body;
      const text = changed ? words!.trim() : c.draftText ?? '';
      Clipboard.setString(text);
      if (c.draftLink) void Linking.openURL(c.draftLink);
      return changed ? { ...body, text } : body;
    },
  };
}

function MailSetup({ c, canAct, done }: { c: A.Card; canAct: boolean; done: () => void }) {
  const t = useLook(), [status, setStatus] = useState<ReturnType<typeof A.mailWords> | null>(null), [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!canAct) return; // the link must be up and the transport set before we ask the computer anything
    let active = true;
    setError('');
    void api.mailStatus(c.mailTo!).then((raw) => { if (active) { const v = A.mailWords(raw); setStatus(v); setName(v.name); } }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [c.mailTo, canAct]);
  const act = async (body: Json) => { setBusy(true); setError(''); try { setStatus(A.mailWords(await api.mailMark(c.mailTo!, body))); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const review = async () => { setBusy(true); setError(''); try { await api.mailReview(c.id); done(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  return <View style={{ gap: 8 }}><T style={s.b}>Send from your Gmail</T><T tone="mute" style={s.small}>{status?.org} · {status?.note ?? (canAct ? 'Checking this address…' : 'Waiting for the home computer…')}</T>
    <T tone="mute" style={s.small}>Only you can mark an organisation, from your own knowledge. This never approves an email.</T>
    <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={name} onChangeText={setName} placeholder="Organisation name" placeholderTextColor={t.mute} accessibilityLabel="Organisation name" editable={canAct && !busy} />
    <View style={s.chips}>{[['corporate', 'Corporate-eligible'], ['sole-trader', 'Sole trader'], ['small-partnership', 'Small partnership'], ['unknown', 'Unknown']].map(([kind, label]) => <Btn key={kind} label={label} disabled={!canAct || busy || !name.trim()} onPress={() => void act({ kind, name })} />)}</View>
    <View style={s.chips}><Btn label={status?.stopped ? 'Remove from do-not-email list' : 'Do not email this address'} disabled={!canAct || busy || !status} onPress={() => void act({ suppressed: !status!.stopped })} />
      <Btn go label="Review one email" disabled={!canAct || busy || !status} onPress={() => void review()} /></View>{!!error && <T tone="pinkInk" style={s.small}>{error}</T>}</View>;
}
function AskCard({ c, who, state, onDone, canAct, offline, open }: { c: A.Card; who: A.Helper | undefined; state: Json; onDone: () => void; canAct: boolean; offline: boolean; open: (c: A.Card) => void }) {
  const [reply, setReply] = useState('');
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const t = useLook();
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onDone(); else setOops(true); };
  const yes = c.choices[0];
  const deny = c.choices.find((x) => x.body.answer === 'deny' && x !== yes);
  const always = c.choices.find((x) => x.body.scope === 'always');
  const question = c.review && c.preview?.head ? c.preview.head : c.words;
  // A routine offered by Chief: the lines are the confirmation; changing the time is an edit before the yes.
  const [when, setWhen] = useState<string | null>(null);
  const [sched, setSched] = useState<Json>(null);
  useEffect(() => {
    if (when === null || !when.trim()) { setSched(null); return; }
    const x = setTimeout(() => api.schedule(when).then(setSched).catch(() => setSched({ bad: true })), 250);
    return () => clearTimeout(x);
  }, [when]);
  const stuck = when !== null && (!when.trim() || !sched || sched.bad);
  // Chief's plan: "Change it" opens a box, and what the person types goes back to Chief for a new plan.
  const [change, setChange] = useState<string | null>(null);
  const edit = useDraftEdit(c);
  return (
    <View style={[s.askInline, { borderTopColor: t.line2 }]}>
      <AskHead c={c} who={who} />
      <T style={s.askWords}>{question}</T>
      {edit.box || (c.kind === 'routine' && c.lines ? <View style={{ gap: 4, marginTop: 8 }}>{c.lines.map((l: string, i: number) =>
        <T key={i} tone={i ? 'mute' : 'ink2'} style={i ? s.small : { fontSize: 15, lineHeight: 24 }}>{l}</T>)}</View>
        : <AskEvidence c={c} open={false} readAll={<Btn label="Read all" onPress={() => open(c)} />} />)}
      {c.mailTo && <MailSetup c={c} canAct={canAct && !offline} done={onDone} />}
      {oops && <T tone="pinkInk" style={s.small}>{c.mailSend ? 'Sending was not confirmed. Check Gmail before doing anything else.' : "That didn't go through. Try again."}</T>}
      {offline ? <T tone="mute" style={s.small}>You can answer once the home computer is back.</T>
        : !canAct ? <T tone="mute" style={s.small}>This phone watches; answer on another phone or the computer.</T> : c.kind === 'connect' ? (
        <View style={{ gap: 8 }}>
          <T tone="mute" style={s.small}>Finish on the computer: it's waiting in this chat there.</T>
          <Btn label={`Do it without ${c.app!.name}`} onPress={() => act({ answer: 'deny' })} />
        </View>
      ) : c.kind === 'routine' ? (
        <>
          {when !== null && <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={when} onChangeText={setWhen} autoFocus
            placeholder="When? For example: every Saturday 10am" placeholderTextColor={t.mute} accessibilityLabel="When" autoCapitalize="none" />}
          {when !== null && !!sched && !sched.bad && <T tone="mute" style={s.small}>{sched.words}. First time {sched.first}.{c.zoneNote ? ` ${c.zoneNote}` : ''}</T>}
          {when !== null && !!sched?.bad && <T tone="mute" style={s.small}>I didn't catch that time. Try “every Monday 9:00”.</T>}
          <View style={s.chips}>
            <Btn go label="Start it" disabled={stuck} onPress={() => act({ answer: 'allow', scope: 'once', ...(when !== null && when.trim() && when.trim() !== c.schedule ? { schedule: when.trim() } : {}) })} />
            <Btn label={when === null ? 'Change time' : 'Keep the time'} onPress={() => setWhen(when === null ? c.schedule || '' : null)} />
            {deny && <Btn label={deny.label} onPress={() => act(deny.body)} />}
          </View>
        </>
      ) : c.kind === 'plan' ? (
        <>
          {change !== null && <View style={s.row}>
            <TextInput style={[s.input, { flex: 1, color: t.ink, borderColor: t.line }]} value={change} onChangeText={setChange} autoFocus
              placeholder="What should change?" placeholderTextColor={t.mute} accessibilityLabel="What should change" />
            <Btn go label="Send" disabled={!change.trim()} onPress={() => act({ answer: 'deny', change: change.trim() })} />
          </View>}
          <View style={s.chips}>
            {change === null && <Btn go label={yes.label} onPress={() => act(yes.body)} />}
            <Btn label={change === null ? 'Change it' : 'Keep the plan'} onPress={() => setChange(change === null ? '' : null)} />
            {deny && <Btn label={deny.label} onPress={() => act(deny.body)} />}
          </View>
        </>
      ) : c.reply ? (
        <View style={s.row}>
          <TextInput style={[s.input, { flex: 1, color: t.ink, borderColor: t.line }]} value={reply} onChangeText={setReply} placeholder={`Tell ${who?.name ?? 'them'} what to do`} placeholderTextColor={t.mute} />
          <Btn go label="Send" disabled={!reply.trim()} onPress={() => act({ text: reply.trim() })} />
        </View>
      ) : c.review ? (
        <View style={s.chips}>
          <Btn go label="Review order" onPress={() => open(c)} />
          {deny && <Btn ghost label={deny.label} onPress={() => act(deny.body)} />}
        </View>
      ) : yes ? (
        <View style={s.chips}>
          <Btn go={!c.mailTo} label={yes.label} disabled={edit.empty} onPress={() => act(edit.yes(yes.body))} />
          {edit.can && <Btn label={edit.editing ? 'Use the original' : 'Edit'} onPress={edit.toggle} />}
          {deny && <Btn label={deny.label} onPress={() => act(deny.body)} />}
        </View>
      ) : null}
      {always && <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, paddingTop: 10, width: '100%' }}><Btn ghost label={always.label} onPress={() => act(always.body)} /></View>}
      {c.kind === 'spend' && <T tone="mute" style={[s.small, { textAlign: 'center' }]}>Anything that costs money asks you every time.</T>}
      {c.kind === 'plan' && <T tone="mute" style={[s.small, { textAlign: 'center' }]}>Saying Go doesn’t OK any sending or spending. Those still ask you each time.</T>}
    </View>
  );
}

/** The approval moment, mirroring web/src/parts.tsx AskSheet (§4.4): who, the status, exactly what goes out, and
 *  the choices — full-width buttons, the primary above its way out; a checkout reviews the whole order here, and an
 *  order without a readable total offers no yes at all. */
function AskSheet({ c, who, chiefSays, canAct, onClose }: { c: A.Card; who: A.Helper | undefined; chiefSays?: string; canAct: boolean; onClose: () => void }) {
  const t = useLook();
  const [open, setOpen] = useState(false);
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onClose(); else setOops(true); };
  const reduce = motion.useReduceMotion();
  const question = c.review && c.preview?.head ? c.preview.head : c.words;
  const yes = c.choices[0]?.body.answer === 'allow' ? c.choices[0] : null;
  // Every way out that isn't the one yes — an unpriced order has two, and neither is a yes.
  const rest = c.choices.filter((x) => x !== yes && x.body.scope !== 'always');
  const always = c.choices.find((x) => x.body.scope === 'always');
  const edit = useDraftEdit(c);
  return (
    <Modal visible transparent animationType={motion.sheet(reduce)} onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose}>
        <Pressable style={[s.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
          <View style={[s.grabber, { backgroundColor: t.line2 }]} />
          <ScrollView style={{ flexShrink: 1, flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          <AskHead c={c} who={who} />
          <T style={s.askQ}>{question}</T>
          {edit.box || <AskEvidence c={c} open={open} readAll={<Btn label="Read all" onPress={() => setOpen(true)} />} />}
          {c.mailTo && <MailSetup c={c} canAct={canAct} done={onClose} />}
          {c.review && c.order && !c.order.known && <T tone="mute" style={s.small}>So nothing is counted against the monthly limit.</T>}
          {!!chiefSays && <View style={s.row}><Face who="chief" size={20} /><T tone="ink2" style={{ flex: 1 }}><Text style={s.b}>Chief:</Text> {A.plain(chiefSays)}</T></View>}
          {oops && <T tone="pinkInk" style={s.small}>{c.mailSend ? 'Sending was not confirmed. Check Gmail before doing anything else.' : "That didn't go through. Try again."}</T>}
          {canAct ? <>
            {c.evidence === 'draft' && yes && <Btn go big label={yes.label} disabled={edit.empty} onPress={() => act(edit.yes(yes.body))} />}
            {edit.can && <Btn big label={edit.editing ? 'Use the original' : 'Edit'} onPress={edit.toggle} />}
            {rest.map((x) => <Btn key={x.label} big label={x.label} onPress={() => act(x.body)} />)}
            {c.evidence !== 'draft' && yes && <Btn go big label={yes.label} disabled={edit.empty} onPress={() => act(edit.yes(yes.body))} />}
          </> : <Btn big label="Close" onPress={onClose} />}
          {always && canAct && <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, paddingTop: 10 }}><Btn ghost big label={always.label} onPress={() => act(always.body)} /></View>}
          {c.kind === 'spend' && <T tone="mute" style={[s.small, { textAlign: 'center' }]}>Anything that costs money asks you every time.</T>}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------- home ----------
// What this phone kept says how things were, not how they are: while the computer is out of reach, nobody claims to be busy.
const OUT = 'Out of reach for now';
const chiefNow = (state: Json, offline: boolean) => (offline ? { mood: 'rest' as const, line: OUT } : A.chief(state));
// The crew list's status word and dot are the web rail's own (crewPill: A.statusOf):
// the same per-member status the rail rows and the Office header read, so the phone can never
// disagree with them. A member missing from the office view across a refresh falls back to the
// helper's own words rather than crashing, never a second status rule.
function HelperPill({ h, offline, view }: { h: A.Helper; offline: boolean; view?: A.OfficeView | null }) {
  if (offline) return <Pill tone="off">{OUT}</Pill>;
  const p = crewPill(h, view ?? null);
  return <Pill tone={p.tone}>{p.word}</Pill>;
}

/** Needs you as one compact list: a number, the face, the subject, one plain line; a row opens the review sheet.
 *  Nothing commits from Home. At most three rows, then "N more", which expands in place. */
function NeedsRows({ state, cards, open, few = 3 }: { state: Json; cards: A.Card[]; open: (c: A.Card) => void; few?: number }) {
  const t = useLook();
  const crew = A.crew(state);
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, few);
  const more = cards.length - few;
  return (
    <View>
      {shown.map((c, i) => (
        <Pressable key={c.id} style={[s.listRow, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.line }]}
          onPress={() => open(c)} accessibilityLabel={c.head}>
          <Face who={crew.find((h) => h.id === c.helper) ?? { kind: 'pip', name: c.helper }} size={36} />
          <View style={{ flex: 1 }}><T style={s.rowTitle} lines={1}>{c.head}</T><T tone="ink2" style={s.small} lines={1}>{c.words}</T></View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}><T tone="mute" style={s.time}>{A.briefTime(c.at)}</T><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.pink }} /></View>
        </Pressable>
      ))}
      {!all && more > 0 && <Btn ghost label={`See all ${cards.length}`} onPress={() => setAll(true)} />}
    </View>
  );
}

/** Home's top (web/src/main.tsx HomeBar): in Chat just the gear on the left and the Chief | Office switch on the right
 *  (B1 phone); in Office the greeting and the counts from the office's one state as well. */
function HomeBar({ state, view, go, mode, pick }: { state: Json; view: A.OfficeView; offline: boolean; go: Ctx['go']; mode: HomeMode; pick: (m: HomeMode) => void }) {
  const t = useLook();
  // B1: no tab bar on Home. The gear by the Chief | Office switch reaches settings (and the rest of the app from there).
  const gear = <Pressable onPress={() => go({ view: 'phone' })} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><T tone="ink2" style={{ fontSize: 22, lineHeight: 26 }}>{'\u2699'}</T></Pressable>;
  const seg = (wide = false) => <View accessibilityRole="tablist" accessibilityLabel="Home view" style={[s.seg, { backgroundColor: t.soft, borderRadius: 14, padding: 4 }, wide && { alignSelf: 'stretch' }]}>
    {HOME_MODES.map(([m, l]) => <Pressable key={m} onPress={() => pick(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} style={[s.segBtn, { borderRadius: 10 }, wide && { flex: 1, alignItems: 'center' }, mode === m && { backgroundColor: t.solid }]}>
      <T tone={mode === m ? undefined : 'ink2'} style={[s.small, s.b]}>{l}</T>
    </Pressable>)}
  </View>;
  const tools = <View style={[s.row, { justifyContent: 'space-between' }]}>{gear}{seg()}</View>;
  // Chat opens on Chief: one compact header line, then the switch as its own full-width row under it.
  if (mode === 'chat') return <ChiefHero live={view} state={state} gear={gear} below={seg(true)} />;
  // Office is a slim header: the title, the count line, then the switch.
  return (
    <View style={{ gap: 6 }}>
      <T style={[s.serif, { fontSize: 28, lineHeight: 32 }]}>Office</T>
      <T tone="ink2" style={s.small}>{A.summaryOf(view)}</T>
      {tools}
    </View>
  );
}

/** Needs you pinned over Chief's thread (web/src/main.tsx NeedsPin, flat): one card with the most pressing question,
 *  every other behind an exact "See all N". Home commits nothing: the yes opens the review sheet, Ask Chief fills his
 *  box without sending, Not now moves the card back (or folds the only one under its heading); it stays counted. */
function NeedsPin({ state, cards, open, go }: { state: Json; cards: A.Card[]; open: (c: A.Card) => void; go: Ctx['go'] }) {
  const t = useLook();
  const [all, setAll] = useState(false);
  const [later, setLater] = useState<number[]>([]);
  const [folded, setFolded] = useState<number | null>(null);
  if (!cards.length) return null;
  const fold = cards.length === 1 && folded === cards[0].id;
  const order = [...cards.filter((c) => !later.includes(c.id)), ...later.map((id) => cards.find((c) => c.id === id)).filter((c): c is A.Card => !!c)];
  const c = order[0];
  const who = A.crew(state).find((h) => h.id === c.helper), name = who?.name ?? 'Chief';
  const yes = c.choices[0]?.body.answer === 'allow' ? c.choices[0] : null;
  // A known total shows once, in whole dollars when it has no cents ("$412"); the preview's own repeat of it is dropped.
  const shown = c.order?.known ? c.order.shown : '', price = shown.replace(/\.00$/, '');
  const detail = (c.preview?.body ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !shown || !l.startsWith('Total ')).map((l) => (shown ? l.replace(` — ${shown}`, '') : l))[0];
  const question = c.question ?? (c.review && c.preview?.head ? c.preview.head : c.words);
  const link = (label: string, onPress: () => void) => <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}><T style={[s.small, s.b]}>{label}</T></Pressable>;
  return (
    <View style={[s.card, s.askCard, { backgroundColor: t.solid, borderColor: t.line2, borderWidth: 1, borderRadius: 20, paddingVertical: 14, gap: 10 }]} accessibilityLabel="Needs you">
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <T style={[s.label, { color: t.pinkInk }]}>{`Needs you \u00B7 ${cards.length}`}</T>
        {cards.length > 1 && link(all ? 'Show less' : `See all ${cards.length}`, () => setAll(!all))}
        {fold && link('Show', () => setFolded(null))}
      </View>
      {!fold && <>
        <View style={s.row} accessible accessibilityLabel={`${name} needs you: ${c.head}`}>
          <Ink who={who ? who.kind : 'chief'} mood={who?.mood} size={44} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T style={[s.serif, { fontSize: 22, lineHeight: 26 }]}>{question}</T>
            {!!detail && <T tone="ink2" style={{ fontSize: 14, lineHeight: 19 }}>{detail}</T>}
          </View>
          {!!price && <T style={[s.serif, { fontSize: 32, lineHeight: 36 }]}>{price}</T>}
        </View>
        <View style={s.chips}>
          <Btn go label={yes ? yes.label.replace(shown, price) : c.reply ? `Answer ${name}\u2026` : 'Review\u2026'} onPress={() => open(c)} />
          <Btn label="Ask Chief" onPress={() => { keepDraft('chief', `About ${name}'s question (${c.head}): `); go({ view: 'chief' }); }} />
          <Btn ghost label="Not now" onPress={() => (cards.length > 1 ? setLater([...later.filter((x) => x !== c.id), c.id]) : setFolded(c.id))} />
        </View>
      </>}
      {all && <View style={[s.listGroup, { borderColor: t.line }]}><NeedsRows state={state} cards={order.slice(1)} open={open} few={order.length} /></View>}
    </View>
  );
}

/** Home's chat header (Term): one compact line — the helmet, the name, the single status and the gear, centred on
 *  that line — then the Chief | Office switch as its own full-width row under it. The crew faces live in Office. */
function ChiefHero({ live, gear, below }: { live: A.OfficeView; state: Json; gear?: ReactNode; below?: ReactNode }) {
  const t = useLook();
  // Chief's one status, the rail's own (A.chiefStatus): the dot is pink while he needs you, green at work, else grey.
  const st = A.chiefStatus(live), needs = st.seat === 'needs';
  return (
    <View accessibilityLabel="Chief" style={{ gap: 8 }}>
      <View style={[s.row, { alignItems: 'center', gap: 10 }]}>
        <ChiefArt mood={live.chief.mood} size={56} whole />
        <T style={[s.serif, { fontSize: 22, lineHeight: 26 }]}>Chief</T>
        <View style={[s.row, { gap: 6, flexShrink: 1, minWidth: 0 }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: needs ? t.pink : st.group === 'work' ? t.green : t.line2 }} />
          <T numberOfLines={1} style={[s.small, { fontWeight: '500', color: needs ? t.pinkInk : t.ink2 }]}>{st.word}</T>
        </View>
        <View style={{ flex: 1 }} />
        {gear}
      </View>
      {below}
    </View>
  );
}

/** On it now (B1): a card per helper at work, their face, name and step; honest when nobody is. */
function OnItNow({ view }: { view: A.OfficeView }) {
  const t = useLook();
  const working = view.crew.filter((c) => A.seatOf(c) === 'working');
  return <View style={{ gap: 8 }}>
    <View style={[s.row, { justifyContent: 'space-between' }]}><Label>On it now</Label><T tone="mute" style={s.small}>{`${working.length} at work`}</T></View>
    {working.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{working.map((c) => <View key={c.id} style={[s.listRow, { flexBasis: '47%', flexGrow: 1, minWidth: 0, borderWidth: 1, borderColor: t.line, borderRadius: 16, backgroundColor: t.solid }]}>
      <Face who={{ kind: c.kind, name: c.name, mood: c.mood }} size={34} /><View style={{ flex: 1, minWidth: 0 }}><T style={s.b} lines={1}>{c.name}</T><T tone="ink2" style={s.small} lines={1}>{c.step || c.status}</T></View>
    </View>)}</View> : <Card><T tone="ink2">{A.idleLine(view)}</T></Card>}
  </View>;
}

/** Home opens on Chat every time the app starts (kept in memory only, never stored): Chief's thread under the bar and
 *  the pinned Needs you. Office is the optional view of the same state, with Chief's box but no Needs you: crew never ask
 *  the person, so Office's one way to the asks is Chief's "Chief has N things for you" (office.tsx). */
type HomeMode = 'chat' | 'office';
const HOME_MODES: [HomeMode, string][] = [['chat', 'Chief'], ['office', 'Office']];
let homeMode: HomeMode = 'chat';

function Home(ctx: Ctx) {
  const t = useLook();
  const { state, go, refresh, canAct, offline } = ctx;
  const view = useOffice(state, offline, OUT);
  const chief = chiefNow(state, offline);
  const [mode, setMode] = useState(homeMode);
  const pick = (m: HomeMode) => { homeMode = m; setMode(m); };
  const toChief = async (x: string, p: Photo[] = []) => { const ok = await attempt(() => api.post('chief', x, p.map(({ type, data }) => ({ type, data }))), undefined, true); if (ok) { refresh(); go({ view: 'chief' }); } return ok; };
  const [room, setRoom] = useState(0);
  const [desk, setDesk] = useState<{ c: A.OfficeMember; state: Json } | null>(null);
  const [profile, setProfile] = useState(false);
  // The bar stays put over Chief's thread; in Office it scrolls with the room, so the whole room fits between the bar
  // and Chief's box.
  const top = <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 10 }}>
    <HomeBar state={state} view={view} offline={offline} go={go} mode={mode} pick={pick} />
  </View>;
  // Chat: Chief's hero and Needs you stay over his thread, which scrolls on its own to the newest line.
  if (mode === 'chat') return <View style={{ flex: 1 }}>{top}<Chat {...ctx} id="chief" hero={<></>} /></View>;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={{ margin: -16, marginBottom: 0 }}>{top}</View>
        <View onLayout={(e) => setRoom(e.nativeEvent.layout.width)} style={[s.office, { backgroundColor: t.soft, borderColor: t.line }]}>
          {room > 0 && <Office view={view} night={t.night} offline={offline} width={room - 2} jobs={A.work(state)} onChief={() => go({ view: 'chief' })} onDesk={(c) => setDesk({ c, state })} onTray={() => go({ view: 'things' })} onCrew={() => go({ view: 'crew' })} />}
        </View>
        <OnItNow view={view} />
        {!!A.resting(state) && <Card><T>{A.resting(state)}. I'll pick things back up then.</T></Card>}
        <Pressable onPress={() => go({ view: 'phone' })} accessibilityRole="button" accessibilityLabel="Check AI account sign-in on the home computer" style={({ pressed }) => [s.listRow, s.listGroup, { backgroundColor: t.solid, borderColor: t.line }, pressed && { opacity: 0.6 }]}>
          <AiMark ai={A.AIS[0]} size={30} />
          <View style={{ flex: 1 }}><T style={s.rowTitle}>Your AI accounts</T><T tone="ink2" style={s.small} lines={2}>You sign in on the home computer, in Settings.</T></View><T tone="mute">›</T>
        </Pressable>
        <ChatList state={state} go={go} mood={chief.mood} />
        <JobList state={state} go={go} refresh={refresh} />
      </ScrollView>
      {(canAct || ctx.writer) && <View style={s.dock}><Composer placeholder="Ask Chief anything" onSend={toChief} chat="chief" away={offline} /></View>}
      {!!desk && <DeskSheet desk={desk} {...ctx} onClose={() => setDesk(null)} />}
      {profile && <ChiefSheet view={view} {...ctx} onClose={() => setProfile(false)} />}
    </View>
  );
}

/** Chief up close, over the office (which stays selected beneath): how to reach him, the crew's computers (watching
 *  first) and what the crew made. The sheet is only as tall as what it holds. */
function ChiefSheet({ view, state, offline, go, onClose }: Ctx & { view: A.OfficeView; onClose: () => void }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  const crew = A.crew(state);
  const computers = desktopAvailable ? view.crew.filter((c) => crew.find((h) => h.id === c.id)?.computer) : [];
  const made = A.things(state).slice(0, 4);
  const word = offline ? OUT : A.chiefStatus(view).word;
  const to = (r: Route) => { onClose(); go(r); };
  const row = (key: string, label: string, sub: string, onPress: () => void, end: ReactNode = <T tone="mute">›</T>, face?: ReactNode) =>
    <Pressable key={key} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${sub}`} style={({ pressed }) => [{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: t.line }, pressed && { opacity: 0.6 }]}>
      {face}<View style={{ flex: 1, minWidth: 0 }}><T style={s.b}>{label}</T>{!!sub && <T tone="ink2" style={s.small} lines={1}>{sub}</T>}</View>{end}
    </Pressable>;
  return <Modal visible transparent animationType={motion.sheet(reduce)} onRequestClose={onClose}>
    <Pressable style={s.scrim} onPress={onClose}>
      <Pressable style={[s.sheet, { backgroundColor: t.surface, maxHeight: '88%' }]} onPress={() => {}}>
        <View style={[s.grabber, { backgroundColor: t.line2 }]} />
        <View style={s.row}>
          <Face who="chief" size={60} mood={view.chief.mood} />
          <View style={{ flex: 1 }}><T style={[s.h2, s.serif, { fontSize: 28, lineHeight: 32 }]}>Chief</T><T tone="ink2" style={s.small}>Runs your crew</T>
            <T style={[s.small, s.b, { color: word === 'Needs you' ? t.pinkInk : word === 'Working' ? t.green : t.ink2 }]}>{word}</T></View>
          <Btn label="Close" onPress={onClose} />
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
          <Label>Ways to reach</Label>
          {row('chat', 'Message in Chat', '', () => to({ view: 'chief' }))}
          {computers.length > 0 && <Label>Crew computers</Label>}
          {computers.map((c) => {
            const k = A.seatOf(c), h = crew.find((x) => x.id === c.id)!;
            return row(c.id, `${c.name}'s computer`, h.driving ? 'You have the wheel' : `Watch ${c.name}`, () => to({ view: 'helper', id: c.id, tab: 'watch' }),
              <Pill tone={A.waitsOnYou(c) ? 'wait' : k === 'working' ? 'ok' : 'off'}>{offline ? OUT : A.waitsOnYou(c) ? 'Waiting' : k === 'working' ? 'Working' : 'Resting'}</Pill>, <Face who={h} size={36} />);
          })}
          {made.length > 0 && <Label>Outputs</Label>}
          {made.map((m) => row(String(m.id), m.title, `From ${crew.find((h) => h.id === m.helper)?.name ?? 'the crew'}`, () => to({ view: 'helper', id: m.helper })))}
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>;
}

/** A helper's desk, opened from the office: what it is on, its steps with the latest marked now, what it has made for
 *  this job so far, and its question with a Review that opens the same sheet as Needs you — over the desk, as a file
 *  does (iOS won't present a new sheet while this one is still sliding away). Its live screen opens from its chat. */
function DeskSheet({ desk, state, offline, canAct, go, refresh, onClose }: Ctx & { desk: { c: A.OfficeMember; state: Json }; onClose: () => void }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  const [asking, setAsking] = useState(false);
  const id = desk.c.id;
  // The room's own row (live events included) until the next refresh, then the snapshot again.
  const c = desk.state === state ? desk.c : A.office(state).crew.find((x) => x.id === id);
  const h = A.crew(state).find((x) => x.id === id);
  if (!c || !h) return null;
  const job = A.work(state).find((w) => w.helper === id);
  const to = (r: Route) => { onClose(); go(r); };
  return <Modal visible transparent animationType={motion.sheet(reduce)} onRequestClose={onClose}>
    <Pressable style={s.scrim} onPress={onClose}>
      <Pressable style={[s.sheet, { backgroundColor: t.surface, maxHeight: '88%' }]} onPress={() => {}}>
        <View style={[s.grabber, { backgroundColor: t.line2 }]} />
        <View style={s.row}>
          <Face who={offline ? { ...h, ring: '' as const, mood: 'rest' as const } : { ...h, mood: c.mood, ring: c.ring }} size={52} />
          <View style={{ flex: 1 }}><T style={[s.h2, s.serif, { fontSize: 26, lineHeight: 30 }]}>{c.name}</T><T tone="ink2" style={s.small} lines={2}>{h.role}</T></View>
          <Btn label="Close" onPress={onClose} />
        </View>
        <View style={{ flexDirection: 'row' }}>{offline ? <Pill tone="off">{OUT}</Pill>
          : <Pill tone={A.waitsOnYou(c) ? 'wait' : c.ring ? 'ok' : 'off'}>{A.statusOf(c, view).word}</Pill>}</View>
        <ScrollView contentContainerStyle={{ gap: 12 }}>
          {!offline && !!job && <View style={[s.ev, { backgroundColor: t.sunken }]}>
            <T tone="ink2" style={s.label}>{job.waiting && c.ring !== 'needs' ? 'Up next' : 'Working on'}</T>
            <T style={[s.rowTitle, s.b]}>{job.title}</T>
          </View>}
          {!offline && c.ask && <Card ask>
            <T style={s.b}>{c.ask.head}</T>
            <T tone="ink2" lines={3}>{c.ask.words}</T>
            <View style={s.chips}><Btn go label="Review" onPress={() => setAsking(true)} /></View>
          </Card>}
          {!offline && c.steps.length > 0 && <View><Label>Steps</Label><Steps steps={c.steps} /></View>}
          {!offline && c.things.length > 0 && <View><Label>On the desk</Label><Card>{c.things.map((f) => <FileRow key={f.url} f={f} />)}</Card></View>}
          <Btn big label={`Open ${c.name}'s chat`} onPress={() => to({ view: 'helper', id })} />
          {/* Their own computer: watching is the default; taking the wheel pauses them until it is handed back. */}
          {!offline && h.computer && desktopAvailable && <View><Label>{`${c.name}'s computer`}</Label><View style={s.chips}>
            <Btn label={`Watch ${c.name}`} onPress={() => to({ view: 'helper', id, tab: 'watch' })} />
            {canAct && <Btn label="Take the wheel" onPress={() => void attempt(async () => { await api.takeOver(id); to({ view: 'helper', id, tab: 'screen' }); })} />}
          </View></View>}
        </ScrollView>
        {asking && c.ask && <AskSheet c={c.ask} who={h} chiefSays={state.asks.find((a: Json) => a.id === c.ask!.id)?.detail?.chief} canAct={canAct}
          onClose={() => { setAsking(false); refresh(); }} />}
      </Pressable>
    </Pressable>
  </Modal>;
}

function ChatList({ state, go, mood }: { state: Json; go: Ctx['go']; mood?: art.Mood }) {
  const t = useLook();
  const crew = A.crew(state);
  return <View><Label>Chats</Label><View style={[s.listGroup, { backgroundColor: t.solid, borderColor: t.line }]}>
    {A.chats(state).map((c, i) => <Pressable key={c.id} style={[s.listRow, { borderTopColor: t.line, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}
      onPress={() => go(c.id === 'chief' ? { view: 'chief' } : c.id === 'room' ? { view: 'room' } : { view: 'helper', id: c.id })} accessibilityLabel={`${c.name}${c.unread ? `, ${c.unread} new` : ''}`}>
      {c.id === 'room' ? <View style={{ width: 40, flexDirection: 'row' }}>{crew.slice(0, 2).map((h, n) => <View key={h.id} style={{ marginLeft: n ? -12 : 0 }}><Face who={h} size={26} /></View>)}</View>
        : <Face who={c.who} size={40} mood={c.id === 'chief' ? mood : undefined} />}
      <View style={{ flex: 1 }}><T style={s.rowTitle} lines={1}>{c.name}</T><T tone="ink2" style={s.small} lines={1}>{c.line}</T></View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}><T tone="mute" style={s.time}>{c.at ? A.clock(c.at) : ''}</T>
        {c.unread > 0 && <Text style={[s.unread, { backgroundColor: t.pink, color: t.surface }]}>{A.unreadBadge(c.unread)}</Text>}</View>
    </Pressable>)}
  </View></View>;
}

function JobList({ state, go, refresh }: { state: Json; go: Ctx['go']; refresh: () => void }) {
  const t = useLook();
  // The gallery hire, then the words in the new helper's own box: nothing starts until they send.
  const hire = async (template: string, ask: string) => {
    const name = state.templates.find((x: Json) => x.id === template)?.display ?? template;
    await attempt(async () => { const b = await api.recruit(template, name); refresh(); keepDraft(b.id, ask); go({ view: 'helper', id: b.id }, true); }, `${name} joined the crew`);
  };
  return <View><Label>Hand me a job</Label><View style={[s.listGroup, { backgroundColor: t.solid, borderColor: t.line }]}>
    {A.jobs(state).slice(0, 3).map((j, i) => <Pressable key={j.bot + j.label} style={[s.listRow, { borderTopColor: t.line, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}
      onPress={() => { if (j.needs.length) go({ view: 'phone' }); else if (j.hire) void hire(j.hire, j.ask); else { keepDraft('chief', j.ask); go({ view: 'chief' }); } }}>
      <Face who={A.crew(state).find((h) => h.id === j.bot) ?? { kind: 'pip', name: j.bot }} size={28} />
      <View style={{ flex: 1 }}><T style={s.rowTitle} lines={2}>{j.label}</T>{!!j.says && <T tone="mute" style={s.small} lines={1}>{j.says}</T>}{!!j.needs.length && <T tone="mute" style={s.small}>{A.jobNeeds(j.needs)}</T>}</View><T tone="mute">›</T>
    </Pressable>)}
  </View></View>;
}

// ---------- a chat ----------
/** `hero`: Home's Chief thread (B1): the hero and pinned ask stay above the thread, which opens at its newest line with
 *  the tray's notices among his lines. */
function Chat({ id, m, state, tick, refresh, go, canAct, offline, open, writer, hero }: Ctx & { id: string; m?: number; hero?: ReactNode }) {
  const t = useLook();
  // The computer's page when it answers; otherwise the lines this phone kept, until it does.
  const [page, setPage] = useState<Json>(() => kept.page(id));
  const [pending, setPending] = useState<{ text: string; after: number; at: number } | null>(null);
  const [partial, setPartial] = useState('');
  // The live line's own feed, the same one web chat reads: crewd's pushed events with the moment
  // they were heard, and which replies are streaming. Heard is every event, not just this thread's,
  // so a job Chief passed to a helper is mirrored here too (adapter.liveLine).
  const [heard, setHeard] = useState<Json[]>([]);
  const [writing, setWriting] = useState(new Map<number, number>());
  const [now, setNow] = useState(0);
  useEffect(() => onLive((e) => {
    if (e.kind === 'reply.partial' && typeof e.data?.task === 'number') setWriting((w) => (w.has(e.data.task) ? w : new Map(w).set(e.data.task, Date.now())));
    if (typeof e.seq === 'number') setHeard((h) => [...h.slice(-300), { ...e, seen: Date.now() }]);
    if (e.bot !== id) return;
    if (e.kind === 'reply.partial') setPartial(/\bstub [\w-]+:/.test(e.data.text) ? '' : e.data.text);
    if (e.kind === 'message' && e.data?.author === 'bot') setPartial('');
  }), [id]);
  useEffect(() => { setHeard([]); setWriting(new Map()); }, [id]);
  // A search landing on an old line loads a window around it; once you send, the anchor goes and the thread reads to the end.
  const [around, setAround] = useState(m ?? 0);
  const load = useCallback((ar = around) => api.bot(id, ar || undefined).then((p) => { setPage(p); kept.chat(id, p); }).catch(() => {}), [id, around]);
  useEffect(() => { void load(); }, [load, tick]);
  const scroll = useRef<ScrollView>(null);
  const ys = useRef(new Map<number, number>()); // each line's y, for landing on the matched one
  const landed = useRef(0); // the anchor we already landed on: once per line, never again on every tick

  const lines = hero ? A.trayNotes(state, A.lines(page, id)) : A.lines(page, id);
  const phoneOffer = id === 'chief' ? A.phoneOffer(page) : null;
  const echoed = pending && !(page?.messages ?? []).some((x: Json) => x.author === 'person' && x.id > pending.after && A.plain(x.text) === A.plain(pending.text));
  const waiting = pending && !partial && !(page?.messages ?? []).some((x: Json) => x.author === 'bot' && x.id > pending.after);
  const crewNames = A.crew(state);
  const ln = page ? A.liveLine({ id, name: crewNames.find((x) => x.id === id)?.name ?? 'Chief', crew: crewNames, writing, heard,
    tasks: [...(page.tasks ?? []), ...(id === 'chief' ? state.tasks ?? [] : [])], events: [...(page.trail ?? []), ...(state.events ?? [])],
    sent: waiting && pending ? pending.at : undefined }) : null;
  const ticking = !!ln && ln.took === undefined;
  // The clock beside the step moves on each whole second of the job, so the thread never sits still.
  useEffect(() => {
    if (!ticking) return;
    const t = setTimeout(() => setNow(Date.now()), 1005 - ((Date.now() - ln!.since) % 1000));
    return () => clearTimeout(t);
  }, [ticking, ln?.since, now]);
  const [seed, setSeed] = useState(0); // a starter chip fills the box from outside; remount reads the draft back
  const h = A.crew(state).find((x) => x.id === id);
  const b = state.bots.find((x: Json) => x.id === id);
  const trail = b?.task && page ? A.steps(page.trail ?? [], b.task.id, true) : [];
  const cards = A.cards(state).filter((c) => c.helper === id);
  const last = lines.at(-1);
  const name = h?.name ?? 'Chief';
  // A fresh chat shows starters: nothing yet, or only the hidden "X joined the crew" note from recruiting.
  const fresh = !lines.length || (lines.length === 1 && lines[0].from === 'note' && lines[0].text.startsWith(`${name} joined the crew`));
  // A helper's starters are its own ready rows only, never another helper's; Chief keeps every row.
  const own = id === 'chief' ? A.ideas(state) : A.ideas(state).filter((i: Json) => i.bot === id);
  // Seen: the chat's unread count goes once its newest line is on screen (a watch-only phone can't mark it).
  const newest = last?.id;
  useEffect(() => { if (canAct && newest && b?.unread) void api.read(id).then(refresh).catch(() => {}); }, [canAct, newest, b?.unread, id, refresh]);
  const send = async (x: string, p: Photo[] = []) => {
    setPending({ text: x, after: page?.messages?.at(-1)?.id ?? 0, at: Date.now() });
    setPartial('');
    const ok = await attempt(() => api.post(id, x, p.map(({ type, data }) => ({ type, data }))), undefined, true);
    if (ok) { setAround(0); void load(0); refresh(); } else setPending(null);
    return ok;
  };
  // The landing: the matched line, brought to view and marked for a moment — where you are, said once.
  useEffect(() => {
    if (!around || !lines.length || landed.current === around) return;
    const y = ys.current.get(around);
    if (y === undefined) return;
    landed.current = around;
    scroll.current?.scrollTo({ y: Math.max(0, y - 240), animated: false });

  }, [around, lines.length]);
  // Lines that arrive while you watch rise in; the thread you open with is simply there.
  const opened = useRef<number | null>(null);
  if (opened.current === null && page) opened.current = page.messages?.at(-1)?.id ?? 0;
  // The top of the thread (the computer sends the newest 200): who this is, before the first line.
  const start = !!page && !around && (page.messages?.length ?? 0) < 200;
  const reduce = motion.useReduceMotion();
  const beat = motion.useBeat(360, reduce);
  let day = '';
  const dayOf = (at?: number) => { if (!at) return null; const d = A.dayLabel(at); if (d === day) return null; day = d; return <View style={s.day} accessibilityRole="header"><T tone="mute" style={s.dayText}>{d}</T></View>; };
  // The transcript's name column: every line named, no faces, no clocks.
  const who = (f: string) => <T style={[s.small, s.b, { width: 60, color: t.ink2 }]}>{f === 'chief' ? 'Chief' : name}</T>;
  const speaker = (l: { from: string; helper?: string }) => l.from === 'me' ? 'You' : l.from === 'chief' ? 'Chief' : A.crew(state).find((x) => x.id === l.helper)?.name ?? name;
  return (
    <View style={{ flex: 1 }}>
      {/* Home's hero and pinned ask stay in place over the thread (096); on a short screen they shrink and scroll alone. */}
      {hero && <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}>{hero}</ScrollView>}
      <ScrollView ref={scroll} style={{ flex: 1, minHeight: hero ? 168 : undefined }} contentContainerStyle={{ padding: 16, gap: 10, flexGrow: hero ? 1 : undefined, justifyContent: hero ? 'flex-end' : undefined }}
        onContentSizeChange={() => {
          if (around) return;
          scroll.current?.scrollToEnd({ animated: false });
        }}>
        {start && !hero && <View style={s.intro}>
          <View style={[s.halo, { backgroundColor: t.soft }]}><Ink who={h ? h.kind : 'chief'} mood={h?.mood} size={72} /></View>
          <T style={s.introName}>{name}</T><T tone="ink2" style={[s.centerText, { maxWidth: 300 }]}>{h ? h.role : 'Runs the crew and answers to you'}</T>
        </View>}
        {!page && <View style={{ gap: 12, paddingLeft: 36, paddingTop: 20 }} accessibilityLabel="Opening the chat">{['62%', '84%', '40%'].map((w) => <View key={w} style={[s.bar, { width: w as any, backgroundColor: t.soft }]} />)}</View>}
        {fresh && page && canAct && own.length > 0 && <View style={[s.chips, { justifyContent: 'center' }]}>
            {own.map((i: Json) => <Btn key={i.bot + i.label} label={`${art.STAR} ${i.label}`} onPress={() => { keepDraft(id, i.ask); setSeed((n) => n + 1); }} />)}
          </View>}
        {lines.map((l, i) => start && i === 0 && l.from === 'note' && l.text.startsWith(`${name} joined the crew`) ? null : <View key={l.id} style={{ gap: 10 }}>{dayOf(l.at)}<motion.Rise reduce={reduce || l.id <= (opened.current ?? Infinity)}>
          <View onLayout={(e) => ys.current.set(l.id, e.nativeEvent.layout.y)} style={s.line}>
            {l.from === 'note' ? <>
              {!!l.by && <View style={[s.row, { gap: 8 }]}><Face who={A.crew(state).find((x) => x.id === l.by) ?? 'chief'} size={20} /><T tone="ink2" style={[s.small, { flex: 1 }]}>{l.text}</T></View>}
              {!!l.text && !l.by && <ChatText text={l.text} />}
            </> : <View style={{ flexDirection: 'row', gap: 10 }}>
              <T style={[s.small, s.b, { width: 60, color: t.ink2, paddingTop: 2 }]}>{speaker(l)}</T>
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                {!!l.by && <View style={[s.row, { gap: 8 }]}><Face who={A.crew(state).find((x) => x.id === l.by) ?? 'chief'} size={20} /><T tone="ink2" style={[s.small, { flex: 1 }]}>{l.text}</T></View>}
                {!!l.text && !l.by && (l.detail ? <ChiefAsk l={{ text: l.text, detail: l.detail }} /> : <ChatText text={l.text} />)}
                {!l.text && !!l.about && <ChatText text={l.about} />}
                {l.files.map((f) => <Card key={f.url}><FileRow f={f} /></Card>)}
                {phoneOffer?.message === l.id && <PhoneCard offer={phoneOffer} reload={() => void load()} />}
                {cards.filter((c) => lines.findLastIndex((x) => (x.at ?? 0) <= c.at) === i).map((c) => <AskCard key={c.id} c={c} who={h} state={state} onDone={refresh} canAct={canAct} offline={offline} open={open} />)}
              </View>
            </View>}
          </View></motion.Rise></View>
        )}
        {echoed && <motion.Rise reduce={reduce}><View style={s.line}><View style={{ flexDirection: 'row', gap: 10 }}><T style={[s.small, s.b, { width: 60, color: t.ink2, paddingTop: 2 }]}>You</T><T style={{ flex: 1 }}>{pending.text}</T></View></View></motion.Rise>}
        {!!partial && <View style={s.line} accessibilityLiveRegion="polite"><View style={{ flexDirection: 'row', gap: 10 }}>{who(id)}<T style={{ flex: 1 }}>{partial}<Text style={{ color: t.pink, opacity: reduce || beat % 2 === 0 ? 1 : 0 }}> ▍</Text></T></View></View>}
        {ln && <LiveLine ln={ln} go={go} />}
        {canAct && !!last?.choices.length && <View style={s.chips}>{last.choices.map((c) => <Btn key={c} label={c} onPress={() => send(c)} />)}</View>}
        {cards.filter((c) => !lines.length || lines.every((x) => (x.at ?? 0) > c.at)).map((c) => <AskCard key={c.id} c={c} who={h} state={state} onDone={refresh} canAct={canAct} offline={offline} open={open} />)}
      </ScrollView>
      {canAct || writer ? <View style={[s.dock, !!hero && { backgroundColor: t.bg }]}><Composer key={seed} placeholder={id === 'chief' ? 'Ask Chief anything' : `Message ${name}…`} onSend={send} chat={id} away={offline} /></View>
        : <T tone="mute" style={[s.small, { padding: 16 }]}>{offline ? "You can reply once the home computer is back." : "This phone watches the crew; it can't send messages."}</T>}
    </View>
  );
}

const LIVE_WORD: Record<A.LiveLine['state'], string> = { reading: A.WORDS.work, working: A.WORDS.work, needs: A.WORDS.needs, waiting: A.WORDS.wait,
  done: A.WORDS.done, failed: A.WORDS.failed, unsure: A.WORDS.unsure };
/** The live line under a thread, the same adapter web chat reads: who is on it, a clock counting up
 *  from crewd's own event times, and the job as a to-do list — done, doing, still to do — with the small
 *  tool calls behind the expand. At the end, one quiet line with how long it took. A job passed to a helper
 *  links to that helper's chat. The transcript's own look: every line named, no faces, no clocks beyond the step times. */
const TICK: Record<A.LiveTodo['state'], string> = { done: '✓', doing: '', todo: '○' };
function LiveLine({ ln, go }: { ln: A.LiveLine; go: Ctx['go'] }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  const beat = motion.useBeat(360, reduce);
  const [openDetail, setOpenDetail] = useState(false);
  const open = ln.helper ? <Pressable onPress={() => go({ view: 'helper', id: ln.helper })} accessibilityRole="link" hitSlop={8}><T style={[s.small, s.b]}>Open {ln.who}'s chat ›</T></Pressable> : null;
  // A crew member waiting on the person reads the neutral "Waiting"; only Chief's own line says "Needs you".
  const word = ln.state === 'needs' && !ln.chief ? 'Waiting' : LIVE_WORD[ln.state];
  if (ln.took !== undefined) return <View style={s.line} accessibilityLiveRegion="polite"><View style={{ flexDirection: 'row', gap: 10 }}>
    <T style={[s.small, s.b, { width: 60, color: t.ink2, paddingTop: 2 }]}>{ln.who}</T>
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <T tone="mute" style={s.small}>{ln.helper ? `${ln.who} · ` : ''}{word} · {A.took(ln.took)}{!!ln.count && ` · ${ln.count} ${ln.count === 1 ? 'step' : 'steps'}`}</T>
      {open}
    </View>
  </View></View>;
  const doing = ln.todos.find((x) => x.state === 'doing');
  return <View style={s.line} accessible accessibilityLabel={`${ln.who} is ${word}`} accessibilityLiveRegion="polite"><View style={{ flexDirection: 'row', gap: 10 }}>
    <T style={[s.small, s.b, { width: 60, color: t.ink2, paddingTop: 2 }]}>{ln.who}</T>
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <View style={[s.row, { gap: 6 }]}>
        <View style={[s.statusDot, { backgroundColor: ln.state === 'needs' ? t.pink : ln.state === 'waiting' ? t.line : t.ok, opacity: reduce ? 0.6 : beat % 2 === 0 ? 1 : 0.35 }]} />
        <T style={[s.small, s.b, { flexShrink: 1 }]}>{word}</T>
        <T tone="mute" style={s.time}>{A.took(Date.now() - ln.since)}</T>
      </View>
      {ln.todos.map((st) => <View key={`${st.at}-${st.text}`} style={[s.row, { gap: 6, alignItems: 'flex-start' }]}>
        {st.state === 'doing' ? <motion.Ring size={13} width={2} color={t.ink} reduce={reduce} />
          : <T style={[s.small, { color: st.state === 'todo' ? t.ink2 : t.ok }]}>{TICK[st.state]}</T>}
        <T style={[s.small, { flex: 1, fontWeight: st === doing ? '600' : '400', color: st.state === 'todo' ? t.ink2 : t.ink }]}>{st.text}{st === doing && Date.now() - st.at > 20_000 ? ' · still on it' : ''}</T>
      </View>)}
      {!!ln.detail.length && <Pressable onPress={() => setOpenDetail((v) => !v)} accessibilityRole="button" hitSlop={8}>
        <T tone="mute" style={s.small}>{openDetail ? 'Hide the small steps' : `Show the small steps (${ln.detail.length})`}</T></Pressable>}
      {openDetail && ln.detail.map((st) => <View key={`${st.at}-${st.text}`} style={[s.row, { gap: 6, alignItems: 'flex-start' }]}>
        <T tone="mute" style={s.time}>{A.clock(st.at)}</T>
        <T tone="mute" style={[s.small, { flex: 1 }]}>{st.text}</T>
      </View>)}
      {open}
    </View>
  </View></View>;
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

function ChiefPage(ctx: Ctx & { m?: number }) {
  const { mood } = chiefNow(ctx.state, ctx.offline);
  return (
    <View style={{ flex: 1 }}>
      <Head onBack={ctx.back}>
        <Face who="chief" size={32} mood={mood} />
        <View style={{ flex: 1 }}><T style={s.rowTitle}>Chief</T><T tone="ink2" style={s.small}>{ctx.offline ? OUT : 'Runs the crew and answers to you'}</T></View>
      </Head>
      <Chat {...ctx} id="chief" m={ctx.m} />
    </View>
  );
}

function Room(ctx: Ctx) {
  const { state, tick, refresh, canAct, offline } = ctx;
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.room().then(setPage).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, tick]);
  const crew = A.crew(state);
  const lines = A.room(page, state);
  const send = async (text: string) => { const ok = await attempt(() => api.post('chief', text, { room: true }), undefined, true); if (ok) { void load(); refresh(); } return ok; };
  return <View style={{ flex: 1 }}><Head onBack={ctx.back}><View style={{ width: 40, flexDirection: 'row' }}>{crew.slice(0, 2).map((h, i) => <View key={h.id} style={{ marginLeft: i ? -12 : 0 }}><Face who={h} size={26} /></View>)}</View><View style={{ flex: 1 }}><T style={s.rowTitle}>The crew</T><T tone="ink2" style={s.small}>Work handed between helpers</T></View></Head>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>{lines.map((l: { id: number; who?: A.Helper; from?: string; to?: string; text: string; at: number; author: string; files: A.FileView[] }) => <View key={l.id} style={{ width: '100%', maxWidth: '92%', alignSelf: l.author === 'person' ? 'flex-end' : 'flex-start' }}>
      {l.who && <View style={s.row}><Face who={l.who} size={28} /><T style={s.rowTitle}>{l.from && l.to ? `${l.from} → ${l.to}` : l.who.name}</T><T tone="mute" style={s.time}>{A.clock(l.at)}</T></View>}
      <View style={{ paddingLeft: l.author === 'person' ? 0 : 36 }}><ChatText text={l.text} /></View>{l.files.map((f) => <Card key={f.url}><FileRow f={f} /></Card>)}
    </View>)}{!lines.length && <T tone="mute">Start a job here and follow along as the crew works together.</T>}</ScrollView>
    {canAct ? <View style={s.dock}><Composer placeholder="Message the crew" onSend={send} chat="room" /></View> : <T tone="mute" style={[s.small, { padding: 16 }]}>{offline ? "You can reply once the home computer is back." : "This phone watches the crew; it can't send messages."}</T>}
  </View>;
}

// ---------- the crew ----------
// The office view is built from these same helpers (useOffice: A.office moved by live events, as the
// web crew page's live), so a member is only missing across a refresh: then the row falls back to the
// helper's own words rather than crashing, never a second status rule.
function Crew(ctx: Ctx) {
  const { state, go } = ctx;
  const view = useOffice(state, ctx.offline, OUT);
  const t = useLook();
  const chief = chiefPill(view, ctx.offline, OUT);
  const row = (key: string, face: ReactNode, name: string, role: string, status: ReactNode, route: Route) => <Pressable key={key} onPress={() => go(route)} style={{ minHeight: 68, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: t.line }}>
    {face}<View style={{ flex: 1, minWidth: 0 }}><T style={s.b}>{name}</T><T tone="mute" style={s.small} lines={1}>{role}</T></View>{status}
  </Pressable>;
  return <Page title="Your crew" lead="Everyone answers to Chief." back={['Home', () => go({ view: 'home' }, true)]}><Card>
    {row('chief', <Face who="chief" size={44} />, 'Chief', 'Runs the crew and answers to you', <Pill tone={chief.tone}>{chief.word}</Pill>, { view: 'chief' })}
    {A.crew(state).map((h) => row(h.id, <Face who={h} size={44} />, h.name, h.role, <HelperPill h={h} offline={ctx.offline} view={view} />, { view: 'helper', id: h.id }))}
    {ctx.canAct && <Pressable onPress={() => go({ view: 'add' })} style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderStyle: 'dashed', borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}><T tone="mute">+</T></View><T style={{ flex: 1 }}>Add a helper</T><T tone="mute">›</T></Pressable>}
  </Card></Page>;}

function HelperPage(ctx: Ctx & { id: string; tab: string; m?: number; setTab: (t: string) => void }) {
  const { id, tab, m, setTab, state, tick, refresh, canAct, back, go } = ctx;
  const h = A.crew(state).find((x) => x.id === id);
  const [page, setPage] = useState<Json>(null);
  const [all, setAll] = useState(false); // Details shows what it is doing now; "What happened" opens the whole trail in place
  const load = useCallback(() => api.bot(id).then(setPage).catch(() => {}), [id]);
  useEffect(() => { void load(); }, [load, tick]);
  if (!h) return <Center><T tone="mute">This helper has left the crew.</T></Center>;
  const b = state.bots.find((x: Json) => x.id === id);
  // The chat is the page; everything else lives behind Details. Old deep links to a section land on Details too.
  const details = tab !== 'chat';
  const trail = A.steps(page?.trail ?? []);
  // Opened from the bubble ('screen' after taking the wheel, or 'watch'): the screen leads and opens by itself.
  const screenFirst = tab === 'screen' || tab === 'watch';
  const screen = h.computer && desktopAvailable && <>
    <T style={s.b}>{`See ${h.name}'s screen`}</T>
    <Screen bot={{ ...page?.bot, ...b }} canAct={canAct} showing={A.showing(state, id)} watchNow={screenFirst} refresh={() => { refresh(); void load(); }} />
  </>;
  return (
    <View style={{ flex: 1 }}>
      {tab === 'chat' ? <>
        <Head onBack={back}>
          <Face who={h} size={32} />
          <View style={{ flex: 1 }}><T style={s.rowTitle}>{h.name}</T><T tone="ink2" style={s.small}>{ctx.offline ? OUT : h.role}</T></View>
          {b?.task && canAct && <Btn label="Stop" onPress={() => attempt(async () => { await api.reset(id); refresh(); }, `Stopped ${h.name}`)} />}
          <Btn ghost label="Details" onPress={() => setTab('details')} />
        </Head>
        <Chat key={id} {...ctx} id={id} m={m} />
      </> : <>
        <Head onBack={() => setTab('chat')}>
          <Face who={h} size={64} />
          <View style={{ flex: 1 }}><T style={s.b}>{h.name}</T><T tone="mute" style={s.small} lines={2}>{h.role}</T></View>
          <Btn ghost label="Chat" onPress={() => setTab('chat')} />
        </Head>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {screenFirst && screen}
          <T style={s.b}>Now</T>
          {b?.task ? (trail.length ? <Card><Steps steps={A.steps(page?.trail ?? [], b.task.id, true)} max={all ? 40 : 7} /></Card> : <T tone="mute">{`Working on “${A.plain(b.task.title)}”. Steps show as they happen.`}</T>)
            : <T tone="mute">Nothing right now.</T>}
          {trail.length > 7 && <Btn ghost label={all ? 'Just now' : 'What happened'} onPress={() => setAll((v) => !v)} />}
          <T style={s.b}>{`What ${h.name} made`}</T>
          {A.made(state, id).length ? <Card>{A.made(state, id).map((f) => <FileRow key={f.url} f={f} />)}</Card> : <Empty>{`${h.name}'s finished work shows up here.`}</Empty>}
          <T style={s.b}>Routines</T>
          <RoutineList {...ctx} bot={id} />
          <T style={s.b}>{`About ${h.name}`}</T>
          <Card>{A.aboutTraits(h.name, page?.soul).map((l, i) => <T key={i} style={{ paddingVertical: 4 }}>{l}</T>)}</Card>
          <Btn ghost label="Ask Chief to change it" onPress={() => { keepDraft('chief', `Please change how ${h.name} comes across: `); go({ view: 'chief' }); }} />
          {A.knows(page?.skills).length > 0 && <Card><T style={s.b}>Knows how to</T>{A.knows(page?.skills).map((k) => <T key={k.name} style={{ paddingVertical: 4 }}>{`• ${k.says}`}</T>)}</Card>}
          <T style={s.b}>{`What ${h.name} remembers`}</T>
          {A.memories(page?.notes).length ? <Card>{A.memories(page?.notes).map((mm, i) => <T key={i} style={{ paddingVertical: 6 }}>{mm}</T>)}</Card>
            : <Card><T tone="mute">Nothing yet. {h.name} adds a line when it learns something you like.</T></Card>}
          {A.signedIn(page).length > 0 && <>
            <T style={s.b}>Signed in to</T>
            <Card>{A.signedIn(page).map((h) => (
              <View key={h} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <T style={{ flex: 1 }}>{h}</T>
                <Btn ghost label="Forget" onPress={() => attempt(async () => { await api.forget(id, h); load(); }, 'Forgotten')} />
              </View>))}</Card>
          </>}
          {!screenFirst && screen}
        </ScrollView>
      </>}
    </View>
  );
}

/** A bot's own screen on the phone, through desklink over the encrypted link: Watch, Take the wheel, Hand it back.
 *  Taking the wheel is the whole page: one status line, the screen, Hand it back pinned at the bottom. */
function Screen({ bot, canAct, refresh, showing, watchNow }: { bot: Json; canAct: boolean; refresh: () => void; showing?: { words: string } | null; watchNow?: boolean }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  const control = bot.controls === 'person';
  const controlRef = useRef(control);
  controlRef.current = control;
  const watching = useRef(false);
  const sig = useRef<ReturnType<typeof desktopSignaling> | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [what, setWhat] = useState<string | null>(null);
  // The give-back ticks: hosts crewd read off its own tabs while the wheel is held — the tab on screen starts ticked.
  const [tabs, setTabs] = useState<string[]>([]);
  const [keep, setKeep] = useState<string[]>([]);
  useEffect(() => {
    if (!(canAct && control)) { setTabs([]); setKeep([]); return; }
    let on = true;
    api.pages(bot.id).then((p) => { if (on) { setTabs(p); setKeep(A.signTicks(p)); } }).catch(() => { if (on) setTabs([]); });
    return () => { on = false; };
  }, [control, canAct, bot.id]);
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
  useEffect(() => { if (watchNow) watch(); }, []);
  const stop = () => { watching.current = false; void session.close().then(() => sig.current?.close()); };
  const act = (fn: () => Promise<unknown>) => async () => { setErr(''); if (await attempt(fn)) refresh(); };
  const [help, setHelp] = useState(false);
  const live = session.snapshot.status;
  const idle = live === 'idle' || live === 'ended' || live === 'failed';
  const words: Record<string, string> = { opening: 'Opening…', connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', failed: "Couldn't open it" };
  // Taking the wheel: the whole page, the header and tab bar behind it. One status line, the screen, and
  // Hand it back pinned at the bottom with Keyboard beside the "?".
  if (canAct && control) return (
    <Modal visible animationType={motion.sheet(reduce)} onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <T style={[s.centerText, { padding: 12 }]}><Text style={s.b}>You're in control</Text>{` · ${bot.display} waits`}</T>
        <View style={{ flex: 1, margin: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: t.line }}>
          <DesktopView sessionId={session.nativeId} style={{ flex: 1 }} accessibilityLabel={`${bot.display}'s screen`} keyboardClearance={120} />
          {/* one calm grey line, with the way forward — never a doubled failure */}
          {idle && <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 16 }]}><T tone="mute" style={s.centerText}>{live === 'failed' ? "Couldn't open it. Try again in a moment." : `Opening ${bot.display}'s screen…`}</T></View>}
        </View>
        <View style={{ padding: 12, gap: 8 }}>
          {tabs.length > 0 && <View style={s.chips}>
            {tabs.map((h) => <Btn key={h} go={keep.includes(h)} ghost={!keep.includes(h)} label={`${keep.includes(h) ? '✓ ' : ''}${A.signTick(bot.display, h)}`}
              onPress={() => setKeep(keep.includes(h) ? keep.filter((x) => x !== h) : [...keep, h])} />)}
          </View>}
          <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={note} onChangeText={setNote} placeholder={`What did you do? ${bot.display} reads this`} placeholderTextColor={t.mute} accessibilityLabel="What did you do" />
          <Btn go big label="Hand it back" onPress={act(async () => { await api.giveBack(bot.id, note, keep); setNote(''); })} />
          <View style={[s.chips, { justifyContent: 'center' }]}>
            <Btn label="Keyboard" onPress={() => session.showKeyboard()} />
            <Btn ghost label="?" onPress={() => setHelp((v) => !v)} />
          </View>
          {help && <T tone="mute" style={s.small}>{bot.display} has its own computer at home, separate from yours. Taking the wheel pauses it, for a sign-in or anything it's stuck on; handing back lets it carry on.</T>}
        </View>
      </View>
    </Modal>
  );
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T style={[s.b, { flex: 1 }]}>{bot.display}'s screen</T>
        <Pill tone={live === 'live' ? 'ok' : 'off'}>{words[live] ?? 'Not watching'}</Pill>
      </View>
      <View style={{ width: '100%', aspectRatio: 1280 / 800, borderRadius: 16, overflow: 'hidden', backgroundColor: t.line }}>
        <DesktopView sessionId={session.nativeId} style={{ flex: 1 }} accessibilityLabel={`${bot.display}'s screen`} keyboardClearance={120} />
        {idle && <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 16 }]}><T tone="mute" style={s.centerText}>{live === 'failed' ? words.failed : `Watch ${bot.display} work on its own computer`}</T></View>}
      </View>
      {!!err && <T tone="pinkInk">{err}</T>}
      <View style={s.chips}>
        {idle ? <Btn go label={`Watch ${bot.display}`} onPress={watch} /> : <Btn label="Close" onPress={stop} />}
        {canAct && <Btn label="Take the wheel" onPress={act(async () => { await api.takeOver(bot.id); watching.current = true; if (idle) watch(); })} />}
        {what === null && <Btn label={`Show ${bot.display} how`} onPress={() => setWhat('')} />}
      </View>
      {what !== null && (
        <View style={{ gap: 8 }}>
          <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={what} onChangeText={setWhat} placeholder="What are you showing? For example: pull the newsletter stats" placeholderTextColor={t.mute} accessibilityLabel="What are you showing" />
          <View style={s.chips}>
            <Btn go label="Start" disabled={!what.trim()} onPress={act(async () => { await api.show(bot.id, what); setWhat(null); watching.current = true; if (idle) watch(); })} />
            <Btn ghost label="Cancel" onPress={() => setWhat(null)} />
          </View>
        </View>
      )}
      {canAct && showing && (
        <View style={{ gap: 8 }}>
          <T>{showing.words} I write down where you go and what you tap, never what you type.</T>
          <View style={s.chips}><Btn go label="Done showing" onPress={act(() => api.shown(bot.id, true))} /><Btn ghost label="Cancel" onPress={act(() => api.shown(bot.id, false))} /></View>
        </View>
      )}
      <T tone="mute" style={s.small}>{bot.display} has its own computer at home, separate from yours. Taking the wheel pauses it, for a sign-in or anything it's stuck on; handing back lets it carry on.</T>
    </Card>
  );
}

/** Routines on the phone: each one's schedule and latest run, with Do it now, Pause and Remove. Recurring work starts
 *  as a request to Chief (a card comes back to start); a row's time line is tappable, and its last run can be seen. */
function RoutineList({ state, refresh, canAct, bot, go }: Ctx & { bot?: string; go: (r: Route, replace?: boolean) => void }) {
  const t = useLook();
  const crew = A.crew(state);
  const [text, setText] = useState('');
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  const list = A.routines(state, bot);
  const ask = async () => { const x = text.trim(); if (!x) return; if (await attempt(() => api.post('chief', x), undefined, true)) { setText(''); refresh(); go({ view: 'chief' }); } };
  return (
    <>
      {canAct && !bot && <Card ask>
        <View style={s.row}>
          <Face who="chief" size={36} />
          <View style={{ flex: 1 }}><T style={s.b}>Tell Chief what should happen regularly</T>
            <T tone="mute" style={s.small}>In your own words. He brings it back as a card to start.</T></View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <TextInput style={[s.input, { flex: 1, color: t.ink, borderColor: t.line }]} value={text} onChangeText={setText}
            placeholder="Plan the week's dinners every Saturday morning" placeholderTextColor={t.mute} accessibilityLabel="Tell Chief what should happen regularly" />
          <Btn go label="Send" disabled={!text.trim()} onPress={() => void ask()} />
        </View>
      </Card>}
      {list.map((r: Json) => <RoutineRow key={r.id} r={r} h={crew.find((h) => h.id === r.helper)} act={act} go={go} canAct={canAct} />)}
      {!list.length && <Empty>Nothing on a schedule yet.</Empty>}
    </>
  );
}

/** One routine: tap its time line to move it (the same preview Chief's card uses); See result opens the last run. */
function RoutineRow({ r, h, act, go, canAct }: { r: Json; h: A.Helper | undefined; act: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>; go: (r: Route, replace?: boolean) => void; canAct: boolean }) {
  const t = useLook();
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState('');
  const [preview, setPreview] = useState<Json>(null);
  useEffect(() => {
    if (!moving || !when.trim()) { setPreview(null); return; }
    const x = setTimeout(() => api.schedule(when).then(setPreview).catch(() => setPreview({ bad: true })), 250);
    return () => clearTimeout(x);
  }, [when, moving]);
  const save = async () => { if (await act(() => api.routine(r.id, { schedule: when.trim() }), 'Time changed')) setMoving(false); };
  const open = () => go(r.result.thing ? { view: 'things' } : r.helper === 'chief' ? { view: 'chief', m: r.result.msg } : { view: 'helper', id: r.helper, m: r.result.msg });
  return (
    <Card style={r.paused && { opacity: 0.7 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Face who={h ?? 'chief'} size={40} />
        <View style={{ flex: 1 }}><T style={s.b}>{r.name}</T>
          {canAct ? <Pressable onPress={() => { setWhen(r.when); setMoving(true); }} accessibilityLabel="Change when it runs">
            <T tone="mute" style={s.small}>{`${r.watching ? `Keeps an eye on ${r.watching} · ` : ''}${r.when}${r.paused ? ' · paused' : ` · next ${r.next}`}`}</T>
          </Pressable> : <T tone="mute" style={s.small}>{`${r.watching ? `Keeps an eye on ${r.watching} · ` : ''}${r.when}${r.paused ? ' · paused' : ` · next ${r.next}`}`}</T>}
          {!!r.last && (r.result ? <Pressable onPress={open} accessibilityLabel="See result"><T tone="pinkInk" style={s.small}>{`${r.last} · See result`}</T></Pressable>
            : <T tone="mute" style={s.small}>{r.last}</T>)}</View>
      </View>
      {moving && <View style={{ marginTop: 8, gap: 6 }}>
        <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={when} onChangeText={setWhen} autoFocus
          placeholder="When? For example: every Saturday 10am" placeholderTextColor={t.mute} accessibilityLabel="When" autoCapitalize="none" />
        {!!preview && <T tone="mute" style={s.small}>{preview.bad ? "I didn't catch that time. Try “every Monday 9:00”." : `${preview.words}. First time ${preview.first}.`}</T>}
        <View style={s.chips}>
          <Btn go label="Save" disabled={!when.trim() || !preview || preview.bad} onPress={() => void save()} />
          <Btn ghost label="Cancel" onPress={() => setMoving(false)} />
        </View>
      </View>}
      {canAct && <View style={s.chips}>
        <Btn label="Do it now" onPress={() => act(() => api.runRoutine(r.id), 'Asked to run')} />
        <View style={[s.row, { marginLeft: 'auto' }]}><T tone="mute" style={s.small}>{r.paused ? 'Paused' : 'On'}</T><Switch value={!r.paused} accessibilityLabel={`${r.paused ? 'Resume' : 'Pause'} ${r.name}`} trackColor={{ false: t.line, true: t.ok }} thumbColor={t.solid} onValueChange={(on) => { void act(() => api.routine(r.id, { state: on ? 'on' : 'paused' })); }} /></View>        {!r.digest && <Btn ghost label="Remove" onPress={() => act(() => api.removeRoutine(r.id), 'Removed')} />}
      </View>}
    </Card>
  );
}

/** Something shared from another app (a photo of the school poster, a link, some text): who should have it, and a word.
 *  A bubble button's `brief` (how to go about it) is sent after the person's words and never shown in the box. */
function ShareIn({ state, shared, onDone, go, to: first = 'chief' }: { state: Json; shared: { text: string; brief?: string; files: { path: string; mimeType: string }[] }; onDone: () => void; go: Ctx['go']; to?: string }) {
  const t = useLook();
  const [to, setTo] = useState(first);
  const [text, setText] = useState(shared.text);
  const [pics, setPics] = useState<Photo[] | null>(null);
  useEffect(() => {
    const images = shared.files.filter((f) => f.mimeType.startsWith('image/')).slice(0, 4);
    void Promise.all(images.map((f) => shrink(f.path.startsWith('file:') || f.path.startsWith('content:') ? f.path : `file://${f.path}`))).then(setPics, () => setPics([]));
  }, []);
  const crew = A.crew(state);
  const send = () => attempt(async () => {
    await api.post(to, [text.trim(), shared.brief].filter(Boolean).join('\n'), (pics ?? []).map(({ type, data }) => ({ type, data })), text.trim());
    onDone();
    go(to === 'chief' ? { view: 'chief' } : { view: 'helper', id: to });
  }, 'Sent');
  return (
    <Page title="Send this to…" lead={first === 'chief' ? 'Chief will see it into the right hands, or pick a helper yourself.' : 'Send it as it is, or pick someone else.'}>
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
function AddHelper({ state, refresh, go, back }: Ctx) {
  const t = useLook();
  const [names, setNames] = useState<Record<string, string>>({});
  return (
    <Page title="Add a helper" lead="Pick a starter, or tell Chief what you need." back={['Your crew', back]}>
      <Label>Starters</Label><Card>{A.gallery(state).map((g: Json) => {
        const name = (names[g.id] ?? g.name).trim() || g.name;
        return <View key={g.id} style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: t.line }}>
          <Face who={{ kind: g.kind, name: g.name } as any} size={44} /><View style={{ flex: 1, minWidth: 0 }}><TextInput style={{ fontFamily: 'Inter', fontWeight: '500', fontSize: 15, color: t.ink, padding: 0 }} value={names[g.id] ?? g.name} onChangeText={(v) => setNames({ ...names, [g.id]: v })} accessibilityLabel={`Name for ${g.name}`} /><T tone="mute" style={s.small} lines={2}>{g.does}</T></View>
          <Btn label="Add" onPress={() => attempt(async () => { const b = await api.recruit(g.id, name); refresh(); go({ view: 'helper', id: b.id }, true); }, `${name} joined the crew`)} />
        </View>;
      })}</Card>
      <Label>Something else</Label><Card><T tone="mute" style={s.small}>Tell Chief what you need help with.</T><Composer placeholder="Tell Chief what you need help with" chat="chief" onSend={async (text) => { if (await attempt(() => api.post('chief', text), undefined, true)) go({ view: 'chief' }, true); }} /></Card>
    </Page>
  );
}

function ThingsList({ list, state, empty }: { list: A.Thing[]; state: Json; empty: string }) {
  const crew = A.crew(state);
  if (!list.length) return <Empty>{empty}</Empty>;
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

/** The accounts the crew can think with, as the phone may say them: this phone can't see who is signed in, so it names
 *  ChatGPT (the front door) and folds the other routes under "More ways to sign in", each with its own mark. */
function PhoneAccounts() {
  const t = useLook();
  const [more, setMore] = useState(false);
  const row = (ai: (typeof A.AIS)[number]) => <View key={ai.key} style={[s.row, { gap: 12, paddingVertical: 10 }]}>
    <AiMark ai={ai} />
    <View style={{ flex: 1 }}><T style={s.b}>{ai.name}</T>{!!ai.cli && <T tone="mute" style={s.small}>Needs {ai.cli} first.</T>}</View>
  </View>;
  return <>
    <Card style={{ gap: 0, paddingVertical: 6 }}>
      {row(A.AIS[0])}
      <T tone="mute" style={[s.small, { paddingBottom: 10 }]}>Signing in happens on the home computer, in Settings. This phone can't tell whether an account is signed in.</T>
    </Card>
    <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} accessibilityLabel="More ways to sign in"
      style={[s.row, { minHeight: 48, paddingHorizontal: 4, marginTop: 8 }]}>
      <T tone="ink2" style={{ flex: 1, fontWeight: '500' }}>More ways to sign in</T>
      {!more && <View style={[s.row, { gap: 4 }]}>{A.AIS.slice(1).map((ai) => <AiMark key={ai.key} ai={ai} size={22} />)}</View>}
      <T tone="mute">{more ? '⌄' : '›'}</T>
    </Pressable>
    {more && <Card style={{ gap: 0, paddingVertical: 6 }}>{A.AIS.slice(1).map(row)}</Card>}
    <T tone="mute" style={[s.small, { marginTop: 6, marginHorizontal: 4 }]}>{A.AI_ROUTES}</T>
  </>;
}

// ---------- this phone ----------
/** iPhone and iPad have no room for Chief to float over other apps, so this card shows how to get the same thing from the
 *  phone's own floating button and controls (the actions come from targets/actions). */
function OnYourScreen() {
  const t = useLook();
  const steps = [
    'In the Shortcuts app, open Crewhouse and add Ask Chief to your shortcuts.',
    'In Settings, go to Accessibility, Touch, AssistiveTouch, and switch it on.',
    'Tap Customize Top Level Menu, pick a spot, and choose Ask Chief.',
  ];
  return (
    <Card style={{ gap: 10 }}>
      <T style={s.b}>Chief on your screen</T>
      <T tone="mute">Your screen can keep a small button that you drag to any edge. Make it open Chief:</T>
      {steps.map((l, i) =>
        <View key={l} style={[s.row, { alignItems: 'flex-start' }]}><Text style={[s.stepNum, { backgroundColor: t.soft, color: t.ink }]}>{i + 1}</Text><T tone="ink2" style={{ flex: 1 }}>{l}</T></View>)}
      <T tone="mute" style={s.small}>Ask Chief, Write with Scribe and Record a demo with Reel also go in Control Center, on the Lock Screen, and on the Action button if yours has one. Each opens the chat with your words in the box; nothing is sent until you tap send.</T>
    </Card>
  );
}

/** Whether the crew can show at the top of the screen while it works; the phone's own setting decides, so this row says
 *  which way it is and opens that setting. Looked at again whenever the app comes back. */
function StatusBarRow() {
  const awake = motion.useAwake();
  const [st, setSt] = useState<StatusState | null>(null);
  useEffect(() => { if (awake) void chipState().then(setSt).catch(() => {}); }, [awake]);
  if (!st) return null;
  return (
    <Card>
      <T style={s.b}>Your crew at the top of the screen</T>
      <T tone={st === 'on' ? 'ink' : 'mute'}>{chipWords(st)}</T>
      {(st === 'off' || st === 'needs-permission') && <View style={s.row}><Btn label="Open phone settings" onPress={() => void chipSettings()} /></View>}
    </Card>
  );
}

/** "Chief on your screen": off until the person switches it on. The phone's own over-other-apps switch has to allow
 *  it; the row says so and opens that switch, and looks again when the person comes back. */
function BubbleRow({ grant }: { grant: Grant }) {
  const t = useLook();
  const awake = motion.useAwake();
  const [want, setWant] = useState<boolean | null>(null);
  const [st, setSt] = useState<OverlayState | null>(null);
  const turn = async (on: boolean) => { setWant(on); setSt(on ? await bubbleOn(grant) : (await bubbleOff(), 'off')); };
  useEffect(() => {
    if (!awake) return;
    void (async () => { const w = await wanted(); setWant(w); setSt(w ? await bubbleOn(grant) : await bubbleState()); })().catch(() => {});
  }, [awake]);
  if (want === null || st === null || st === 'unsupported') return null;
  return (
    <Card>
      <View style={s.row}>
        <View style={{ flex: 1 }}><T style={s.b}>Chief on your screen</T>
          <T tone="mute">A small Chief you can drag to either side, over your other apps. Tap him to ask, answer, write in the box you're typing in, or hand him your screen.</T></View>
        <Switch value={want} accessibilityLabel="Chief on your screen" trackColor={{ false: t.line, true: t.ok }} thumbColor={t.solid} onValueChange={(on) => void attempt(() => turn(on))} />
      </View>
      {want && st !== 'on' && <><T tone="ink2">{bubbleWords(st)}</T>
        {st === 'needs-permission' && <View style={s.row}><Btn label="Open phone settings" onPress={() => void openBubblePermission()} /></View>}</>}
    </Card>
  );
}

/** The places the desk's rail reaches, listed first in Settings on the phone (web/src/main.tsx GO_TO): no tab bar. */
const GO_TO: [Route['view'] | null, string, art.Tab | null][] = [['things', 'Your things', 'things'], ['routines', 'Routines', 'routines'], [null, 'Apps', null], ['crew', 'Your crew', 'crew']];
function ThisPhone({ grant, status, go, back, onForget, onClear }: { grant: Grant; status: Status; go: Ctx['go']; back: [string, () => void]; onForget: () => void; onClear: () => void }) {
  const t = useLook();
  // This phone knows its own news state: allowed and working, said no, or this build can't push at all.
  const [push, setPush] = useState<'on' | 'off' | 'missing' | null>(null);
  useEffect(() => { void pushState().then(setPush).catch(() => {}); }, []);
  return (
    <Page title="Settings" back={back}>
      <View style={[s.listGroup, { backgroundColor: t.solid, borderColor: t.line }]}>{GO_TO.map(([v, label, icon], i) => {
        const body = <>
          <View style={{ width: 24, alignItems: 'center' }}>{icon && <Dots rows={art.TABS[icon]} pal={{ x: t.ink2 }} d={20 / 9} crisp />}</View>
          {/* Apps connect where the sign-in happens; this phone has no apps screen of its own. */}
          <View style={{ flex: 1 }}><T style={s.rowTitle}>{label}</T>{!v && <T tone="mute" style={s.small}>Connected on the home computer, in Apps.</T>}</View>
          {!!v && <T tone="mute">›</T>}
        </>;
        const line = { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.line };
        return v ? <Pressable key={label} onPress={() => go({ view: v })} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.listRow, line, pressed && { opacity: 0.6 }]}>{body}</Pressable>
          : <View key={label} style={[s.listRow, line]}>{body}</View>;
      })}</View>
      <Label>This phone</Label>
      <Card>
        <T style={s.b}>{grant.device.name}</T>
        <T tone="mute">{grant.device.role === 'view' ? 'Watches the crew; can’t answer or give jobs.' : 'Answers the crew and gives them jobs, as you.'}</T>
        <View style={[s.row, { marginTop: 6 }]}><Pill tone={status === 'online' ? 'ok' : 'wait'}>{status === 'online' ? 'With the home computer' : 'Looking for the home computer…'}</Pill></View>
      </Card>
      <Label>Your AI accounts</Label>
      <PhoneAccounts />
      <Card>
        <T style={s.b}>News</T>
        <T tone={push === 'on' ? 'ink' : 'mute'}>{push ? PUSH_WORDS[push] : 'Checking…'}</T>
        {push === 'off' && <View style={s.row}><Btn label="Open phone settings" onPress={() => void Linking.openSettings()} /></View>}
      </Card>
      {Platform.OS === 'android' && <StatusBarRow />}
      {Platform.OS === 'android' && grant.device.role === 'control' && <BubbleRow grant={grant} />}
      {Platform.OS === 'ios' && <OnYourScreen />}
      <Card>
        <T style={s.b}>Chats kept on this phone</T>
        <T tone="mute">This phone keeps the last week of your chats, so you can read them while the home computer is off. Clearing removes them from this phone only; unpairing clears them too.</T>
        <View style={s.row}><Btn label="Clear" onPress={onClear} /></View>
      </Card>
      <T tone="mute" style={s.small}>{A.atHome('the home computer').join(' ')}</T>
      <T tone="mute" style={s.small}>🔒 Only the computer this phone was paired with can read what it sends.</T>
      <Btn label="Unpair this phone" onPress={onForget} />
      <T tone="mute" style={s.small}>To take a phone's access away for good, remove it on the computer too: Settings, Phones.</T>
    </Page>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  centerScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  centerText: { textAlign: 'center' },
  page: { padding: 16, gap: 12, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { fontFamily: 'Inter', fontSize: 15, lineHeight: 22, fontVariant: ['tabular-nums'] },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.6, marginVertical: 4 },
  display: { fontFamily: 'Inter', fontSize: 38, lineHeight: 42, fontWeight: '600', letterSpacing: 0, textAlign: 'center' },
  // Titles and names: Inter 600 (welcome, pairing, Hello, the office's sheets).
  serif: { fontFamily: 'Inter', fontWeight: '600', letterSpacing: 0 },
  stepNum: { width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, fontSize: 12, fontWeight: '700', overflow: 'hidden', marginTop: 0 },
  h2: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  b: { fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
  read: { fontSize: 16, lineHeight: 24 },
  askCard: { shadowColor: '#14121a', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  halo: { padding: 14, borderRadius: 999 },
  warmRing: { borderWidth: 10, padding: 16 },
  speech: { borderWidth: 1, borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18, gap: 4, marginTop: 6, shadowColor: '#14121a', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  speechTail: { position: 'absolute', top: -8, left: '50%', marginLeft: -7, width: 14, height: 14, borderLeftWidth: 1, borderTopWidth: 1, borderTopLeftRadius: 3, transform: [{ rotate: '45deg' }] },
  idea: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: 14, minHeight: 56 },
  ideaIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  palRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: radius.card, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 8, marginHorizontal: 4 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.7, textTransform: 'uppercase' },
  count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, fontSize: 11, lineHeight: 18, fontWeight: '700', textAlign: 'center', overflow: 'hidden' },
  office: { borderWidth: 1, borderRadius: 20, overflow: 'hidden' },
  stats: { flexDirection: 'row', gap: 6, marginTop: 14 },
  seg: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 4 },
  segBtn: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  stat: { flex: 1, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  statNum: { fontSize: 18, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 },
  statLabel: { fontSize: 12, lineHeight: 16 },
  time: { fontSize: 12, lineHeight: 16 },
  fp: { fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'], marginVertical: 8, textAlign: 'center' },
  card: { borderRadius: radius.card, padding: 16, gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 8, maxWidth: '100%' },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '500', flexShrink: 1 },
  btn: { borderRadius: radius.control, paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  btnBig: { alignSelf: 'stretch', minHeight: 48 },
  btnText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600' },
  input: { fontFamily: 'Inter', borderWidth: 1, borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: radius.pill, borderWidth: 1, paddingVertical: 7, paddingRight: 7, paddingLeft: 14, minHeight: 52 },
  composerInput: { fontFamily: 'Inter', flex: 1, fontSize: 15, paddingVertical: 8, maxHeight: 140 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dock: { paddingHorizontal: 12, paddingVertical: 8 },
  bubble: { alignItems: 'center', gap: 4, width: 64 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  stepDot: { width: 10, height: 10, borderRadius: 5 },
  line: { width: '100%', maxWidth: '92%', gap: 4, alignSelf: 'flex-start' },
  intro: { alignItems: 'center', gap: 2, paddingTop: 12, paddingBottom: 6 },
  introName: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3, marginTop: 8 },
  day: { alignItems: 'center', marginTop: 10 },
  dayText: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  typing: { flexDirection: 'row', gap: 5, paddingVertical: 8, flex: 1 },
  typingDot: { width: 7, height: 7, borderRadius: 4 },
  bar: { height: 14, borderRadius: 7 },
  listGroup: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
  rowTitle: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  fileIc: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fileGlyph: { fontSize: 20, lineHeight: 24 },
  fileOpen: { borderRadius: radius.control, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  unread: { minWidth: 20, height: 20, borderRadius: 10, color: '#2e2a40', fontSize: 12, fontWeight: '900', textAlign: 'center', overflow: 'hidden', paddingHorizontal: 5, lineHeight: 20 },
  offline: { paddingVertical: 7, paddingHorizontal: 16 },
  offlineText: { textAlign: 'center', fontSize: 13, fontWeight: '700' },
  toast: { position: 'absolute', bottom: 84, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, fontWeight: '500', overflow: 'hidden', maxWidth: '90%' },
  scanHint: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, gap: 12, backgroundColor: '#000a' },
  scrim: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  sheet: { padding: 22, paddingTop: 12, gap: 12, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: 2 },
  askStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  askWords: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  askQ: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.2 },
  askInline: { gap: 8, borderTopWidth: 1, borderStyle: 'dashed', paddingTop: 14, marginTop: 6 },
  ev: { borderRadius: radius.control, padding: 12, gap: 6, width: '100%' },
  orderRow: { flexDirection: 'row', gap: 12, alignItems: 'baseline', alignSelf: 'stretch' },
  label2: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
});

// The bubble's panel (src/panel.tsx) is its own screen over other apps, built from these same pieces.
export { AskSheet, attempt, Btn, Card, Composer, Face, look, s, say, ShareIn, T, Theme, Toast };
