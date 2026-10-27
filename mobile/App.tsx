// The Crewhouse phone app: the web app's screens (Pocket Pals), over the encrypted link to crewd.
// Everything a person reads comes through web/src/adapter.ts, the same plain-words view models as the web app
// (docs/ui-contract.md); the colours are web/src/tokens.ts and the mascots are web/src/art.ts, drawn as dots.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFonts } from 'expo-font';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, Clipboard, Image, Keyboard, KeyboardAvoidingView, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, PixelRatio, Share, useColorScheme, useWindowDimensions, View,} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as A from '../web/src/adapter.ts';
import { chatTokens, safeLink } from '../web/src/chat-md.ts';
import { api, setTransport, trouble, type Json } from '../web/src/api.ts';
import { draftOf, keepDraft, sent } from '../web/src/draft.ts';
import * as art from '../web/src/art.ts';
import { color, radius } from '../web/src/tokens.ts';
import { CONTROL_PERMISSIONS, DesktopView, useDesktopSession } from '@desklink/react-native';
import { desktopAvailable } from '@desklink/react-native/availability';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';

// React Native always defines this; @types/react-native is not installed, so say so once for tsc.
declare const __DEV__: boolean;
import { expo } from './app.json';
import * as Notifications from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import { VideoView, useVideoPlayer } from 'expo-video';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useShareIntent } from 'expo-share-intent';
import { qrMatrix } from '@byokit/ui-core';
import * as motion from './src/motion';
import { MARKS, WHERE } from './src/marks';
import { FACES } from './src/faces';
import { fw } from './src/font';
import { askOf, sharedOf } from './src/ask';
import { BUBBLE_DP, bubbleOff, bubbleOn, bubbleResume, bubbleState, bubbleWords, openBubblePermission, showCrew, useBubbleEdge, wanted, type OverlayState } from './src/bubble';
import { chip, chipSettings, chipState, chipWords, onChip, type StatusState } from './src/chip';
import { island } from './src/island';
import { useOffice } from './src/office';
import { glowOf } from '../web/src/office.tsx';
import { canHear, hear, stopHearing } from './modules/crewhouse-net';
import { pairWords } from './src/pair-words';
import { readLink } from '../web/src/typed.ts';
import { canPush, connect, desktopSignaling, forgetGrant, keepGrant, kept, loadGrant, noPushCredential, onLive, pairLink, pairTypedCode, type Grant, type Status } from './src/link';
import { askPhone, chatToMove, heardAt, isOffline, loadChat, markHeard, pendingTurns, phoneConnect, phoneExpired, phoneMode, phoneModels, phonePick, phonePlan, phoneSignedIn, phoneSignInWords, phoneSignOut, phoneWords, probeOnline, queueTurn, rememberChief, rememberUser, moveChatTo, setPhoneMode, shareDocument, PHONE_KEYS, type ChatTurn, type PhoneDocument, type PhoneKey, type PhoneLine, type PhoneModel } from './src/phone-only';
import { boatOn, cloudOn, cloudStore, forgetKey, keptKey, lab, phoneKeys } from './src/cloud';
import { checkKey, computerCall, computerGrant, connect as setUpCloud, cost, make as makeComputer, progress, said } from '../web/src/cloud.ts';
import { MachineError, type MachineRef, type SetupStep } from '@byokit/cloud';
import { clearRetryOf, drainPending, failOffOf, historyOf, retrySuffix } from './src/phone-queue';

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

// The Stack's display type (web/src/styles.css .wide/.semi): Archivo at 125% width 800 and 112% width 700, as static
// cuts of the web's variable file, one family each, so both platforms draw them without a weight.
const ARCHIVO = { Archivo_Wide: require('./assets/fonts/Archivo-Wide.ttf'), Archivo_Semi: require('./assets/fonts/Archivo-Semi.ttf') };
export default function App() {
  const t = look(useColorScheme() === 'dark');
  // Android draws one variable file at its default weight, so the bold weights load as their own static
  // families (src/font.ts maps each weight); iOS keeps the variable font alone, as before.
  const [fontsReady, fontError] = useFonts(
    Platform.OS === 'android'
      ? {
          Inter: require('./assets/fonts/InterVariable.ttf'),
          Inter_Medium: require('./assets/fonts/Inter-Medium.ttf'),
          Inter_SemiBold: require('./assets/fonts/Inter-SemiBold.ttf'),
          Inter_Bold: require('./assets/fonts/Inter-Bold.ttf'),
          Inter_Black: require('./assets/fonts/Inter-Black.ttf'),
          ...ARCHIVO,
        }
      : { Inter: require('./assets/fonts/InterVariable.ttf'), ...ARCHIVO },
  );
  const [grant, setGrant] = useState<Grant | null | undefined>(undefined);
  // Phone-only is an option beside pairing, remembered on this phone; pairing wins when a computer is there.
  const [phone, setPhone] = useState<boolean | null>(null);
  const leavePhone = () => { void setPhoneMode(false); setPhone(false); };
  useEffect(() => { loadGrant().then(setGrant).catch(() => setGrant(null)); }, []);
  useEffect(() => { phoneMode().then(setPhone).catch(() => setPhone(false)); }, []);
  return (
    <Theme.Provider value={t}>
      <SafeAreaProvider>
        <StatusBar barStyle={t.night ? 'light-content' : 'dark-content'} backgroundColor={t.bg} />
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
          {!fontsReady && !fontError ? <Center><ActivityIndicator color={t.ink} /></Center>
            : grant === undefined || phone === null ? <Center><ActivityIndicator color={t.ink} /></Center>
            // Phone-only stays a way out even with a pairing kept: leaving it returns to the paired app, grant intact.
            : phone ? <PhoneOnly onExit={leavePhone} />
            : grant === null ? <GetStarted onPhoneOnly={() => { void setPhoneMode(true); setPhone(true); }} onPaired={(g) => { notNow = false; void setPhoneMode(false); setPhone(false); setGrant(g); }} />
            : <Crewhouse grant={grant} onRemoved={() => setGrant(null)} onRepaired={(g) => setGrant(g)} onPhoneOnly={() => { void setPhoneMode(true); setPhone(true); }} />}
          <Toast />
        </SafeAreaView>
      </SafeAreaProvider>
    </Theme.Provider>
  );
}

// ---------- dot pictures and faces ----------
/** `cell`: how much taller than wide each cell is; the dot stays round in its middle. `d` snaps
 *  to whole device pixels so every dot is the same size and the rows keep one pitch, even at a few pixels a dot. */
function Dots({ rows, pal, d: raw, crisp = false, cell = 1 }: { rows: art.Bitmap; pal: art.Palette; d: number; crisp?: boolean; cell?: number }) {
  const d = PixelRatio.roundToNearestPixel(raw) || 1 / PixelRatio.get();
  return (
    <View accessible={false}>
      {rows.map((r, y) => (
        <View key={y} style={{ flexDirection: 'row' }}>
          {[...r].map((k, x) => <View key={x} style={{ width: d, height: d * cell, justifyContent: 'center' }}>{pal[k] ? <View style={{ height: d, borderRadius: crisp ? 0 : d, backgroundColor: pal[k] }} /> : null}</View>)}
        </View>
      ))}
    </View>
  );
}
/** Chief or a helper as its Geo face (web/src/art.ts, drawn to PNGs by scripts/icons.mjs), `size` square. */
function Ink({ who, mood = 'idle', size }: { who: art.Kind | 'chief'; mood?: art.Mood; size: number; whole?: boolean; wave?: boolean }) {
  return <Image source={FACES[`${who}-${art.faceOf(mood)}`]} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />;
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
      borderWidth: ring ? 2 : 0, borderColor: ring === 'needs' ? t.pink : t.green }}>
      <Image source={FACES[`${chief ? 'chief' : who.kind}-${art.faceOf(chief ? mood : who.mood)}`]} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
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
/** No account's mark: a plain key on a soft tile, for when nothing is signed in. */
function KeyMark({ size = 32 }: { size?: number }) {
  const t = useLook(), u = size / 32;
  return <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: t.soft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 10 * u, height: 10 * u, borderRadius: 5 * u, borderWidth: 2.5 * u, borderColor: t.ink2 }} />
    <View style={{ width: 9 * u, height: 2.5 * u, backgroundColor: t.ink2 }}><View style={{ position: 'absolute', right: 0, top: 0, width: 2.5 * u, height: 5 * u, backgroundColor: t.ink2 }} /></View>
  </View>;
}

/** The AI accounts signed in on the home computer, from Settings' own list there (`GET /api/accounts`); null until the
 *  computer answers, and on a computer too old to tell a phone. */
function useSignedIn(tick = 0) {
  const [mine, setMine] = useState<ReturnType<typeof A.aiList>['mine'] | null>(null);
  useEffect(() => { api.accounts().then((l) => setMine(A.aiList(l).mine.filter((r) => r.g.state === 'ready')), () => {}); }, [tick]);
  return mine;
}
const andJoin = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];

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
function Btn({ label, onPress, go, ghost, danger, big, disabled, ink, soft, tall }: { label: string; onPress: () => void; go?: boolean; ghost?: boolean; danger?: boolean; big?: boolean; disabled?: boolean; ink?: boolean; soft?: boolean; tall?: boolean }) {
  const t = useLook();
  const flat = go || ghost || danger || ink || soft;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.btn, { backgroundColor: go ? t.go : danger ? t.danger : ink ? t.ink : soft ? t.soft : ghost ? 'transparent' : t.solid, borderColor: flat ? 'transparent' : t.line },
        big && s.btnBig, tall && s.btnTall, (pressed || disabled) && { opacity: 0.55 }]}>
      <Text style={[s.btnText, tall && s.btnTallText, { color: go ? t.goInk : danger ? t.bg : ink ? t.bg : ghost ? t.ink2 : t.ink }]}>{label}</Text>
    </Pressable>
  );
}
/** A secondary affordance in a sheet (Edit, Read all): a small underlined link, never a second answer. Keeps an
 *  approval's answers to the two decisions — yes and the one way out — however much detail the card carries. */
function Link({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const t = useLook();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
    style={({ pressed }) => [(pressed || disabled) && { opacity: 0.55 }]}>
    <T style={[s.small, { color: t.pinkInk, textDecorationLine: 'underline' }]}>{label}</T>
  </Pressable>;
}
function ChatText({ text, latest }: { text: string; latest?: boolean }) {
  const t = useLook();
  const [more, setMore] = useState(false);
  const long = !latest && (text.length > 700 || text.split('\n').length > 10);
  const shown = long && !more ? text.slice(0, 650).replace(/\s+\S*$/, '') : text;
  const inline = (tokens: any[]): ReactNode => tokens.map((x, i) => x.type === 'strong' ? <Text key={i} style={s.b}>{inline(x.tokens)}</Text>
    : x.type === 'em' ? <Text key={i} style={{ fontStyle: 'italic' }}>{inline(x.tokens)}</Text>
    : x.type === 'link' && safeLink(x.href) ? <Text key={i} accessibilityRole="link" onPress={() => void Linking.openURL(safeLink(x.href))} style={{ textDecorationLine: 'underline', backgroundColor: t.soft, color: t.ink }}>{inline(x.tokens)}</Text>
    : x.type === 'html' ? x.raw : x.tokens ? <Text key={i}>{inline(x.tokens)}</Text> : x.text ?? x.raw);
  const blocks = (tokens: any[]): ReactNode => tokens.map((x, i) => x.type === 'heading' ? <T key={i} style={{ fontSize: 18, lineHeight: 25, ...fw('600'), marginTop: 8 }}>{inline(x.tokens)}</T>
    : x.type === 'paragraph' || x.type === 'text' ? <T key={i}>{inline(x.tokens ?? [{ text: x.text }])}</T>
    : x.type === 'list' ? <View key={i} style={{ gap: 5 }}>{x.items.map((item: any, j: number) => <View key={j} style={{ flexDirection: 'row', gap: 6 }}><T>{item.task ? item.checked ? '☑' : '☐' : x.ordered ? `${x.start + j}.` : '•'}</T><View style={{ flex: 1 }}>{blocks(item.tokens.filter((y: any) => y.type !== 'checkbox'))}</View></View>)}</View>
    : x.type === 'blockquote' ? <View key={i} style={{ backgroundColor: t.soft, borderLeftWidth: 3, borderLeftColor: t.line2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, gap: 6 }}>{blocks(x.tokens)}</View>
    : x.type === 'table' ? <Wide key={i}><View>{[x.header, ...x.rows].map((row: any[], j: number) => <View key={j} style={{ flexDirection: 'row' }}>{row.map((c, k) => <View key={k} style={{ minWidth: 90, maxWidth: 200, padding: 6, borderWidth: 1, borderColor: t.line }}><T style={j ? undefined : s.b}>{inline(c.tokens)}</T></View>)}</View>)}</View></Wide>
    : x.type === 'code' ? <View key={i} style={{ backgroundColor: t.soft, borderRadius: 8, padding: 10 }}><T style={{ fontSize: 14, lineHeight: 20 }}>{x.text}</T></View>
    : x.type === 'html' ? <T key={i}>{x.raw}</T> : null);
  return <View style={{ gap: 10, maxWidth: 560 }}>{blocks(chatTokens(shown))}{long && <Pressable onPress={() => setMore(!more)} accessibilityRole="button"><T style={s.b}>{more ? 'Less' : 'More'}</T></Pressable>}</View>;
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
    {offer.joined ? <T style={s.b}>Paired: {offer.joined}</T> : offer.waiting ? <><T>{offer.waiting.name} is waiting. Check these two words: {offer.waiting.words}</T><T tone="mute">For your safety, approve on the computer where this code was shown.</T></> : left ? <><T>Scan this with the other phone, or type this code there while it's on your computer's Wi‑Fi. Approve on the computer.</T><T style={s.b}>{current.typed}</T><Btn label="Copy code" onPress={() => { Clipboard.setString(current.typed); say('Code copied'); }} /><T tone="mute">Works once · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</T></>
      : <><T tone="mute">That code has run out.</T><Btn go label="Show a new code" onPress={() => { active.current = Date.now(); void renew(); }} /></>}
  </Card>;
}
/** A section's name, in small capitals; `count` is the pink number beside Needs you. */
function Label({ children, count }: { children: ReactNode; count?: number }) {
  const t = useLook();
  return <View style={s.labelRow}><T tone="ink2" style={s.label}>{children}</T>{!!count && <Text style={[s.count, { backgroundColor: t.pink, color: t.night ? '#1A0F14' : '#fff' }]}>{count}</Text>}</View>;
}
/** A screen of its own. `back` is its way out (B1 has no tab bar): "‹ Home", or the screen it came from. */
function Page({ title, lead, back, children, scroll }: { title?: string; lead?: string; back?: [string, () => void]; children: ReactNode; scroll?: { current: ScrollView | null } }) {
  return (
    <ScrollView ref={scroll} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
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
/** A document sent with the words (docs/ui-contract.md `files`): crewd's own type by file ending, since a phone's
 *  picker names a .md or .csv several ways; crewd keeps the allow-list and the 10 MB limit, and names the file itself. */
type Doc = { name: string; type: string; size: number; data: string };
const DOCS: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown' };
const ending = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

/** A file the person sent, as mock 3A draws it: its kind on a tag, then the name on one line over kind and size, as
 *  the web's card says them (web/src/parts.tsx `Media`). `remove` takes one back out of the box before it is sent. */
function FileChip({ name, kind, size, remove }: { name: string; kind: string; size: number; remove?: () => void }) {
  const t = useLook(), { width, fontScale } = useWindowDimensions();
  const narrow = width / fontScale < 360; // large text: the tag goes over the name, never squeezes it
  const tag = <View style={[s.fileTag, { backgroundColor: t.softAccent }]}><Text style={[s.small, s.b, { color: t.pink }]}>{kind}</Text></View>;
  const x = remove && <Pressable onPress={remove} accessibilityLabel={`Remove ${name}`} hitSlop={10}><T tone="ink2">✕</T></Pressable>;
  // Narrow: the whole name wraps, and the tag above already says the kind, so the size alone keeps its one line.
  const sz = A.fileSize(size).replace(' ', '\u00a0');
  const words = <View style={{ flexShrink: 1, minWidth: 0 }}><T style={s.b} lines={narrow ? undefined : 1}>{name}</T><T tone="mute" style={s.small} lines={1}>{narrow ? sz : `${kind} · ${sz}`}</T></View>;
  return <View style={[s.fileChip, { backgroundColor: t.solid, borderColor: t.line }, narrow ? { gap: 6 } : s.row]}>
    {narrow ? <><View style={[s.row, { justifyContent: 'space-between' }]}>{tag}{x}</View>{words}</> : <>{tag}{words}{x}</>}
  </View>;
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
      message: 'Crewhouse hears you only while the mic is on. Your words wait in the box until you send them.', buttonPositive: 'OK' });
    if (!shown.current) return;
    if (mic !== PermissionsAndroid.RESULTS.GRANTED) { setListening(false); return say('Allow the microphone for Crewhouse in your phone settings, then try again.'); }
    hear().then((w) => { if (w) put(now.current.trim() ? `${now.current.trimEnd()} ${w}` : w); else say("I didn't catch that. Try again."); },
      (e) => say(/blocked/.test(`${e?.code} ${e?.message}`) ? 'Allow the microphone for Crewhouse in your phone settings, then try again.'
        : "This phone can't hear yet. In Settings, open Google ▸ Speech services (or Voice) and download your language, then try again."))
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
 *  photos or, with `docs`, documents. A send that didn't go through keeps them all with a Retry; each chat holds its own
 *  words (web/src/draft.ts). `thread`: Chief's own thread's box (J03), one row with a square ink send. */
function Composer({ placeholder, onSend, chat, photos: canPhoto = true, docs: canDoc = false, away, mic = chat === 'chief', listen, stop, thread }: { placeholder: string; onSend: (t: string, photos: Photo[], files: Doc[]) => unknown; chat?: string; photos?: boolean; docs?: boolean; mic?: boolean; listen?: boolean; away?: boolean; stop?: () => void; thread?: boolean }) {
  const t = useLook();
  const [text, setText] = useState(() => (chat ? draftOf(chat).text : ''));
  const [pics, setPics] = useState<Photo[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = !!text.trim() || pics.length + docs.length > 0;
  // Chief's box (B1): the send stays dark while there is nothing to send, never a faded accent.
  const dark = chat === 'chief', on = ready && !busy && !away;
  const change = (x: string) => { setText(x); setFailed(false); if (chat) keepDraft(chat, x); };
  const send = async () => {
    if (away || busy || !ready) return;
    const x = text.trim(), p = pics, d = docs;
    setBusy(true);
    setText(''); setPics([]); setDocs([]); if (chat) keepDraft(chat, '');
    let ok = false;
    try { ok = !!(await onSend(x, p, d)); } catch { ok = false; }
    setBusy(false);
    if (!ok) { setFailed(true); setText(x); setPics(p); setDocs(d); if (chat) { keepDraft(chat, x); sent(chat, false, x); } }
  };
  const room = 4 - pics.length - docs.length;
  const pick = () => attempt(async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 1 });
    if (r.canceled) return;
    const made = await Promise.all(r.assets.slice(0, room).map((a) => shrink(a.uri)));
    setPics((p) => [...p, ...made].slice(0, room + p.length));
  });
  // One the box can't send is left out and said why, never sent half-read.
  const pickDoc = () => attempt(async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: [DOCS.pdf, DOCS.docx, DOCS.xlsx, 'text/*'], multiple: true });
    if (r.canceled) return;
    const made = await Promise.all(r.assets.slice(0, room).map(async (a): Promise<Doc | null> => {
      const type = DOCS[ending(a.name)];
      if (!type) { say(`“${a.name}” can't be sent. Try a PDF, a Word or Excel file, or a text file.`); return null; }
      if ((a.size ?? 0) > 10 << 20) { say(`“${a.name}” is too big. Try one under 10 MB.`); return null; }
      const data = await new File(a.uri).base64();
      return { name: a.name, type, size: a.size ?? Math.floor((data.length * 3) / 4), data };
    }));
    setDocs((d) => [...d, ...made.filter((m): m is Doc => !!m)].slice(0, room + d.length));
  });
  const [choosing, setChoosing] = useState(false), reduce = motion.useReduceMotion();
  const attach = () => canDoc ? setChoosing(true) : void pick();
  const choose = (fn: () => unknown) => { setChoosing(false); void fn(); };
  // At the largest text the words take the whole box and the buttons drop to the row under them, so the placeholder
  // and what is typed keep one line (the same switch the phone's head makes, `PhoneHead`).
  const { width, fontScale } = useWindowDimensions();
  const oneRow = width / fontScale >= 360;
  const plus = canPhoto && <Pressable onPress={attach} disabled={room <= 0} accessibilityLabel={canDoc ? 'Add a photo or a document' : 'Add a photo'} style={[s.send, { backgroundColor: 'transparent' }]}>
    <Text style={{ color: t.ink, fontSize: 20 }}>＋</Text>
  </Pressable>;
  // While Chief works, an empty box's send becomes a stop square (the same reset a helper's Stop uses).
  const rest = <>
    <Mic on={mic} text={text} put={change} listen={listen} />
    {stop && !ready
      ? <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel="Stop" style={[s.send, { backgroundColor: t.ink, borderRadius: 10 }, thread && s.square]}>
        <View style={thread ? { width: 16, height: 16, borderRadius: 4, borderWidth: 2, borderColor: t.bg } : { width: 14, height: 14, borderRadius: 3, backgroundColor: t.solid }} />
      </Pressable>
      : <Pressable onPress={() => void send()} disabled={away || !ready || busy} accessibilityLabel="Send" accessibilityState={{ disabled: away || !ready || busy }} style={[s.send, thread ? [s.square, { backgroundColor: t.ink }] : dark ? { backgroundColor: on ? t.go : t.ink, borderRadius: 10 } : { backgroundColor: t.go, opacity: on ? 1 : 0.4 }]}>
        <Text style={{ color: thread ? t.bg : dark && !on ? t.solid : t.goInk, fontSize: thread ? 22 : 18, ...fw('900') }}>↑</Text>
      </Pressable>}
  </>;
  const field = (full: boolean) => <TextInput style={[s.composerInput, { color: t.ink }, thread && { fontSize: 16 }, full && { flexBasis: '100%' }]} value={text} onChangeText={change} multiline placeholder={placeholder} placeholderTextColor={t.mute} accessibilityLabel={placeholder} />;
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
      {choosing && <Modal visible transparent animationType={motion.sheet(reduce)} onRequestClose={() => setChoosing(false)}>
        <Pressable style={s.scrim} onPress={() => setChoosing(false)}>
          <Pressable style={[s.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
            <View style={[s.grabber, { backgroundColor: t.line2 }]} />
            <T style={s.h2}>Add to your message</T>
            <Btn big label="A document: PDF, Word, Excel or text" onPress={() => choose(pickDoc)} />
            <Btn big label="A photo" onPress={() => choose(pick)} />
            <Btn ghost label="Cancel" onPress={() => setChoosing(false)} />
          </Pressable>
        </Pressable>
      </Modal>}
      {docs.length > 0 && <View style={{ gap: 6, paddingHorizontal: 8 }}>{docs.map((d, i) => <FileChip key={`${d.name}.${i}`} name={d.name} kind={ending(d.name).toUpperCase()} size={d.size} remove={() => setDocs((x) => x.filter((_, j) => j !== i))} />)}</View>}
      <View style={[s.composer, { backgroundColor: t.solid, borderColor: t.line, opacity: busy ? 0.7 : 1 }, thread && s.threadBox, !oneRow && { flexWrap: 'wrap', borderRadius: radius.control }]}>
        {oneRow ? <>{plus}{field(false)}{rest}</>
          : <>{field(true)}<View style={[s.row, { width: '100%', gap: 8 }]}>{plus}<View style={{ flex: 1 }} />{rest}</View></>}
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
  const [uri, setUri] = useState(''), [open, setOpen] = useState(false), [error, setError] = useState('');
  const t = useLook(), src = A.fileSource(f.url);
  useEffect(() => { setUri(''); setError(''); if (src) void api.photo(src.bot, src.path).then((p) => setUri(`data:${p.type};base64,${p.data}`)).catch((e) => setError(e.message)); }, [f.url]);
  return uri ? <>
    <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`Open ${f.name} full size`}>
      <Image source={{ uri }} style={{ width: '100%', height: 180, borderRadius: 16 }} resizeMode="contain" accessibilityLabel={f.name} />
    </Pressable>
    <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="none">
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, padding: 16, gap: 12 }}>
        <Btn label="Close picture" onPress={() => setOpen(false)} />
        <Image source={{ uri }} style={{ flex: 1, width: '100%' }} resizeMode="contain" accessibilityLabel={f.name} />
      </SafeAreaView>
    </Modal>
  </> : <View><FileRow f={f} plain />{!!error && <T tone="ink2">{error}</T>}</View>;
}

/** Files open right here, through the same crewd-parsed words the web's reader shows — a document (.docx, .md, .txt),
 *  a spreadsheet (.xlsx), a video fetched in pieces over the link. Anything else really is on the computer. */
/** A job just finished, in Chief's thread (web/src/parts.tsx DoneCard, Stack J16a): its maker's colour and face, Done., the
 *  thread's own words for what came of it, then Open it or Later. */
function DoneCard({ f, who, text, later }: { f: A.FileView; who: A.Helper | 'chief'; text: string; later: () => void }) {
  const [open, setOpen] = useState(false);
  const chief = who === 'chief', ink = chief ? '#F7F7FB' : INK;
  const btn = (label: string, onPress: () => void, go = false) => <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
    style={({ pressed }) => [s.liveBtn, { flexGrow: 1, paddingHorizontal: 20, backgroundColor: go ? (chief ? '#F7F7FB' : INK) : 'rgba(0,0,0,0.1)' }, pressed && { opacity: 0.8 }]}>
    <Text style={[s.read, { color: go ? (chief ? INK : '#fff') : ink, ...fw('700') }]}>{label}</Text></Pressable>;
  return <View accessibilityLabel={`Done: ${f.name}`} style={[s.live, { flex: 0, width: '100%', alignItems: 'center', gap: 14, padding: 20, borderRadius: 30, backgroundColor: art.colourOf(chief ? 'chief' : who.kind) }]}>
    <Face who={chief ? 'chief' : { kind: who.kind, name: who.name, mood: 'happy' }} size={96} />
    <Text style={{ fontSize: 30, lineHeight: 32, color: ink, ...fw('800') }}>Done.</Text>
    <Text style={[s.read, { color: ink, textAlign: 'center' }]}>{text}</Text>
    <View style={[s.row, { alignSelf: 'stretch', gap: 8 }]}>{btn('Open it', () => setOpen(true), true)}{btn('Later', later)}</View>
    {open && <DocSheet f={f} onClose={() => { setOpen(false); later(); }} />}
  </View>;
}
function FileRow({ f, plain }: { f: A.FileView; plain?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useLook();
  if (!plain && f.kind === 'image' && /\/photos\//.test(f.url)) return <PhotoView f={f} />;
  const readable = A.phoneReadable(f);
  const word = f.kind === 'video' ? 'Play' : 'Read';
  const kind = f.kind === 'video' ? 'Video' : f.kind === 'image' ? 'Picture' : f.kind === 'sheet' ? 'Spreadsheet' : 'Document';
  // A file the person sent is a chip (mock 3A). Otherwise the name gets the room: a tile, the name on up to two lines
  // with its kind under it, then Read or Play.
  const row = f.size ? <FileChip name={f.name} kind={A.fileTarget(f)?.chip ?? 'FILE'} size={f.size} /> : <View style={s.row}>
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

/** A wide table on a narrow screen: the columns are reachable, so say how — a quiet line under the table. The two widths
 *  come from the layout as it lands (refs, not the state of an earlier render), so a table that fits says nothing. */
function Wide({ children }: { children: ReactNode }) {
  const [wide, setWide] = useState(false);
  const box = useRef(0), content = useRef(0);
  const check = () => setWide(content.current > box.current + 8);
  return <View>
    <View onLayout={(e) => { box.current = e.nativeEvent.layout.width; check(); }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} onContentSizeChange={(w) => { content.current = w; check(); }}>{children}</ScrollView>
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
    : run.kind === 'heading' ? <T key={i} style={{ fontSize: 18, lineHeight: 25, ...fw('600'), marginTop: i ? 6 : 0 }}>{run.text}</T>
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
/** What this phone knows about its own news: allowed and working (on), said no (off), or this build can't push at all
 *  (missing — the phone still shows everything the moment the app is opened). */
async function pushState(ask = false): Promise<'on' | 'off' | 'missing'> {
  // No push credential in this build: never ask, so "You're in" carries no permission dialog and no line.
  if (ask && !(await canPush().catch(() => true))) return 'missing';
  const { status } = ask ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
  if (status !== 'granted') return 'off';
  const token = await Notifications.getExpoPushTokenAsync().then((x) => x.data, (e) => (noPushCredential(e) ? '' : undefined));
  return token === '' ? 'missing' : 'on';
}
const PUSH_WORDS = {
  on: 'On',
  off: 'Notifications are off for Crewhouse on this phone',
  missing: "Notifications aren't switched on yet. You'll see news when you open Crewhouse.",
};

function Pair({ onPaired, onBack, onPut, paste, link }: { onPaired: (g: Grant) => void; onBack?: () => void; onPut?: () => void; paste?: boolean; link?: string | null }) {
  const t = useLook();
  const [perm, askPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Grant | null>(null);
  const [words, setWords] = useState('');
  const [code, setCode] = useState('');
  const seen = useRef('');
  // Whether the camera itself is the problem, kept as its own answer: the "Open phone settings" button belongs to
  // that, and no pairing sentence can be read for it (the wrong-code sentence talks about pointing the camera).
  const [noCamera, setNoCamera] = useState(false);
  const openCamera = async () => {
    const p = perm?.granted ? perm : await askPerm();
    if (p.granted) { setNoCamera(false); setScanning(true); } else { setNoCamera(true); setErr('Crewhouse needs the camera to read the code.'); }
  };
  const typed = async () => {
    setBusy(true);
    setErr('');
    try { setDone(await (readLink(code) ? pairLink(code, setWords) : pairTypedCode(code, setWords))); } catch (e: any) { setErr(pairWords(e)); }
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
    try { setDone(await pairLink(text, setWords)); } catch (e: any) { seen.current = ''; setErr(pairWords(e)); }
    setWords('');
    setBusy(false);
  };
  // A tapped pairing link (the page `./crewhouse link` prints, or an emulator's `adb shell am start -d "crewhouse://pair?code=<QR text>"`)
  // pairs through the same handler the camera uses, in every build. The address is spent once: it is cleared when read.
  const heard = Linking.useURL(), tapped = link ?? heard;
  useEffect(() => {
    if (!tapped || !/^crewhouse:\/\/pair\?code=/.test(tapped)) return;
    Linking.clearInitialURL();
    void tryCode(tapped);
  }, [tapped]);
  // The pairing success asks for the news permission once, but only where push can work: on a build with no
  // push credential nothing is asked and "You're in" carries no notification line at all.
  useEffect(() => { if (!done) return; void pushState(true).catch(() => {}); }, [!!done]);
  if (done) {
    return (
      <Center>
        <ChiefArt mood="happy" size={104} whole />
        <T style={s.display}>You're in</T>
        <T tone="ink2" style={s.centerText}>This phone is paired with your computer{done.device.role === 'view' ? '. It can watch the crew, not answer' : ''}.</T>
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
  // Pair this phone (J17b): scan, or type the code below it, on one screen. The keyboard takes half a small screen, so the
  // window shrinks to what's left and the form scrolls; the field and Pair stay reachable.
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <ScrollView contentContainerStyle={[s.screen, { gap: 12 }]} keyboardShouldPersistTaps="handled">
        {onBack && <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={[s.roundBack, { backgroundColor: t.soft }]}><T style={s.backChevron}>{'\u2039'}</T></Pressable>}
        <T style={[s.wide, { fontSize: 34, lineHeight: 38, marginTop: onBack ? 8 : 40 }]}>{paste ? 'Paste a link' : 'Pair this phone'}</T>
        <T tone="ink2">{paste ? 'On your computer, run ./crewhouse link, or open Add a phone in the app. Copy the link it shows and paste it here.' : 'On your computer open Settings, then Phones, then Add a phone. Scan its code, or type it here.'}</T>
        {!paste && <Btn ink tall label="Scan the code" onPress={openCamera} />}
        {!paste && noCamera && <Btn label="Open phone settings" onPress={() => void Linking.openSettings()} />}
        {!paste && <T style={[s.b, { marginTop: 8 }]}>Or type the code</T>}
        <TextInput style={[s.input, s.codeInput, { color: t.ink, borderColor: t.line, backgroundColor: t.solid }]} value={code} onChangeText={setCode} placeholder={paste ? 'Paste the link here' : 'Type or paste the code'} placeholderTextColor={t.mute}
          accessibilityLabel={paste ? 'Link' : 'Pairing code'} autoCapitalize={paste ? 'none' : 'characters'} autoCorrect={false} autoFocus={paste} />
        {busy ? <ActivityIndicator color={t.pink} style={{ margin: 12 }} /> : <Btn soft={!paste} go={paste} tall label={paste ? 'Join' : 'Pair'} disabled={!code.trim()} onPress={typed} />}
        {!!err && <T tone="pinkInk">{err}</T>}
        <T tone="mute" style={{ marginTop: 4 }}>{paste ? 'Turn Tailscale on, on this phone and on the computer. Your computer asks you to say yes when the phone joins.' : 'On the same Wi-Fi the 12-letter code works. Away from home, use the code with an @.'}</T>
        {onPut && <Btn ghost label="Crewhouse isn't on my computer yet" onPress={onPut} />}
        <T tone="mute" style={s.small}>{A.awake('your computer')}</T>
        <T tone="mute" style={s.small}>Only your computer can read what this phone sends. Anything passing it along can't read it.</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------- phone only: Chief on this phone, no computer ----------
/** The first screen with no computer paired (mock C): Chief asks where he should work. On my computer goes straight to
 *  pairing, since most people already have Crewhouse there and the computer shows the code; putting it on a computer
 *  that has none is the one link on that screen. Just on this phone the phone-only floor, In my cloud the cloud steps. */
function GetStarted({ onPhoneOnly, onPaired }: { onPhoneOnly: () => void; onPaired: (g: Grant) => void }) {
  const t = useLook();
  const [at, setAt] = useState<'where' | 'pair' | 'put' | 'cloud' | 'paste'>('where');
  // A tapped pairing link opens the app on pairing, whichever first screen it was on; Pair is told the address because it
  // only hears one that arrives while it is showing.
  const [tapped, setTapped] = useState<string | null>(null), heard = Linking.useURL();
  useEffect(() => { if (heard && /^crewhouse:\/\/pair\?code=/.test(heard)) { setTapped(heard); setAt('pair'); } }, [heard]);
  const back = at === 'where' ? null : () => { setTapped(null); setAt(at === 'put' ? 'pair' : 'where'); };
  useEffect(() => { if (!back) return; const sub = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; }); return () => sub.remove(); }, [at]);
  if (at === 'put') return <PutChief onCode={() => setAt('pair')} onBack={back!} />;
  if (at === 'pair' || at === 'paste') return <Pair onPaired={onPaired} onBack={back!} onPut={() => setAt('put')} paste={at === 'paste'} link={tapped} />;
  if (at === 'cloud') return <CloudConnect onBack={back!} onPair={() => setAt('pair')} onPaired={onPaired} />;
  const w = A.where(cloudOn);
  return (
    <ScrollView contentContainerStyle={[s.screen, { gap: 16, paddingTop: 48 }]}>
      <View style={[s.row, { alignItems: 'flex-start', gap: 16 }]}>
        <ChiefArt mood="hello" size={72} whole />
        <View style={{ flex: 1 }}><T style={s.b}>Chief</T><T style={s.title}>{w.hello}</T></View>
      </View>
      {!!w.line && <T tone="ink2">{w.line}</T>}
      {w.rows.map((r, i) => <Pressable key={r.key} accessibilityRole="button" accessibilityLabel={r.title}
        onPress={() => r.key === 'phone' ? onPhoneOnly() : setAt(r.key === 'cloud' ? 'cloud' : 'pair')}
        style={[s.card, s.row, { gap: 12, backgroundColor: t.card, borderColor: i ? t.line : t.go, borderWidth: i ? 1 : 2 }]}>
        <Image source={WHERE[r.key]} style={{ width: 28, height: 28, tintColor: t.ink }} />
        <View style={{ flex: 1, gap: 4 }}><T style={s.rowTitle}>{r.title}</T><T tone="mute" style={s.small}>{r.sub}</T></View><T tone="mute">›</T>
      </Pressable>)}
      <Btn ghost label="Paste a link" onPress={() => setAt('paste')} />
      <Note>{w.note}</Note><T tone="mute" style={[s.small, s.centerText]}>{w.later}</T>
    </ScrollView>
  );
}

/** On my computer with nothing there yet: the one line that puts Chief on a Linux computer, which prints a code that
 *  works once; Type the code opens Pair's box, and Back returns to it. */
function PutChief({ onCode, onBack }: { onCode: () => void; onBack: () => void }) {
  const t = useLook();
  const p = A.PUT;
  return (
    <ScrollView contentContainerStyle={[s.screen, { gap: 14 }]}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={[s.row, { height: 44 }]}>
        <T tone="ink2" style={{ fontSize: 22, width: 24 }}>‹</T><T tone="ink2" style={{ flex: 1 }}>{p.top}</T></Pressable>
      <View style={[s.row, { alignItems: 'flex-start' }]}><T style={[s.h1, { flex: 1 }]}>{p.title}</T>
        <Image source={WHERE[t.night ? 'chief-night' : 'chief-day']} style={{ width: 52, height: 48 }} accessibilityIgnoresInvertColors /></View>
      <View style={[s.card, { gap: 10, backgroundColor: t.card, borderWidth: 2, borderColor: t.go }]}>
        <T tone="ink2">{p.lead}</T>
        <Text selectable style={{ fontSize: 14, lineHeight: 20, color: t.ink, backgroundColor: t.bg, borderRadius: radius.card, padding: 12 }}>{p.line}</Text>
        <Btn label={p.send} onPress={() => void Share.share({ message: p.line })} />
        <T tone="ink2">{p.after}</T>
        <Btn go big label={p.code} onPress={onCode} />
      </View>
      <Note>{p.needs}</Note>
      <T tone="mute" style={s.small}>{p.app}</T>
    </ScrollView>
  );
}

/** The shield card under a choice: what Crewhouse never sees, and who bills you. */
function Note({ children }: { children: ReactNode }) {
  const t = useLook();
  return <View style={[s.row, { alignItems: 'flex-start', marginTop: 14, padding: 12, paddingHorizontal: 14, borderRadius: radius.card, backgroundColor: t.soft }]}>
    <Image source={WHERE.shield} style={{ width: 18, height: 18, marginTop: 1, tintColor: t.ink }} /><T tone="ink2" style={[s.small, { flex: 1, lineHeight: 19 }]}>{children}</T>
  </View>;
}
/** In my cloud (mock key-first): paste the boat.dev key, choose the computer (or see what a new one costs), then the
 *  kit's real setup steps tick the list. The kit calls are web/src/cloud.ts; the key stays on this phone (src/cloud.ts). */
function CloudConnect({ onBack, onPair, onPaired }: { onBack: () => void; onPair: () => void; onPaired: (g: Grant) => void }) {
  const t = useLook();
  const c = A.CLOUD;
  const [view, setView] = useState<'key' | 'pick' | 'make' | 'steps' | 'other'>('key');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [listed, setListed] = useState<MachineRef[]>([]);
  const [picked, setPicked] = useState('');
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [setupError, setSetupError] = useState('');
  const [moving, setMoving] = useState(false); // the move's confirm is on the card
  const [way, setWay] = useState(-1);
  const held = useRef(''); // the checked key, never on screen
  const press = useRef(''); // one rental per press: a repeated Make after a lost answer is the same request
  const [grant, setGrant] = useState<Grant | null>(null); // the computer's receipt, as this phone's link
  const check = async (k: string) => {
    if (!k.trim() || busy) return;
    setBusy(true); setErr('');
    try { setListed(await checkKey(boatOn(k.trim()), cloudStore, k.trim())); held.current = k.trim(); setView('pick'); }
    catch (e) { setErr(said(e)); } finally { setBusy(false); }
  };
  // One action with a key already kept: straight to the computers.
  useEffect(() => { void keptKey().then((k) => { if (k) void check(k); }); }, []);
  const run = async (ref: MachineRef, retry = false, move = false) => {
    setPicked(ref.id); setMoving(false);
    if (!retry) setSteps([]);
    else setSteps((x) => x.filter((step) => step.step !== 'failed'));
    setSetupError(''); setView('steps');
    try {
      for await (const step of setUpCloud(boatOn(held.current), cloudStore, ref, await phoneKeys(), lab, move)) {
        if (step.grant) setGrant(await keepGrant(step.grant));
        setSteps((x) => [...x.filter((current) => current.step !== step.step && current.step !== 'failed'), step]);
      }
    } catch (e) { setSetupError(said(e)); }
  };
  const create = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    press.current ||= `make-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { const ref = await makeComputer(boatOn(held.current), press.current); press.current = ''; setListed((x) => [...x, ref]); void run(ref); }
    catch (e) { setErr(said(e)); } finally { setBusy(false); }
  };
  const p = progress(steps, setupError), ready = steps.at(-1)?.step === 'ready';
  const box = (lead: boolean, body: ReactNode) => <View style={[s.card, { gap: 10, backgroundColor: t.card, borderWidth: lead ? 2 : 1, borderColor: lead ? t.go : t.line }]}>{body}</View>;
  const pill = (w: string) => <T style={[s.label2, { alignSelf: 'flex-start', color: t.go, backgroundColor: t.softAccent, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' }]}>{w}</T>;
  const problem = !!err && <View accessibilityLiveRegion="polite" style={[s.row, { alignItems: 'flex-start' }]} /* the failed step's "!" and colour, not link blue */>
    <Text style={[s.stepNum, { width: 24, height: 24, lineHeight: 24, backgroundColor: t.soft, color: t.danger }]}>!</Text><T style={{ flex: 1, color: t.danger }}>{err}</T></View>;
  const key = <>{pill(c.key.pill)}<T style={s.title}>{c.key.title}</T><T tone="ink2">{c.key.lead}</T>
    <T style={[s.small, s.b]}>{c.key.label}</T>
    <Pressable onPress={() => void Clipboard.getString().then(check)} disabled={busy} accessibilityRole="button" accessibilityLabel={c.key.paste}
      style={[s.input, { minHeight: 48, justifyContent: 'center', borderColor: t.line2, backgroundColor: t.bg }]} /* paste-only: nothing typed, the key never on screen */>
      <T tone="mute">{busy ? c.key.checking : c.key.paste}</T></Pressable>
    {problem || <T tone="mute" style={s.small}>{c.key.after}</T>}
    <Pressable onPress={() => setWay(way === 9 ? -1 : 9)} accessibilityRole="button" hitSlop={6}><T style={[s.small, s.b, { color: t.go }]}>{c.key.make}</T></Pressable>
    {way === 9 && <><T tone="ink2" style={s.small}>{c.key.how}</T><Btn label={c.key.open} onPress={() => void Linking.openURL(c.key.url)} /></>}
    <View style={{ backgroundColor: t.soft, borderRadius: radius.card, padding: 12 }}><T tone="ink2" style={s.small}>{c.kept.map((x, i) => i % 2 ? <Text key={i} style={s.b}>{x}</Text> : x)}</T></View></>;
  const pick = <>{pill(c.pick.pill)}<T style={s.title}>{c.pick.title}</T><T tone="ink2">{listed.length ? c.pick.lead : c.pick.none}</T>
    {listed.map((r, i) => <View key={r.id} style={{ gap: 6, borderWidth: 1, borderColor: t.line, borderRadius: radius.card, padding: 12, backgroundColor: t.bg }}>
      <T style={s.b}>{c.pick.name(i, listed.length)}</T><T tone="mute" style={s.small}>{c.pick.sub}</T><T tone="ink2" style={s.small}>{c.pick.setup}</T>
      <Btn go big label={c.pick.use} onPress={() => void run(r)} /></View>)}
    {!!listed.length && <T tone="mute" style={s.small}>{c.pick.bill}</T>}
    <Btn big label={c.pick.make} onPress={() => setView('make')} /></>;
  const make = <>{pill(c.make.pill)}<T style={s.title}>{c.make.title}</T><T>{c.make.lead}</T>
    <View style={{ gap: 4, borderWidth: 1, borderColor: t.line, borderRadius: radius.card, padding: 12 }}><T style={s.b}>{c.make.size}</T><T tone="ink2" style={s.small}>{cost()}</T><T tone="mute" style={s.small}>{c.make.check}</T></View>
    {problem}
    <Btn go big disabled={busy} label={busy ? c.make.making : c.make.create} onPress={() => void create()} /><Btn ghost label={c.make.back} onPress={() => setView('pick')} /></>;
  const pickedRef = () => listed.find((r) => r.id === picked)!;
  const progressList = moving ? <>{pill(c.steps.pill)}<T style={s.title}>{c.move.title}</T>{c.move.lines.map((l) => <T key={l} tone="ink2">{l}</T>)}
    <Btn go big label={c.move.yes} onPress={() => void run(pickedRef(), false, true)} /><Btn ghost label={c.move.back} onPress={() => setMoving(false)} /></> : ready ? <>{pill(c.ready.pill)}<T style={s.title}>{c.ready.title}</T>{c.ready.lines.map((l) => <T key={l} tone="ink2">{l}</T>)}
    {grant && <Btn go big label={c.ready.talk} onPress={() => onPaired(grant)} />}</> : <>
    {pill(c.steps.pill)}<T style={s.title}>{c.steps.title}</T>
    <View style={[s.row, { justifyContent: 'space-between' }]}><T tone="mute" style={[s.small, { flex: 1 }]}>{c.pick.name(listed.findIndex((r) => r.id === picked), listed.length)}</T><T style={[s.small, s.b]}>{p.why ? c.steps.help : c.steps.count(p.done)}</T></View>
    {c.steps.rows.map(([title, sub], i) => <View key={title} style={[s.row, { alignItems: 'flex-start', opacity: i > p.done && i !== p.failed ? 0.6 : 1 }]}>
      <Text style={[s.stepNum, { width: 24, height: 24, lineHeight: 24, backgroundColor: i < p.done ? t.softAccent : t.soft, color: i < p.done ? t.go : i === p.failed ? t.danger : t.mute }]}>{i < p.done ? '✓' : i === p.failed ? '!' : i + 1}</Text>
      <View style={{ flex: 1 }}><T style={s.b}>{title}</T><T tone="mute" style={s.small}>{sub}</T></View></View>)}
    {!p.why ? <T tone="mute" style={s.small}>{c.steps.note}</T> : <View accessibilityLiveRegion="polite" style={{ gap: 8 }}><T>{p.why}</T>
      {p.retry && <><T tone="mute" style={s.small}>{c.steps.again}</T><Btn go big label={c.steps.retry} onPress={() => void run(pickedRef(), true)} /></>}
      {p.move && <><Btn go big label={c.move.go} onPress={() => setMoving(true)} /><Btn ghost label={c.move.back} onPress={() => setView('pick')} /></>}</View>}</>;
  const other = <><T style={s.title}>{c.other.title}</T><T tone="ink2">{c.other.lead}</T>
    {c.other.ways.map(([title, sub, more], i) => <Pressable key={title} onPress={() => more ? setWay(way === i ? -1 : i) : onPair()} accessibilityRole="button" accessibilityLabel={title}
      style={{ gap: 4, borderWidth: 1, borderColor: t.line, borderRadius: radius.card, padding: 12 }}>
      <View style={s.row}><T style={[s.b, { flex: 1 }]}>{title}</T><T tone="mute">›</T></View><T tone="mute" style={s.small}>{sub}</T>
      {way === i && <T tone="ink2" style={s.small}>{more}</T>}</Pressable>)}
    <T tone="mute" style={s.small}>{c.other.foot}</T></>;
  const set = view === 'steps' && ready;
  const back = view === 'key' ? onBack : moving ? () => setMoving(false) : () => { setErr(''); setView(view === 'make' || view === 'steps' ? 'pick' : 'key'); };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <ScrollView contentContainerStyle={[s.screen, { gap: 14 }]} keyboardShouldPersistTaps="handled">
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={[s.row, { height: 44 }]}>
          <T tone="ink2" style={{ fontSize: 22, width: 24 }}>‹</T><T tone="ink2" style={{ flex: 1 }}>{c.top[0]}</T><T tone="mute" style={s.small}>{c.top[1]}</T></Pressable>
        <View style={[s.row, { alignItems: 'flex-start' }]}><T style={[s.h1, { flex: 1 }]}>{set ? c.ready.top : c.title}</T>
          <Image source={WHERE[t.night ? 'chief-night' : 'chief-day']} style={{ width: 52, height: 48 }} accessibilityIgnoresInvertColors /></View>
        {!set && <T tone="ink2">{c.lede}</T>}
        {box(view !== 'make' && view !== 'other', { key, pick, make, steps: progressList, other }[view])}
        {view === 'key' && <Btn ghost label={`${c.other.link} →`} onPress={() => setView('other')} />}
        {view === 'pick' && <Btn ghost label={c.pick.other} onPress={() => { held.current = ''; setView('key'); }} />}
        {view === 'other' && <Btn ghost label={c.other.back} onPress={() => setView('key')} />}
        <Note>{c.trust[0]}</Note>
        <T tone="mute" style={[s.small, s.centerText]}>{c.trust[1]}</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PhoneOnly({ onExit }: { onExit: () => void }) {
  const t = useLook();
  const [ready, setReady] = useState<boolean | null>(null);
  // Why the person is back at the connect card (a key refused, or a sign-in that lapsed): the words stay on the card.
  const [why, setWhy] = useState('');
  useEffect(() => { void phoneSignedIn().then(setReady).catch(() => setReady(false)); }, []);
  if (ready === null) return <Center><ActivityIndicator color={t.ink} /></Center>;
  if (!ready) return <PhoneSignIn why={why} onExit={onExit} onDone={() => setReady(true)} />;
  return <PhoneChat onExit={onExit} onSignedOut={(words) => { setWhy(words); setReady(false); }} />;
}

function PhoneHead({ subtitle, onExit, onSignOut }: { subtitle: string; onExit: () => void; onSignOut: () => void }) {
  const t = useLook();
  // When the screen is narrow for its text (a small phone, or a large font) the two controls no longer leave room for
  // "Chief" and the account's name, so they move to their own row below. At normal widths and fonts it stays one row.
  const { width, fontScale } = useWindowDimensions();
  const narrow = width / fontScale < 360;
  return (
    <View style={[s.head, { borderColor: t.line }, narrow && { flexWrap: 'wrap' }]}>
      <Face who="chief" size={32} />
      <View style={{ flex: 1, minWidth: 0 }}><T style={s.rowTitle} lines={1}>Chief</T><T tone="ink2" style={s.small}>{subtitle}</T></View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, ...(narrow && { width: '100%' }) }}>
        <Pressable onPress={onSignOut} accessibilityRole="button" accessibilityLabel="Sign out" hitSlop={8}><T tone="ink2" style={s.small}>Sign out</T></Pressable>
        <Pressable onPress={onExit} accessibilityRole="button" accessibilityLabel="Use a computer instead" hitSlop={8}><T tone="ink2" style={s.small}>Use a computer</T></Pressable>
      </View>
    </View>
  );
}

/** Connect the person's own account with an API key: pick OpenRouter or MiniMax, one paste, agreed per use, nothing
 *  else leaves the phone. A MiniMax key then picks its model from MiniMax's own list (the kit's when that cannot be read), as the computer's key sheet does. */
function PhoneSignIn({ onDone, onExit, why }: { onDone: () => void; onExit: () => void; why: string }) {
  const t = useLook();
  const [account, setAccount] = useState<PhoneKey>(PHONE_KEYS[0]);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(why);
  const [models, setModels] = useState<PhoneModel[] | null>(null);
  const [chosen, setChosen] = useState<PhoneModel | null>(null);
  const [find, setFind] = useState('');
  const name = account.name;
  const connect = async () => {
    if (!key.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      await phoneConnect(account, key); setKey('');
      const listed = await phoneModels().catch(() => []);
      if (listed.length) { setModels(listed); setBusy(false); } else onDone();
    } catch (e) { setErr(phoneSignInWords(e)); setBusy(false); }
  };
  const pick = (id: string) => { setBusy(true); void phonePick(id).then(onDone, () => { setErr('That model could not be kept. Try again.'); setBusy(false); }); };
  // The default is the recommended model (MiniMax's fast one), named on its button.
  const fallback = models?.find((m) => m.recommended) ?? models?.[0];
  // A long list keeps the room for itself: no portrait, a search box over it.
  const long = !!models && models.length > 6;
  if (models) return (
    <ScrollView contentContainerStyle={s.centerScroll}>
      {!long && <ChiefArt mood="hello" size={104} whole />}
      <T style={s.display}>Which model should Chief use?</T>
      <T tone="ink2" style={s.centerText}>Your {name} key is saved on this phone. Pick the model Chief thinks with.</T>
      {long && <TextInput style={[s.input, { alignSelf: 'stretch', color: t.ink, borderColor: t.line }]} value={find} onChangeText={setFind}
        placeholder={`Search ${models.length} models`} placeholderTextColor={t.mute} accessibilityLabel="Search models" autoCapitalize="none" autoCorrect={false} />}
      <View style={{ alignSelf: 'stretch', gap: 8 }} accessibilityRole="radiogroup">
        {models.filter((m) => m.name.toLowerCase().includes(find.trim().toLowerCase())).map((m) => { const on = m === chosen;
          return <Pressable key={m.id} onPress={() => { setChosen(m); setErr(''); }} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={m.name}
            style={[s.row, { gap: 12, padding: 12, borderRadius: radius.card, borderWidth: on ? 2 : 1, borderColor: on ? t.ink : t.line }]}>
            <View style={{ flex: 1, gap: 2 }}><T style={s.b}>{m.name}</T>{m.recommended && <T tone="ink2" style={s.small}>Recommended</T>}</View><T tone={on ? 'ink' : 'mute'}>{on ? '●' : '○'}</T>
          </Pressable>; })}
      </View>
      {!!err && <T tone="pinkInk" style={s.centerText}>{err}</T>}
      {busy ? <ActivityIndicator color={t.pink} style={{ margin: 20 }} />
        : <Btn go big label={chosen ? `Use ${chosen.name}` : 'Pick a model'} disabled={!chosen} onPress={() => pick(chosen!.id)} />}
      {!!fallback && <Btn ghost label={`Use the default for now: ${fallback.name}`} disabled={busy} onPress={() => pick(fallback.id)} />}
    </ScrollView>
  );
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <ScrollView contentContainerStyle={s.centerScroll} keyboardShouldPersistTaps="handled">
        <ChiefArt mood="hello" size={104} whole />
        <T style={s.display}>Chief on this phone</T>
        <T tone="ink2" style={s.centerText}>Connect your own {name} key. Chief runs right here — no computer, and the key never leaves this phone.</T>
        <View style={{ alignSelf: 'stretch', gap: 8 }} accessibilityRole="radiogroup">
          {PHONE_KEYS.map((k) => { const ai = A.AIS.find((a) => a.key === k.key)!, on = k === account;
            return <Pressable key={k.key} onPress={() => { setAccount(k); setErr(''); }} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={k.name}
              style={[s.row, { gap: 12, padding: 12, borderRadius: radius.card, borderWidth: on ? 2 : 1, borderColor: on ? t.ink : t.line }]}>
              <AiMark ai={ai} /><T style={[s.b, { flex: 1 }]}>{k.name}</T><T tone={on ? 'ink' : 'mute'}>{on ? '●' : '○'}</T>
            </Pressable>; })}
        </View>
        <View style={{ alignSelf: 'stretch', gap: 4 }}>
          <Link label={`Get a ${name} key`} onPress={() => void Linking.openURL(account.url)} />
          <T tone="ink2" style={s.small}>1. Make an account.</T>
          <T tone="ink2" style={s.small}>2. Add a little credit.</T>
          <T tone="ink2" style={s.small}>3. Create a key and copy it here.</T>
        </View>
        <TextInput style={[s.input, { alignSelf: 'stretch', color: t.ink, borderColor: t.line }]} value={key} onChangeText={setKey}
          placeholder={`Paste your ${name} key`} placeholderTextColor={t.mute}
          accessibilityLabel={`${name} key`} autoCapitalize="none" autoCorrect={false} secureTextEntry />
        {busy ? <ActivityIndicator color={t.pink} style={{ margin: 20 }} /> : <Btn go big label="Connect" disabled={!key.trim()} onPress={connect} />}
        {!!err && <T tone="pinkInk" style={s.centerText}>{err}</T>}
        <Btn ghost label="Use a computer instead" onPress={onExit} />
        <T tone="mute" style={[s.small, s.centerText, { marginTop: 12 }]}>Billed per use by {name}. Your key is kept on this phone.</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A finished document Chief made here: read it, or send it out with the share sheet. Nothing leaves until Share. */
function PhoneDocCard({ doc, onOpen, disabled }: { doc: PhoneDocument; onOpen: () => void; disabled?: boolean }) {
  const t = useLook();
  return <Card style={{ marginLeft: 70, gap: 8 }}>
    <View style={s.row}>
      <View style={[s.fileIc, { backgroundColor: t.solid, borderColor: t.line }]}><T tone="ink2" style={s.fileGlyph}>▤</T></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}><T style={[s.rowTitle, s.b]} lines={2}>{doc.name}</T><T tone="mute" style={s.small}>Document</T></View>
      <Btn label="Read" onPress={onOpen} />
    </View>
    <Btn go label="Share" disabled={disabled} onPress={() => void attempt(() => shareDocument(doc), 'Ready to share')} />
  </Card>;
}

function PhoneDocSheet({ doc, onClose, disabled }: { doc: PhoneDocument; onClose: () => void; disabled?: boolean }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  return <Modal visible transparent animationType={motion.sheet(reduce)} onRequestClose={onClose}>
    <Pressable style={s.scrim} onPress={onClose}>
      <Pressable style={[s.sheet, { backgroundColor: t.bg, maxHeight: '88%' }]} onPress={() => {}}>
        <View style={[s.row, { paddingBottom: 12, borderBottomWidth: 1, borderColor: t.line }]}>
          <View style={[s.fileIc, { backgroundColor: t.solid, borderColor: t.line }]}><T tone="ink2" style={s.fileGlyph}>▤</T></View>
          <T style={[s.h2, { flex: 1 }]} lines={2}>{doc.name}</T><Btn label="Close" onPress={onClose} />
        </View>
        <ScrollView style={{ flexShrink: 1 }}>{doc.parts.length ? <DocParts parts={doc.parts} /> : <T tone="mute">There is nothing in it to show yet.</T>}</ScrollView>
        <Btn go label="Share" disabled={disabled} onPress={() => void attempt(() => shareDocument(doc), 'Ready to share')} />
      </Pressable>
    </Pressable>
  </Modal>;
}

/** Chief's chat on this phone, streamed, with the one tool he has here: a document. The whole chat lives in
 *  app storage, so it is still there after the app is killed; a turn with no end comes back stopped, a
 *  document effect the phone was killed inside comes back "Interrupted. Retry?", and a message written with
 *  no connection waits as "Queued, not sent yet" until the phone hears the model again. */
function PhoneChat({ onExit, onSignedOut }: { onExit: () => void; onSignedOut: (why: string) => void }) {
  const t = useLook();
  const [lines, setLines] = useState<PhoneLine[]>(loadChat);
  const [partial, setPartial] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState('');
  const [open, setOpen] = useState<PhoneDocument | null>(null);
  const [offline, setOffline] = useState(true);
  const [heard, setHeard] = useState(() => heardAt());
  const scroll = useRef<ScrollView>(null);
  const ctrl = useRef<AbortController | null>(null);
  const tail = useRef(Promise.resolve());
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const reduce = motion.useReduceMotion();
  const beat = motion.useBeat(360, reduce);
  useEffect(() => { void phonePlan().then((p) => p && setPlan(p)); }, []);
  useEffect(() => () => ctrl.current?.abort(), []);
  // Leaving phone-only for good: remove the saved key, then flush the mode marker before the app can be killed,
  // so a relaunch opens the chooser. A key-removal failure says so and keeps the person on the chat.
  const signOut = async () => {
    try { await phoneSignOut(); }
    catch { say("Couldn't sign out. Please try again."); return; }
    await setPhoneMode(false).catch(() => {});
    onExit();
  };
  const confirmSignOut = () => Alert.alert('Sign out of Chief?', 'Your key will be removed from this phone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } },
  ]);

  const historyFor = (rid: string, text: string): ChatTurn[] => historyOf(linesRef.current, rid, text);

  /** Run one turn already written to the chat: a fresh send, a retry, or a queued message going out. */
  const askTurn = async (text: string, rid: string, fromQueue: boolean): Promise<boolean> => {
    setPartial(''); setBusy(true);
    ctrl.current = new AbortController();
    let doc: PhoneDocument | undefined;
    const clearQueued = (l: PhoneLine) => (l.rid === rid && l.queued ? { ...l, queued: false } : l);
    // A queued message going out is an ordinary turn from here: a kill now leaves it stopped, never resent.
    if (fromQueue) rememberUser(text, rid);
    try {
      const answer = await askPhone(historyFor(rid, text), { onText: setPartial, onDocument: (d) => { doc = d; } }, ctrl.current.signal, rid);
      markHeard(); setHeard(Date.now()); setOffline(false);
      rememberChief(answer, doc, rid);
      setLines((ls) => [...ls.map(clearQueued), { who: 'chief', text: answer, doc }]);
      return true;
    } catch (e) {
      if (ctrl.current.signal.aborted) return false;
      if (isOffline(e)) {
        setOffline(true);
        setLines((ls) => failOffOf(ls, rid, text));
        return false;
      }
      if (phoneExpired(e)) { onSignedOut(phoneWords(e)); return false; }
      const line = phoneWords(e);
      rememberChief(line, doc, rid);
      setLines((ls) => [...ls.map(clearQueued), { who: 'chief', text: line, doc }]);
      return true;
    } finally { setPartial(''); setBusy(false); ctrl.current = null; }
  };

  /** Send what waited for a connection, oldest first, once the phone hears the model again. */
  const flush = (): Promise<void> => {
    const run = tail.current.then(async () => {
      if (ctrl.current) return;
      await drainPending(pendingTurns(), (q) => askTurn(q.text, q.rid, true));
    });
    tail.current = run.catch(() => {});
    return run;
  };

  /** Every send is queued behind what waits, then the queue drains oldest first. */
  const send = async (text: string, rid?: string): Promise<boolean> => {
    const words = text.trim();
    if (!words || busy) return false;
    if (!rid && offline && !(await probeOnline())) {
      const id = queueTurn(words);
      setLines((ls) => [...ls, { who: 'you', text: words, rid: id, queued: true }]);
      return true;
    }
    if (rid) {
      queueTurn(words, rid);
      setLines((ls) => [...clearRetryOf(ls, rid), { who: 'you', text: words, rid, queued: true }]);
    } else {
      const id = queueTurn(words);
      setLines((ls) => [...ls, { who: 'you', text: words, rid: id, queued: true }]);
    }
    setOffline(false);
    await flush();
    if (!ctrl.current && pendingTurns().length) setOffline(true);
    return true;
  };

  const reconnect = async () => {
    const ok = await probeOnline();
    setOffline(!ok);
    if (ok) { setHeard(heardAt()); await flush(); }
  };
  useEffect(() => { void reconnect(); }, []);
  // While offline, listen for the connection coming back so a queued message goes without the person acting.
  useEffect(() => { if (!offline) return; const x = setInterval(() => void reconnect(), 15_000); return () => clearInterval(x); }, [offline]);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void reconnect(); }); return () => sub.remove(); }, []);

  const heardWords = (at: number) => {
    if (!at) return '';
    const m = Math.floor((Date.now() - at) / 60_000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const speaker = (w: string) => <T style={[s.small, s.b, { width: nameCol(), color: t.ink2 }]}>{w}</T>;
  // The newest answer reads in full, never folded; older long answers keep the fold.
  let newestLocal = -1;
  lines.forEach((l, i) => { if (l.who !== 'you' && !l.stopped && l.text) newestLocal = i; });
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <PhoneHead subtitle={plan || 'On this phone, no computer'} onExit={onExit} onSignOut={confirmSignOut} />
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {!lines.length && !partial && (
          <View style={s.intro}>
            <View style={[s.halo, { backgroundColor: t.soft }]}><ChiefArt mood="hello" size={72} /></View>
            <T style={s.introName}>Chief</T>
            <T tone="ink2" style={[s.centerText, { maxWidth: 300 }]}>Ask me anything. I can answer here, and make documents you can share.</T>
            <Btn label="Make a packing list" onPress={() => void send('Draft a one-page packing list for a 3-day trip as a document')} />
          </View>
        )}
        {lines.map((l, i) => l.who === 'you'
          ? <View key={i} style={s.line}><View style={turn()}>{speaker('You')}
            <View style={{ flex: 1, gap: 2 }}><T>{l.text}</T>{l.queued && <T tone="mute" style={s.small}>Queued, not sent yet</T>}</View></View></View>
          : l.stopped
            ? <View key={i} style={s.line} accessibilityLiveRegion="polite"><View style={turn()}>{speaker('Chief')}
              <View style={{ flex: 1, minWidth: 0, gap: 8 }}><T tone="ink2">{l.text}{retrySuffix(l) ? ' Retry?' : ''}</T>
                {l.retry != null && <Btn label={l.interrupted ? 'Retry' : 'Try again'} disabled={busy || offline} onPress={() => void send(l.retry!, l.retryRid)} />}</View>
            </View></View>
            : <View key={i} style={{ gap: 10 }}>
              {!!l.text && <View style={s.line}><View style={turn()}>{speaker('Chief')}<View style={{ flex: 1, minWidth: 0 }}><ChatText text={l.text} latest={i === newestLocal} /></View></View></View>}
              {l.doc && <PhoneDocCard doc={l.doc} disabled={offline} onOpen={() => setOpen(l.doc!)} />}
            </View>)}
        {busy && !partial && <View style={s.line} accessibilityLiveRegion="polite" accessibilityLabel="Chief is working"><View style={turn()}>{speaker('Chief')}
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', paddingTop: 6 }}>{[0, 1, 2].map((i) => <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink2, opacity: reduce ? 0.5 : (beat + i) % 3 === 0 ? 0.8 : 0.35 }} />)}</View>
        </View></View>}
        {!!partial && <View style={s.line} accessibilityLiveRegion="polite"><View style={turn()}>{speaker('Chief')}<T style={{ flex: 1 }}>{partial}<Text style={{ color: t.pink, opacity: reduce || beat % 2 === 0 ? 1 : 0 }}> ▍</Text></T></View></View>}
      </ScrollView>
      {/* Pinned above the composer, so it shows however long the chat is. */}
      {offline && <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: t.sunken }} accessibilityLiveRegion="polite">
        <T tone="ink2" style={s.small}>No connection. A message you send waits here and goes once you're back.{heard ? ` Last heard ${heardWords(heard)}.` : ''}</T>
      </View>}
      <View style={[s.dock, { backgroundColor: t.bg }]}><Composer placeholder="Ask Chief anything" onSend={(text) => send(text)} chat="phone-only" photos={false} /></View>
      {open && <PhoneDocSheet doc={open} disabled={offline} onClose={() => setOpen(null)} />}
    </KeyboardAvoidingView>
  );
}

/** Once a computer is paired, the chat kept from Chief on this phone can carry on with Chief there: one message with
 *  the whole chat in it. The phone copy goes only after the computer has stored it; a failure keeps it and says so.
 *  Not now hides the offer until the app opens again or pairs again. */
let notNow = false;
function ContinueOffer({ canAct, onMoved }: { canAct: boolean; onMoved: () => void }) {
  const t = useLook();
  const [move, setMove] = useState(() => (notNow ? null : chatToMove()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Out of touch it waits unseen, unless a move is under way or just failed: that outcome still shows.
  if (!move || (!canAct && !busy && !err)) return null;
  const go = async () => {
    setBusy(true); setErr('');
    try { await moveChatTo(() => api.moveChat(move.text, move.id)); setMove(null); onMoved(); }
    catch (e) { setErr(`${FRIENDLY[trouble(e)]} Your chat is still on this phone.`); setBusy(false); }
  };
  return <Card style={{ gap: 10, marginBottom: 8 }}>
    <T style={s.b}>Your chat from this phone</T>
    <T tone="ink2">Carry it on with Chief on your computer. It goes as one message; documents stay on this phone.</T>
    {!!err && <T tone="pinkInk" style={s.small}>{err}</T>}
    {busy ? <ActivityIndicator color={t.ink} accessibilityLabel="Moving your chat" style={{ alignSelf: 'flex-start' }} />
      : <View style={s.chips}><Btn go label="Continue on your computer" disabled={!canAct} onPress={() => void go()} /><Btn ghost label="Not now" onPress={() => { notNow = true; setMove(null); }} /></View>}
  </Card>;
}

// ---------- the app ----------
type Route = { view: 'home' | 'chief' | 'room' | 'crew' | 'helper' | 'things' | 'routines' | 'add' | 'phone' | 'computer'; id?: string; tab?: string; m?: number };
/** `offline`: the screens show what this phone kept, read-only, until the home computer answers again. */
type Ctx = { state: Json; tick: number; refresh: () => void; go: (r: Route, replace?: boolean) => void; back: () => void; canAct: boolean; offline: boolean; open: (c: A.Card) => void; writer?: boolean };

function Crewhouse({ grant, onRemoved, onRepaired, onPhoneOnly }: { grant: Grant; onRemoved: () => void; onRepaired: (g: Grant) => void; onPhoneOnly: () => void }) {
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
  // Repairing the pairing from the out-of-touch screen below: the kept grant stays until a new one succeeds.
  const [repair, setRepair] = useState(false);
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
    if (!out) {
      return (
        <Center>
          <ChiefArt mood="work" size={112} whole />
          <T tone="ink2" style={s.centerText}>Waking the crew…</T>
        </Center>
      );
    }
    // Out of touch with nothing kept to show: plain words and plain ways out, while the link keeps retrying by
    // itself. Pairing again reuses the scan/type flow and only replaces the kept grant once the new one succeeds;
    // backing out keeps retrying the old one. Nothing here names the machinery.
    if (repair) return <Pair onPaired={(g) => { setRepair(false); onRepaired(g); }} onBack={() => setRepair(false)} />;
    if (route.view === 'computer') return <ChiefComputer back={['Back', () => go({ view: 'home' }, true)]} onRestored={(g) => { link.current?.addUrl(g.urls[0]); onRepaired(g); }} />;
    return (
      <ScrollView contentContainerStyle={s.centerScroll}>
        <ChiefArt mood="work" size={112} whole />
        <T style={[s.h1, s.centerText]}>Can't reach the home computer</T>
        <T tone="ink2" style={s.centerText}>This phone is still paired with it, but it doesn't answer. It may be switched off, asleep, or gone. Trying again by itself.</T>
        <Btn go big label="Pair again" onPress={() => setRepair(true)} />
        <Btn label="Try again" onPress={() => link.current?.retry()} />
        {cloudOn && <Btn label="Chief's computer" onPress={() => go({ view: 'computer' })} />}
        <Btn ghost label="Just on this phone" onPress={onPhoneOnly} />
      </ScrollView>
    );
  }
  const offline = status !== 'online';
  const canAct = grant.device.role === 'control' && !offline;
  const ctx: Ctx = { state, tick, refresh, go, back: () => { back(); }, canAct, offline, open: (c) => (c.kind === 'unlock' ? go({ view: 'chief' }) : setSheet(c)), writer: grant.device.role === 'control' };
  const shared = hasShareIntent && canAct && state.person.onboarded
    ? { text: [shareIntent.text, shareIntent.webUrl].filter((x, i, a) => x && a.indexOf(x) === i).join('\n'), files: (shareIntent.files ?? []).map((f) => ({ path: f.path, mimeType: f.mimeType })) } : null;
  if (shared) return <ShareIn state={state} shared={shared} go={go} onDone={() => resetShareIntent()} />;
  if (picked !== null && canAct && state.person.onboarded) return <ShareIn state={state} shared={{ text: picked, files: [] }} go={go} onDone={() => setPicked(null)} />;
  if (!state.person.onboarded && canAct && route.view === 'home') return <Land {...ctx} />;
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
        {route.view === 'phone' && <ThisPhone state={state} grant={grant} status={status} person={state.person} writer={canAct} refresh={refresh} go={go} back={toHome} onForget={forget} onClear={() => { kept.clear(); say('Cleared from this phone ✓'); }} />}
        {route.view === 'computer' && <ChiefComputer back={['Settings', back]} onRestored={(g) => { link.current?.addUrl(g.urls[0]); onRepaired(g); }} />}
      </View>
      <Tabs place={placeOf(route)} go={go} state={state} offline={offline} />
      {live && <AskSheet c={live} who={A.crew(state).find((h) => h.id === live.helper)} chiefSays={state.asks.find((a: Json) => a.id === live.id)?.detail?.chief} canAct={canAct} onClose={() => { setSheet(null); refresh(); }} />}
    </KeyboardAvoidingView>
  );
}

// ---------- tabs ----------
/** The phone's tab bar, as the computer's (web/src/main.tsx PLACES, styles.css .tabs): Home, Chief, Crew. */
const PLACES: [Route['view'], string, number][] = [['home', 'Home', WHERE['tab-home']], ['chief', 'Chief', WHERE['tab-talk']], ['crew', 'Crew', WHERE['tab-crew']]];
/** Which place a screen belongs to, so its tab reads as the one you are in: a helper's chat with Chief is Chief's, the
 *  other helpers and the crew's rooms are Crew's. A screen off the bar matches no place and lights none. */
const placeOf = (r: Route): Route['view'] => r.view === 'helper' ? (r.id === 'chief' ? 'chief' : 'crew') : r.view === 'room' || r.view === 'add' ? 'crew' : r.view;

/** The bar under every paired screen. Tapping a place opens it fresh (replace, as the web's links do); Chief wears the
 *  count of asks in the colour of a bunny-coloured pill. */
function Tabs({ place, go, state, offline }: { place: Route['view']; go: (r: Route, replace?: boolean) => void; state: Json; offline: boolean }) {
  const t = useLook();
  const asks = useOffice(state, offline, OUT).counts.needs;
  // The keyboard's own space: while it is up the bar steps aside, so the message box and its send sit right on it.
  const [typing, setTyping] = useState(Keyboard.isVisible());
  useEffect(() => {
    const on = Keyboard.addListener('keyboardDidShow', () => setTyping(true)), off = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => { on.remove(); off.remove(); };
  }, []);
  if (typing) return null;
  return (
    <View accessibilityRole="tablist" style={[s.tabs, { backgroundColor: t.bg, borderTopColor: t.line }]}>
      {PLACES.map(([view, label, icon]) => {
        const on = place === view;
        return (
          <Pressable key={view} onPress={() => go({ view }, true)} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} style={s.tab}>
            <View style={[s.tabIc, on && { backgroundColor: t.soft }]}><Image source={icon} style={{ width: 22, height: 22, tintColor: on ? t.ink : t.mute }} /></View>
            <Text style={[s.tabLabel, { color: on ? t.ink : t.mute }]}>{label}</Text>
            {view === 'chief' && asks > 0 && <Text style={[s.tabBadge, { backgroundColor: art.colourOf('bunny') }]}>{asks}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- first run ----------
/** First run has no screen of its own: Chief's chat opens, asks the name there and pitches (ChiefPage's `FirstTry`). */
function Land({ go }: Ctx) {
  useEffect(() => { go({ view: 'chief' }, true); }, []);
  return null;
}

// ---------- asks ----------
const answer = (c: A.Card, body: Json) => c.mailSend ? api.answer(c.id, body).then(() => { say(body.answer === 'deny' ? 'Nothing sent.' : body.answer === 'dismiss' ? 'OK.' : 'Sent from your Gmail.'); return true; }, e => { say(e.message); return false; }) : attempt(() => api.answer(c.id, body), c.rule ? (body.answer === 'deny' ? 'Cancelled. Your rules have not changed.' : 'Saved in Custom rules.') : body.change ? 'Chief will change the plan' : body.answer === 'deny' ? 'OK, not now' : 'Done. Carrying on.');

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
    return at > 0 ? <View key={i} style={{ gap: 2 }}><T tone="mute" style={s.label2}>{l.slice(0, at)}</T><T style={{ ...fw('500') }}>{l.slice(at + 2)}</T></View>
      : <T key={i}>{l}</T>;
  })}</View>;
  if (c.evidence === 'draft') {
    return <View style={[s.ev, { backgroundColor: t.sunken }]}>
      {!!c.mailFrom && <T tone="mute" style={s.small}>From {c.mailFrom}</T>}
      {!!c.draftTo && <T tone="mute" style={s.small}>To {c.draftTo}</T>}
      {!!c.draftSubject && <T style={{ ...fw('500') }}>Subject: {c.draftSubject}</T>}
      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled><T tone="ink2">{body}</T></ScrollView>
    </View>;
  }
  if ((c as any).hire) { const h = (c as any).hire;
    return <View style={[s.ev, { backgroundColor: t.sunken, gap: 8 }]}>
      {!!h.will_do?.length && <><T tone="mute" style={s.label2}>WILL DO</T>{h.will_do.map((l: string, i: number) => <View key={`w${i}`} style={{ flexDirection: 'row', gap: 8 }}><T tone="green">•</T><T tone="ink2" style={{ flex: 1 }}>{l}</T></View>)}</>}
      {!!h.wont_do?.length && <><T tone="mute" style={s.label2}>WON'T DO</T>{h.wont_do.map((l: string, i: number) => <View key={`n${i}`} style={{ flexDirection: 'row', gap: 8 }}><T tone="ink2">—</T><T tone="ink2" style={{ flex: 1 }}>{l}</T></View>)}</>}
      {!!h.first_step && <><T tone="mute" style={s.label2}>FIRST STEP FOR YOU</T><View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}><View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.ink, alignItems: 'center', justifyContent: 'center' }}><T style={{ color: t.solid, fontSize: 13 }}>1</T></View><T tone="ink2" style={{ flex: 1 }}>{h.first_step}</T></View></>}
      {!!h.first_job && <><T tone="mute" style={s.label2}>FIRST JOB</T><T tone="ink2">{h.first_job}</T></>}
      <T tone="mute" style={s.small}>Nothing changes until you say yes.</T>
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

/** The ask inline in the thread: the name, the status flag with the dot, then the words. No face, no clock —
 *  except a hire, which wears the new helper's own face and role line (mock 1) until the person says yes. */
function AskHead({ c, who }: { c: A.Card; who: A.Helper | undefined }) {
  const t = useLook();
  const name = c.helper === 'chief' ? 'Chief' : who?.name ?? c.head;
  const hire = c.hire;
  if (hire) return <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
    <Face who={{ kind: hire.kind, name: hire.name }} size={48} />
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <T style={{ ...fw('600'), color: t.pinkInk }}>{c.words}</T>
      {!!hire.role ? <T tone="ink2" style={s.small}>{hire.role}</T>
        : <View style={s.askStatus}><View style={[s.statusDot, { backgroundColor: t.pink }]} /><T tone="ink2" style={s.small}>{c.status}</T></View>}
    </View>
  </View>;
  return <View style={{ gap: 2 }}>
    <T style={{ ...fw('600'), color: t.pinkInk }}>{name}</T>
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
/** A helper offer is a Stack card in the new helper's colour (web/src/parts.tsx AskCard, `stack-ask`): ink on colour, in light and night. */
function HireCard({ c, yes, deny, act, oops }: { c: A.Card; yes?: A.Card['choices'][number]; deny?: A.Card['choices'][number]; act: (body: Json) => void; oops: boolean }) {
  const h = c.hire!, sect = (w: string) => <Text style={[s.read, s.b, { color: INK, opacity: 0.7, letterSpacing: 1 }]}>{w}</Text>;
  const list = (ls: string[], no = false) => ls.map((l, i) => <View key={`${no}${i}`} style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
    <View style={[s.tick, { borderColor: INK, backgroundColor: no ? 'transparent' : INK }]}>{!no && <Text style={{ color: '#fff', fontSize: 12, lineHeight: 14, ...fw('900') }}>✓</Text>}</View>
    <Text style={[s.read, s.b, { flex: 1, color: INK }]}>{l}</Text></View>);
  const btn = (x: NonNullable<typeof yes>, go: boolean) => <Pressable key={x.label} onPress={() => act(x.body)} accessibilityRole="button" accessibilityLabel={x.label}
    style={({ pressed }) => [s.liveBtn, { paddingHorizontal: 20, flexGrow: go ? 1 : 0, backgroundColor: go ? INK : 'rgba(0,0,0,0.1)' }, pressed && { opacity: 0.8 }]}>
    <Text style={[s.read, { color: go ? '#fff' : INK, ...fw('700') }]}>{x.label}</Text></Pressable>;
  return <View style={[s.live, { flex: 0, width: '100%', gap: 16, padding: 20, borderRadius: 30, backgroundColor: art.colourOf(h.kind) }]}>
    <View style={[s.row, { gap: 12 }]}>
      <Face who={{ kind: h.kind, name: h.name }} size={64} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={{ fontSize: 26, lineHeight: 28, color: INK, ...fw('800') }}>{h.name}</Text>
        {!!h.role && <Text style={[s.read, s.b, { color: INK }]}>{h.role}</Text>}
      </View>
    </View>
    {!!h.first_job && <View style={{ gap: 6 }}>{sect('FIRST JOB')}<Text style={{ fontSize: 18, lineHeight: 24, color: INK, ...fw('700') }}>{h.first_job}</Text></View>}
    {!!h.will_do?.length && <View style={{ gap: 6 }}>{sect('WILL DO')}{list(h.will_do)}</View>}
    {!!h.wont_do?.length && <View style={{ gap: 6 }}>{sect("WON'T DO")}{list(h.wont_do, true)}</View>}
    {!!h.first_step && <View style={{ gap: 6 }}>{sect('FIRST STEP FOR YOU')}<Text style={[s.read, { color: INK }]}>{h.first_step}</Text></View>}
    <Text style={[s.read, { color: INK }]}>Nothing changes until you say yes.</Text>
    {oops && <Text style={[s.read, s.b, { color: INK }]}>That didn't go through. Try again.</Text>}
    <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>{yes && btn(yes, true)}{deny && btn(deny, false)}</View>
  </View>;
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
  if (c.hire && canAct && !offline) return <HireCard c={c} yes={yes} deny={deny} act={act} oops={oops} />;
  return (
    <View style={[s.askInline, { borderTopColor: t.line2 }]}>
      <AskHead c={c} who={who} />
      {!c.hire && <T style={s.askWords}>{question}</T>}
      {edit.box || (c.kind === 'routine' && c.lines ? <View style={{ gap: 4, marginTop: 8 }}>{c.lines.map((l: string, i: number) =>
        <T key={i} tone={i ? 'mute' : 'ink2'} style={i ? s.small : { fontSize: 15, lineHeight: 24 }}>{l}</T>)}</View>
        : <AskEvidence c={c} open={!!c.rule} readAll={<Link label="Read all" onPress={() => open(c)} />} />)}
      {c.mailTo && <MailSetup c={c} canAct={canAct && !offline} done={onDone} />}
      {oops && <T tone="pinkInk" style={s.small}>{c.mailSend ? 'Sending was not confirmed. Check Gmail before doing anything else.' : "That didn't go through. Try again."}</T>}
      {offline ? <T tone="mute" style={s.small}>You can answer once the home computer is back.</T>
        : !canAct ? <T tone="mute" style={s.small}>This phone watches; answer on another phone or the computer.</T> : c.kind === 'signin' || c.kind === 'unlock' ? (
        <View style={{ gap: 8 }}>
          <T tone="mute" style={s.small}>{c.kind === 'unlock' ? 'Type the passwords' : 'Sign in'} from the computer or the web app: it's waiting in Chief's chat there.</T>
          <Btn label="Not now" onPress={() => act({ answer: 'deny' })} />
        </View>
      ) : c.kind === 'connect' ? (
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
            {!!c.schedule && <Btn label={when === null ? 'Change time' : 'Keep the time'} onPress={() => setWhen(when === null ? c.schedule || '' : null)} />}
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

/** What an answered card leaves in the thread: one small muted line (web/src/parts.tsx AnsweredCard). An approval
 *  outcome instead reads as one muted row, the action in plain words left and the outcome word right. */
function AnsweredRow({ line, what, word, rule }: { line?: string; what?: string; word?: string; rule?: string }) {
  const t = useLook();
  if (rule) return <Card><T style={s.semi}>Custom rule · {word}</T><T>{rule}</T><T tone="ink2">{line}</T></Card>;
  if (word !== undefined) return <View style={{ paddingLeft: 70, marginTop: -2 }}>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, backgroundColor: t.night ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 }}>
      <T tone="mute" lines={1} style={[s.small, { flex: 1, minWidth: 0 }]}>{what}</T>
      <T tone="mute" style={s.small}>{word}</T>
    </View>
  </View>;
  return <T tone="mute" style={[s.small, { paddingLeft: 70, marginTop: -2 }]}>{line}</T>;
}

/** The approval moment, mirroring web/src/parts.tsx AskSheet (§4.4): who, the status, exactly what goes out, and
 *  the choices — full-width buttons, the primary above its way out; a checkout reviews the whole order here, and an
 *  order without a readable total offers no yes at all. */
function AskSheet({ c, who, chiefSays, canAct, onClose }: { c: A.Card; who: A.Helper | undefined; chiefSays?: string; canAct: boolean; onClose: () => void }) {
  const t = useLook();
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
          {!c.hire && <T style={s.askQ}>{question}</T>}
          {/* The exact text that goes out, whole: never cut to a preview here. */}
          {edit.box || <AskEvidence c={c} open />}
          {c.mailTo && <MailSetup c={c} canAct={canAct} done={onClose} />}
          {c.review && c.order && !c.order.known && <T tone="mute" style={s.small}>So nothing is counted against the monthly limit.</T>}
          {!!chiefSays && <View style={s.row}><Face who="chief" size={20} /><T tone="ink2" style={{ flex: 1 }}><Text style={s.b}>Chief:</Text> {A.plain(chiefSays)}</T></View>}
          {oops && <T tone="pinkInk" style={s.small}>{c.mailSend ? 'Sending was not confirmed. Check Gmail before doing anything else.' : "That didn't go through. Try again."}</T>}
          {canAct ? <>
            {c.evidence === 'draft' && yes && <Btn go big label={yes.label} disabled={edit.empty} onPress={() => act(edit.yes(yes.body))} />}
            {edit.can && <Link label={edit.editing ? 'Use the original' : 'Edit'} onPress={edit.toggle} />}
            {rest.map((x) => <Btn key={x.label} big label={x.label} onPress={() => act(x.body)} />)}
            {c.evidence !== 'draft' && yes && <Btn go big label={yes.label} disabled={edit.empty} onPress={() => act(edit.yes(yes.body))} />}
          </> : <Btn big label="Close" onPress={onClose} />}
          {always && canAct && <Link label={always.label} onPress={() => act(always.body)} />}
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
const INK = '#0B0B0B'; // the Stack's ink on a colour card or tile, light or dark
/** "Morning, Umer." — Home's greeting and Chief's empty thread. */
const hello = (person: Json) => { const name = A.displayName(person); return `${A.greeting().replace(/^Good (.)/, (_, c: string) => c.toUpperCase())}${name ? `, ${name}.` : '.'}`; };

/** The gear: the way to Settings, and to the rest of the app from there (B1 has no tab bar). */
function Gear({ go }: { go: Ctx['go'] }) {
  const t = useLook();
  return <Pressable onPress={() => go({ view: 'phone' })} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={4} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}><T tone="ink2" style={{ fontSize: 22, lineHeight: 26 }}>{'⚙'}</T></Pressable>;
}

/** Chief's thread's header (J03, web/src/main.tsx ChiefHead): back to Home, his face and name, what he does — or, while
 *  the computer is out of reach, that wait — and the gear. */
function ChiefHead({ gear, offline }: { gear: ReactNode; offline: boolean }) {
  const t = useLook();
  return (
    <View accessibilityLabel="Chief" style={[s.row, { gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 1, borderColor: t.line }]}>
      <Face who="chief" size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.wide, { fontSize: 28, lineHeight: 32, color: t.ink }]}>Chief</Text>
        <T tone={offline ? 'pinkInk' : 'mute'} style={[s.read, offline && s.b]}>{offline ? OUT : 'Hands out the jobs'}</T>
      </View>
      {gear}
    </View>
  );
}

/** Home is the crew view (Stack, web/src/main.tsx Home): the greeting, then Chief's card — his latest line, what he has
 *  for you, his box — the one way to his asks, then every crew member as a card in their own colour, in the office's
 *  order, saying what they are on. Crew never ask the person: a waiting card says "Waiting for Chief". A card opens
 *  that helper's desk; Chief's card opens his thread. */
function Home(ctx: Ctx) {
  const t = useLook();
  const { state, go, refresh, canAct, offline } = ctx;
  const view = useOffice(state, offline, OUT);
  const toChief = async (x: string, p: Photo[] = [], d: Doc[] = []) => { const ok = await attempt(() => api.post('chief', x, p.map(({ type, data }) => ({ type, data })), undefined, d.map(({ name, type, data }) => ({ name, type, data }))), undefined, true); if (ok) { refresh(); go({ view: 'chief' }); } return ok; };
  const [desk, setDesk] = useState<{ c: A.OfficeMember; state: Json } | null>(null);
  const jobs = new Map(A.work(state).map((w) => [w.helper, w]));
  const n = view.counts.needs, chats = A.chats(state);
  const mine = useSignedIn(ctx.tick), ais = mine?.map((r) => r.ai) ?? [];
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={[s.row, { alignItems: 'flex-start', paddingTop: 8 }]}>
          <T style={[s.wide, { flex: 1 }]}>{hello(state.person)}</T>
          <Gear go={go} />
        </View>
        {!!A.resting(state) && <Card><T>{A.resting(state)}. I'll pick things back up then.</T></Card>}
        <View style={[s.stChief, { backgroundColor: t.solid, borderColor: t.line }]}>
          <Pressable onPress={() => go({ view: 'chief' })} accessibilityRole="button" accessibilityLabel={n ? A.chiefHas(view) : 'Chief'} style={({ pressed }) => [s.row, { gap: 14 }, pressed && { opacity: 0.6 }]}>
            <Face who="chief" size={64} mood={view.chief.mood} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <T style={[s.semi, { fontSize: 22, lineHeight: 26 }]}>{n ? A.chiefHas(view) : 'Chief'}</T>
              {!n && <T style={[s.read, s.b]}>{offline ? OUT : A.chiefStatus(view).word}</T>}
              {(n ? !!view.needs[0] : chats[0].at > 0) && <T tone="mute" style={s.read}>{n ? view.needs[0].head : chats[0].line}</T>}
            </View>
          </Pressable>
          {(canAct || ctx.writer) && <Composer placeholder="Ask Chief anything" onSend={toChief} chat="chief" docs away={offline} />}
        </View>
        <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 14, marginHorizontal: 4, rowGap: 4 }]}>
          <T tone="mute" style={s.stLabel}>Your crew</T><T tone="mute" style={s.read}>{A.summaryOf(view)}</T>
        </View>
        {A.roster(view.crew).map((c) => <CrewCard key={c.id} c={c} view={view} job={jobs.get(c.id)} offline={offline} onPress={() => setDesk({ c, state })} />)}
        {canAct && <Pressable onPress={() => go({ view: 'add' })} accessibilityRole="button" style={({ pressed }) => [s.stCard, { borderWidth: 2, borderStyle: 'dashed', borderColor: t.line2 }, pressed && { opacity: 0.6 }]}>
          <T style={{ fontSize: 30, lineHeight: 34, marginHorizontal: 12 }}>+</T>
          <View style={{ flex: 1, gap: 2 }}><T style={s.semi}>Add a helper</T><T tone="mute" style={s.read}>Or tell Chief who you need</T></View>
        </Pressable>}
        {view.crew.length > 0 && <Pressable onPress={() => go({ view: 'room' })} accessibilityRole="button" style={({ pressed }) => [s.stCard, { backgroundColor: t.solid, borderWidth: 1, borderColor: t.line }, pressed && { opacity: 0.6 }]}>
          <View style={{ flex: 1, gap: 2 }}><T style={s.semi}>The crew</T><T tone="mute" style={s.read}>{chats[chats.length - 1].line}</T></View><T tone="mute">›</T>
        </Pressable>}
        <Pressable onPress={() => go({ view: 'phone' })} accessibilityRole="button" accessibilityLabel={ais.length ? `Your AI accounts: ${andJoin(ais.map((a) => a.name))}` : 'Check AI account sign-in on the home computer'} style={({ pressed }) => [s.listRow, s.listGroup, { backgroundColor: t.solid, borderColor: t.line }, pressed && { opacity: 0.6 }]}>
          {ais.length ? <AiMark ai={ais[0]} size={30} /> : <KeyMark size={30} />}
          <View style={{ flex: 1 }}><T style={s.rowTitle}>Your AI accounts</T><T tone="ink2" style={s.small}>{ais.length ? `${andJoin(ais.map((a) => a.name))} ${ais.length > 1 ? 'are' : 'is'} signed in on the home computer.` : 'You sign in on the home computer, in Settings.'}</T></View><T tone="mute">›</T>
        </Pressable>
        <JobList state={state} go={go} refresh={refresh} />
        <Versions state={state} hint={false} />
      </ScrollView>
      {!!desk && <DeskSheet desk={desk} {...ctx} onClose={() => setDesk(null)} />}
    </View>
  );
}

/** One crew member on Home, a card in their own colour (web/src/main.tsx CrewCard): their face, the one status every
 *  screen reads (glowOf), what they are on and one meta line. */
function CrewCard({ c, view, job, offline, onPress }: { c: A.OfficeMember; view: A.OfficeView; job?: A.Work; offline: boolean; onPress: () => void }) {
  const word = offline ? OUT : glowOf(c, view).word, { line, meta: meta0 } = A.cardLines(c, view, job), meta = offline ? '' : meta0;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${c.name}: ${word}`} style={({ pressed }) => [s.stCard, { backgroundColor: art.colourOf(c.kind) }, pressed && { opacity: 0.8 }]}>
    <Face who={{ kind: c.kind, name: c.name, mood: c.mood }} size={48} />
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><Text style={[s.semi, { color: INK, flexGrow: 1, flexShrink: 1 }]}>{c.name}</Text><Text style={s.stPill}>{word}</Text></View>
      {line !== word && <Text style={s.stSub}>{line}</Text>}{!!meta && <Text style={s.stSub}>{meta}</Text>}
    </View>
  </Pressable>;
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
          : <Pill tone={A.waitsOnYou(c) ? 'wait' : c.ring ? 'ok' : 'off'}>{A.statusOf(c, A.office(state)).word}</Pill>}</View>
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
            {canAct && <Btn label="Take control" onPress={() => void attempt(async () => { await api.takeOver(id); to({ view: 'helper', id, tab: 'screen' }); })} />}
          </View></View>}
        </ScrollView>
        {asking && c.ask && <AskSheet c={c.ask} who={h} chiefSays={state.asks.find((a: Json) => a.id === c.ask!.id)?.detail?.chief} canAct={canAct}
          onClose={() => { setAsking(false); refresh(); }} />}
      </Pressable>
    </Pressable>
  </Modal>;
}

// A transcript turn: the name in a column beside the words (60 at normal size); at large text the name
// goes above the words instead, so a reply keeps the screen's width.
const stacked = () => PixelRatio.getFontScale() >= 1.3;
const nameCol = () => stacked() ? undefined : Math.round(60 * PixelRatio.getFontScale());
const turn = () => stacked() ? { gap: 2 } : { flexDirection: 'row' as const, gap: 10 };

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
      <Face who={A.crew(state).find((h) => h.id === j.bot) ?? { kind: 'bunny', name: j.bot }} size={28} />
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
  const [pending, setPending] = useState<{ text: string; after: number; at: number; files?: boolean } | null>(null);
  // The reply streaming in, by its task: once the page holds that task's reply it is said, even when the link dropped
  // its last word or its finished line, so a reconnect never leaves a second copy standing under it.
  const [stream, setStream] = useState<{ task: number; text: string } | null>(null);
  const partial = stream && !(page?.messages ?? []).some((x: Json) => x.author === 'bot' && x.task_id === stream.task) ? stream.text : '';
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
    if (e.kind === 'reply.partial') setStream(/\bstub [\w-]+:/.test(e.data.text) ? null : { task: e.data.task, text: e.data.text });
    if (e.kind === 'message' && e.data?.author === 'bot') setStream(null);
  }), [id]);
  useEffect(() => { setHeard([]); setWriting(new Map()); pinned.current = true; lastY.current = 0; seen.current = 0; setNewBelow(false); }, [id]);
  // A search landing on an old line loads a window around it; once you send, the anchor goes and the thread reads to the end.
  const [around, setAround] = useState(m ?? 0);
  // Use the first live page, not the phone's cached unread count, and keep its boundary after read.
  const mark = useRef<number | null>(null);
  const load = useCallback((ar = around) => api.bot(id, ar || undefined).then((p) => { mark.current ??= A.newDivider(p, id); setPage(p); kept.chat(id, p); }).catch(() => {}), [id, around]);
  useEffect(() => { void load(); }, [load, tick]);
  const scroll = useRef<ScrollView>(null);
  // Whether the thread sits at its newest line: only then does growth follow the bottom (the web's rule). Reading up
  // lets go; lines landing below raise a New pill over the dock that jumps back down and pins again.
  const pinned = useRef(true), lastY = useRef(0), seen = useRef(0);
  const [newBelow, setNewBelow] = useState(false);
  const onScroll = (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const n = e.nativeEvent;
    pinned.current = n.contentSize.height - n.contentOffset.y - n.layoutMeasurement.height < 40 || (pinned.current && n.contentOffset.y >= lastY.current);
    lastY.current = n.contentOffset.y;
    if (pinned.current) { seen.current = n.contentSize.height; setNewBelow(false); }
  };
  const jump = () => {
    pinned.current = true; seen.current = 0; setNewBelow(false);
    scroll.current?.scrollToEnd({ animated: true });
  };
  const ys = useRef(new Map<number, number>()); // each line's y, for landing on the matched one
  const landed = useRef(0); // the anchor we already landed on: once per line, never again on every tick

  // A helper's thread is its own words: Chief's hand-off says nothing there, and keeps only the files he passed on.
  const lines = (hero ? A.trayNotes(state, A.lines(page, id, state)) : A.lines(page, id, state))
    .flatMap((l) => id === 'chief' || l.from !== 'chief' ? [l] : l.files.length ? [{ ...l, text: '', detail: undefined }] : []);
  const phoneOffer = id === 'chief' ? A.phoneOffer(page) : null;
  // The newest finished sheet or page in Chief's thread is a Done card until the person speaks again, opens it or says Later (web Chat).
  const [laterDone, setLaterDone] = useState<string[]>([]);
  const made = (f: A.FileView) => (f.kind === 'sheet' || f.kind === 'page') && !f.review && !A.sentFile(f);
  const doneLine = id === 'chief' ? lines.findLast((l) => l.from === 'me' || l.files.some(made)) : undefined;
  const doneFile = doneLine?.from === 'me' ? undefined : doneLine?.files.find((f) => made(f) && !laterDone.includes(f.url));
  const doneBot = doneFile && A.fileSource(doneFile.url)?.bot;
  const doneBy = doneBot === 'chief' ? 'chief' as const : doneBot ? A.crew(state).find((x) => x.id === doneBot) : undefined;
  const fileCard = (l: { text: string }, f: A.FileView) => doneBy && f === doneFile ? <DoneCard key={f.url} f={f} who={doneBy} text={l.text || f.name} later={() => setLaterDone((v) => [...v, f.url])} />
    : f.size ? <FileRow key={f.url} f={f} /> : <Card key={f.url}><FileRow f={f} /></Card>;
  const echoed = pending && !(page?.messages ?? []).some((x: Json) => x.author === 'person' && x.id > pending.after && (A.plain(x.text) === A.plain(pending.text) || (!!pending.files && /\[file [a-z0-9-]+\] files\//.test(x.text))));
  const waiting = pending && !partial && !(page?.messages ?? []).some((x: Json) => x.author === 'bot' && x.id > pending.after);
  const crewNames = A.crew(state);
  // Chief's send is at work in every office header too, from the send until he answers (A.office's `sent`).
  const sentTo = waiting && pending ? pending.at : undefined;
  useEffect(() => { if (id !== 'chief') return; A.setChiefSend(sentTo); return () => A.setChiefSend(undefined); }, [id, sentTo]);
  const ln = page ? A.liveLine({ id, name: crewNames.find((x) => x.id === id)?.name ?? 'Chief', crew: crewNames, writing, heard,
    tasks: [...(page.tasks ?? []), ...(id === 'chief' ? state.tasks ?? [] : [])], events: [...(page.trail ?? []), ...(state.events ?? [])],
    sent: sentTo, side: 'phone' }) : null;
  const ticking = !!ln && ln.took === undefined && ln.state !== 'waiting';
  // The clock beside the step moves on each whole second of the job, so the thread never sits still.
  // A live line waiting on the person carries no clock and stays still.
  useEffect(() => {
    if (!ticking) return;
    const t = setTimeout(() => setNow(Date.now()), 1005 - ((Date.now() - ln!.since) % 1000));
    return () => clearTimeout(t);
  }, [ticking, ln?.since, now]);
  const stopChief = () => void attempt(async () => { await api.reset('chief'); refresh(); });
  const [seed, setSeed] = useState(0); // a starter chip fills the box from outside; remount reads the draft back
  const h = A.crew(state).find((x) => x.id === id);
  const b = state.bots.find((x: Json) => x.id === id);
  const trail = b?.task && page ? A.steps(page.trail ?? [], b.task.id, true) : [];
  const cards = A.cards(state).filter((c) => c.helper === id);
  const receipts = A.answeredReceipts(state).filter((r) => r.helper === id);
  const slots = A.cardSlots(lines, cards), receiptSlots = A.receiptSlots(lines, receipts);
  // Every thread reads as bubbles (J03), the speaker's face beside its lines; in Chief's, each job he handed a helper is
  // one chip after the turn that handed it on (A.handChips), and a helper's ended job already chipped is not said twice.
  const hands = id === 'chief' ? A.handChips(state, lines) : null;
  const chipped = !!ln?.task && (!!hands?.tail.some((c) => c.task === ln.task) || [...(hands?.before.values() ?? [])].some((cs) => cs.some((c) => c.task === ln.task)));
  // A quick end goes unsaid only when its reply is in the thread to say it.
  const replied = !!ln?.task && (page?.messages ?? []).some((x: Json) => x.task_id === ln.task && x.author === 'bot' && lines.some((l) => l.id === x.id));
  const quiet = ln?.state === 'working' && ln.heard !== undefined && Date.now() - ln.heard >= QUIET_MS;
  const [, leave] = useState(0);
  const stuck = A.stuckIn(crewNames, id).filter((x) => leftAlone.get(x.id) !== x.quietSince);
  const stuckProps = { go, refresh, canAct, leave: (x: A.Helper) => { leftAlone.set(x.id, x.quietSince); leave((n) => n + 1); } };
  const faceOf = (helper?: string) => { const x = crewNames.find((c) => c.id === helper); return x ? { kind: x.kind, name: x.name, mood: x.mood } : 'chief' as const; };
  const mine = (text: string) => <Theme.Provider value={{ ...t, ink: t.bg, soft: t.ink2 }}><View style={[s.mine, { backgroundColor: t.ink }]}><ChatText text={text} /></View></Theme.Provider>;
  const last = lines.at(-1);
  // The newest answer reads in full, never folded; the Add-a-phone card waits below Chief's first answer.
  const newestAnswer = [...lines].reverse().find((l) => (l.from === 'them' || l.from === 'chief') && (l.text || l.detail))?.id;
  const answered = newestAnswer !== undefined || !!partial;
  const name = h?.name ?? 'Chief';
  const [how, setHow] = useState(false); // the first-run "How does this work?" chip
  // A fresh chat shows starters: nothing yet, or only the hidden "X joined the crew" note from recruiting.
  const fresh = !lines.length || (lines.length === 1 && lines[0].from === 'note' && lines[0].text.startsWith(`${name} joined the crew`));
  // A helper's starters are its own ready rows only, never another helper's; Chief keeps every row.
  const own = id === 'chief' ? A.ideas(state) : A.ideas(state).filter((i: Json) => i.bot === id);
  // Seen: the chat's unread count goes once its newest line is on screen (a watch-only phone can't mark it).
  const newest = last?.id;
  useEffect(() => { if (canAct && mark.current !== null && newest && b?.unread) void api.read(id).then(refresh).catch(() => {}); }, [canAct, newest, b?.unread, id, refresh]);
  const send = async (x: string, p: Photo[] = [], d: Doc[] = []) => {
    // A send is the person's own hand reaching the newest line: re-pin so the echo and the live line show at once.
    pinned.current = true;
    setPending({ text: x || d.map((f) => f.name).join(', '), files: d.length > 0, after: page?.messages?.at(-1)?.id ?? 0, at: Date.now() });
    setStream(null);
    // The first words of a new install, if short, answer Chief's "What shall I call you?"; anything longer is already the first job.
    const named = id === 'chief' && !state.person.onboarded && !p.length && !d.length && A.asName(x);
    const ok = await attempt(() => named ? api.onboard(x, undefined, undefined, true) : api.post(id, x, p.map(({ type, data }) => ({ type, data })), undefined, d.map(({ name, type, data }) => ({ name, type, data }))), undefined, true);
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
  return (
    <View style={{ flex: 1 }}>
      {/* Home's hero and pinned ask stay in place over the thread (096); on a short screen they shrink and scroll alone. */}
      {hero && <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}>{hero}</ScrollView>}
      {/* The New pill floats inside the thread's own box, over its foot: a touch outside a parent's bounds never lands on Android. */}
      <View style={{ flex: 1, minHeight: hero ? 168 : undefined }}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, flexGrow: hero ? 1 : undefined, justifyContent: hero && !fresh ? 'flex-end' : undefined }}
        scrollEventThrottle={16} onScroll={onScroll}
        onContentSizeChange={(w, h) => {
          if (around || fresh) return; // An empty thread opens at its greeting, not its last idea.
          // Reading up: a line landing below raises the New pill instead of moving anything.
          if (!pinned.current) { if (h !== seen.current) setNewBelow(true); return; }
          seen.current = h; setNewBelow(false);
          // Android ignores a scroll in the same frame as the growth (the live page's new lines stayed below the fold).
          requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
        }}>
        {start && !hero && <View style={s.intro}>
          <View style={[s.halo, { backgroundColor: t.soft }]}><Ink who={h ? h.kind : 'chief'} mood={h?.mood} size={72} /></View>
          <T style={s.introName}>{name}</T><T tone="ink2" style={[s.centerText, { maxWidth: 300 }]}>{h ? h.role : 'Runs the crew and answers to you'}</T>
        </View>}
        {!page && <View style={{ gap: 12, paddingLeft: 36, paddingTop: 20 }} accessibilityLabel="Opening the chat">{['62%', '84%', '40%'].map((w) => <View key={w} style={[s.bar, { width: w as any, backgroundColor: t.soft }]} />)}</View>}
        {/* Chief's empty thread (J03b): his face, the greeting, and the starters; a tap fills the box, it never sends. */}
        {fresh && page && id === 'chief' && <View style={{ alignItems: 'center', gap: 12, paddingTop: 24 }}>
          <Face who="chief" size={96} />
          <Text style={[s.wide, s.centerText, { color: t.ink, fontSize: 28, lineHeight: 32, marginTop: 12 }]}>{hello(state.person)}</Text>
          <T tone="mute" style={[s.read, s.centerText]}>I can bring in Research Rae for research, Writer Will for writing or Video Vic for videos.</T>
          {canAct && own.map((i: Json) => <Pressable key={i.bot + i.label} onPress={() => { keepDraft(id, i.ask); setSeed((n) => n + 1); }} accessibilityRole="button"
            style={({ pressed }) => [s.row, { alignSelf: 'stretch', gap: 12, minHeight: 56, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 26, borderWidth: 1, borderColor: t.line, backgroundColor: t.solid }, pressed && { opacity: 0.6 }]}>
            <Text style={[s.semi, { flex: 1, color: t.ink }]}>{i.label}</Text><Text style={{ color: t.ink, fontSize: 28, lineHeight: 30 }}>+</Text>
          </Pressable>)}
        </View>}
        {fresh && page && id !== 'chief' && canAct && own.length > 0 && <View style={[s.chips, { justifyContent: 'center' }]}>
            {own.map((i: Json) => <Btn key={i.bot + i.label} label={`${art.STAR} ${i.label}`} onPress={() => { keepDraft(id, i.ask); setSeed((n) => n + 1); }} />)}
          </View>}
        {lines.map((l, i) => start && i === 0 && l.from === 'note' && l.text.startsWith(`${name} joined the crew`) ? null : <View key={l.id} style={{ gap: 10 }}>
          {(slots.before.get(i) ?? []).map((c) => <AskCard key={c.id} c={c} who={h} state={state} onDone={refresh} canAct={canAct} offline={offline} open={open} />)}
          {(receiptSlots.before.get(i) ?? []).map((r) => <AnsweredRow key={`a${r.id}`} line={r.line} what={r.what} word={r.word} rule={r.rule} />)}
          {(hands?.before.get(i) ?? []).map((c) => <HandOff key={`h${c.task}`} c={c} state={state} go={go} />)}
          {l.id === mark.current && <View style={s.newDivider} accessibilityRole="header"><View style={[s.newDividerLine, { backgroundColor: t.line }]} /><T style={[s.newDividerText, { color: t.pink }]}>New</T><View style={[s.newDividerLine, { backgroundColor: t.line }]} /></View>}
          {dayOf(l.at)}<motion.Rise reduce={reduce || l.id <= (opened.current ?? Infinity)}>
          <View onLayout={(e) => ys.current.set(l.id, e.nativeEvent.layout.y)} style={[s.line, { maxWidth: '100%' }]}>
            {l.from === 'note' ? <>
              {!!l.by && <View style={[s.row, { gap: 8 }]}><Face who={A.crew(state).find((x) => x.id === l.by) ?? 'chief'} size={20} /><T tone="ink2" style={[s.small, { flex: 1 }]}>{l.text}</T></View>}
              {!!l.text && !l.by && !(doneBy && l.id === doneLine?.id) && (l.event ? <T tone="mute" style={[s.small, { textAlign: 'center', paddingVertical: 10 }]}>{l.text}</T> : <ChatText text={l.text} />)}
              {/* A delivered or kept file is a note too: its words, then its card. */}
              {!l.text && !!l.about && <ChatText text={l.about} />}
              {l.files.map((f) => fileCard(l, f))}
            </> : l.from === 'me' ? <View style={{ gap: 6 }}>
              {!!l.text && mine(l.text)}
              {l.files.map((f) => fileCard(l, f))}
            </View> : <View style={[s.row, { alignItems: 'flex-end' }]}>
              <Face who={l.from === 'chief' ? 'chief' : faceOf(l.helper ?? id)} size={36} />
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                {!!l.by && <View style={[s.row, { gap: 8 }]}><Face who={A.crew(state).find((x) => x.id === l.by) ?? 'chief'} size={20} /><T tone="ink2" style={[s.small, { flex: 1 }]}>{l.text}</T></View>}
                {!!l.text && !l.by && !(doneBy && l.id === doneLine?.id) && <View style={[s.them, { backgroundColor: t.solid, borderColor: t.line }]}><ChatText text={l.text} latest={l.id === newestAnswer} /></View>}
                {!!l.retry && <Pressable onPress={() => void send(l.retry!)} accessibilityRole="button" hitSlop={8} style={[s.row, { gap: 8, alignSelf: 'flex-start' }]}>
                  <View style={[s.tick, { borderColor: t.mute, borderWidth: 1.5 }]}><T tone="mute" style={[s.small, s.b]}>!</T></View><T style={[s.read, s.b, { textDecorationLine: 'underline' }]}>Try again</T>
                </Pressable>}
                {l.files.map((f) => fileCard(l, f))}
                {!l.text && !!l.about && <ChatText text={l.about} />}
                {answered && phoneOffer?.message === l.id && <PhoneCard offer={phoneOffer} reload={() => void load()} />}
              </View>
            </View>}
          </View></motion.Rise></View>
        )}
        {echoed && <motion.Rise reduce={reduce}>{mine(pending.text)}</motion.Rise>}
        {!!partial && <View style={[s.row, { alignItems: 'flex-end' }]} accessibilityLiveRegion="polite"><Face who={faceOf(id)} size={36} />
          <View style={[s.them, { flexShrink: 1, backgroundColor: t.solid, borderColor: t.line }]}><T>{partial}<Text style={{ color: t.pink, opacity: reduce || beat % 2 === 0 ? 1 : 0 }}> ▍</Text></T></View></View>}
        {hands?.tail.map((c) => <HandOff key={`h${c.task}`} c={c} state={state} go={go} />)}
        {ln && <LiveCard ln={ln} who={crewNames.find((x) => x.id === ln.helper) ?? h} chief={id === 'chief'} quiet={quiet} chipped={chipped} replied={replied}
          stuck={ln.took === undefined ? stuck.find((x) => x.id === ln.helper) : undefined} {...stuckProps} />}
        {stuck.filter((x) => !ln || ln.took !== undefined || x.id !== ln.helper).map((x) => <JobCard key={`q${x.id}`} who={x} title={x.name} word={A.WORDS.needs} chief><Stuck h={x} ink={INK} {...stuckProps} /></JobCard>)}
        {canAct && id === 'chief' && A.firstChips(lines, state) && <View style={[s.chips, { justifyContent: 'center' }]}>
          {A.firstIdeas(state).map((i) => <Btn key={i.label} label={`${i.icon} ${i.label}`} onPress={() => send(i.label)} />)}
          <Btn label="How does this work?" onPress={() => setHow(!how)} />
          {how && <View style={[s.speech, { backgroundColor: t.solid, borderColor: t.line, alignSelf: 'stretch' }]}><ChatText text={A.howItWorks.map((l) => `- ${l}`).join('\n')} /></View>}
        </View>}
        {canAct && !!last?.choices.length && <View style={s.chips}>{last.choices.map((c) => <Btn key={c} label={c} onPress={() => send(c)} />)}</View>}
        {slots.tail.map((c) => <AskCard key={c.id} c={c} who={h} state={state} onDone={refresh} canAct={canAct} offline={offline} open={open} />)}
        {receiptSlots.tail.map((r) => <AnsweredRow key={`a${r.id}`} line={r.line} what={r.what} word={r.word} rule={r.rule} />)}
      </ScrollView>
      {newBelow && <Pressable onPress={jump} accessibilityRole="button" accessibilityLabel="Jump to the newest line" style={[s.newPill, { backgroundColor: t.bg, borderColor: t.line2 }]}><T style={s.newPillText}>↓ New</T></Pressable>}
      </View>
      {canAct || writer ? <View style={[s.dock, !!hero && { backgroundColor: t.bg }]}><Composer key={seed} placeholder={id === 'chief' ? 'Tell Chief anything…' : `Talk to ${name}`} onSend={send} chat={id} docs away={offline} thread={id === 'chief'} stop={id === 'chief' && (ln?.state === 'working' || ln?.state === 'reading') ? stopChief : undefined} /></View>
        : <T tone="mute" style={[s.small, { padding: 16 }]}>{offline ? "You can reply once the home computer is back." : "This phone watches the crew; it can't send messages."}</T>}
    </View>
  );
}

const LIVE_WORD: Record<A.LiveLine['state'], string> = { reading: A.WORDS.work, working: A.WORDS.work, needs: A.WORDS.needs, waiting: A.WORDS.wait,
  done: A.WORDS.done, failed: A.WORDS.failed, unsure: A.WORDS.unsure };
const QUIET_MS = 4000;
/** A job as a card in its helper's colour (J03, web/src/main.tsx LiveRow), with Chief's face beside it in his thread. */
function JobCard({ who, title, word, chief, children }: { who?: A.Helper; title: string; word: string; chief: boolean; children: ReactNode }) {
  const t = useLook(), ink = who ? INK : t.ink;
  return <View style={[s.row, { alignItems: 'flex-end', gap: 10 }]}>
    {chief && <Face who="chief" size={36} />}
    <View style={[s.live, who ? { backgroundColor: art.colourOf(who.kind) } : { backgroundColor: t.solid, borderWidth: 1, borderColor: t.line }]}>
      <View style={[s.row, { gap: 12 }]}>
        <Face who={who ? { kind: who.kind, name: who.name, mood: who.mood } : 'chief'} size={40} />
        <Text style={[s.semi, { flex: 1, fontSize: 20, lineHeight: 24, color: ink }]}>{title}</Text>
        <Text numberOfLines={1} style={[s.stPill, { flexShrink: 0 }, !who && { color: t.ink, backgroundColor: t.soft }]}>{word}</Text>
      </View>
      {children}
    </View>
  </View>;
}
/** The live job card under a thread: who is on it, step n of m and a clock counting up from crewd's own event times,
 *  the job as a check list — done, doing, still to do — with the small tool calls behind the expand, and Open into the
 *  helper's chat. At the end, one quiet line with how long it took. A helper gone quiet asks here what to do. */
function LiveCard({ ln, who, chief, quiet, chipped, replied, stuck, go, refresh, canAct, leave }: { ln: A.LiveLine; who?: A.Helper; chief: boolean; quiet: boolean; chipped: boolean; replied: boolean; stuck?: A.Helper; go: Ctx['go']; refresh: () => void; canAct: boolean; leave: (h: A.Helper) => void }) {
  const t = useLook(), ink = who ? INK : t.ink;
  const reduce = motion.useReduceMotion();
  const [openDetail, setOpenDetail] = useState(false);
  // A crew member waiting on the person reads the neutral "Waiting"; only Chief's own line says "Needs you".
  const word = ln.state === 'needs' && !ln.chief ? A.WORDS.wait : LIVE_WORD[ln.state];
  // Chief's own reply done in under a second says nothing worth a line: "Done · 0 s" goes, once the reply is there; a failed one waits for its reply, so the line never shows alone before it.
  if (ln.took !== undefined) return chipped || (!ln.helper && !replied && ln.state !== 'done') || (ln.state === 'done' && ln.took < 1000 && !ln.helper && replied) ? null
    : <View style={[s.row, { flexWrap: 'wrap', gap: 10, paddingLeft: chief ? 46 : 0 }]} accessibilityLiveRegion="polite">
      <T style={[s.read, { color: ln.state === 'failed' || ln.state === 'unsure' ? t.amber : t.mute }]}>{ln.helper ? `${ln.who} · ${word.toLowerCase()}` : word} · {A.took(ln.took)}{!!ln.count && ` · ${ln.count} ${ln.count === 1 ? 'step' : 'steps'}`}</T>
      {!!ln.helper && <Pressable onPress={() => go({ view: 'helper', id: ln.helper })} accessibilityRole="link" hitSlop={8}><T style={[s.read, s.b]}>Open chat ›</T></Pressable>}
    </View>;
  const at = ln.todos.findIndex((x) => x.state === 'doing');
  const dim = { color: ink, opacity: 0.75 };
  return <JobCard who={who} title={A.plain(ln.title ?? ln.who)} word={word} chief={chief}>
    {stuck ? <Stuck h={stuck} ink={ink} go={go} refresh={refresh} canAct={canAct} leave={leave} />
      : <Text style={[s.read, s.b, dim]} accessibilityLiveRegion="polite">{ln.who}{at >= 0 && ln.todos.length > 1 ? ` · step ${at + 1} of ${ln.todos.length}` : ''}{ln.state === 'waiting' ? '' : ` · ${A.took(Date.now() - ln.since)}`}{quiet ? ' · still working' : ''}</Text>}
    <View style={{ gap: 10 }}>{ln.todos.map((x) => <View key={`${x.at}-${x.text}`} style={[s.row, { gap: 12, alignItems: 'flex-start', opacity: x.state === 'todo' ? 0.55 : 1 }]}>
      {x.state === 'doing' ? <motion.Ring size={22} width={2} color={ink} reduce={reduce} />
        : <View style={[s.tick, { borderColor: ink, backgroundColor: x.state === 'done' ? ink : 'transparent' }]}>{x.state === 'done' && <Text style={{ color: who ? '#fff' : t.bg, fontSize: 12, lineHeight: 14, ...fw('900') }}>✓</Text>}</View>}
      <Text style={[s.read, s.b, { flex: 1, lineHeight: 22, color: ink }]}>{x.text}</Text>
    </View>)}</View>
    {!!ln.next && <Text style={[s.read, s.b, dim]}>Next: {ln.next}</Text>}
    {!!ln.detail.length && <Pressable onPress={() => setOpenDetail((v) => !v)} accessibilityRole="button" hitSlop={8}>
      <Text style={[s.read, s.b, dim]}>{openDetail ? 'Hide the small steps' : `Show the small steps (${ln.detail.length})`}</Text></Pressable>}
    {openDetail && ln.detail.map((x) => <Text key={`${x.at}-${x.text}`} style={[s.read, dim]}>{A.clock(x.at)}  {x.text}</Text>)}
    {!stuck && !!ln.helper && <Pressable onPress={() => go({ view: 'helper', id: ln.helper })} accessibilityRole="button" style={({ pressed }) => [s.liveBtn, { backgroundColor: INK }, pressed && { opacity: 0.8 }]}><Text style={[s.read, { color: '#fff', ...fw('700') }]}>Open</Text></Pressable>}
  </JobCard>;
}
/** A helper that has gone quiet (web/src/main.tsx Stuck): stop it, take the wheel, or leave it be. */
const leftAlone = new Map<string, number>();
function Stuck({ h, ink, go, refresh, canAct, leave }: { h: A.Helper; ink: string; go: Ctx['go']; refresh: () => void; canAct: boolean; leave: (h: A.Helper) => void }) {
  const btn = (label: string, onPress: () => void, primary = false) => <Pressable key={label} onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.liveBtn, { alignSelf: 'flex-start', paddingHorizontal: 20, backgroundColor: primary ? INK : 'rgba(0,0,0,0.1)' }, pressed && { opacity: 0.8 }]}>
    <Text style={[s.read, { color: primary ? '#fff' : INK, ...fw('700') }]}>{label}</Text></Pressable>;
  return <>
    <Text style={[s.read, s.b, { color: ink, opacity: 0.75 }]}>{h.name} has been quiet for {h.stuckFor} minute{h.stuckFor === 1 ? '' : 's'}. Shall I stop, or would you like to take control?</Text>
    {canAct && <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
      {h.computer && desktopAvailable && btn('Take control', () => void attempt(async () => { await api.takeOver(h.id); refresh(); go({ view: 'helper', id: h.id, tab: 'screen' }); }), true)}
      {btn('Stop', () => void attempt(async () => { await api.reset(h.id); refresh(); }, `Stopped ${h.name}`))}
      {btn('Leave it', () => leave(h))}
    </View>}
  </>;
}
/** Chief's hand-off as the person sees it (web/src/main.tsx HandOff): the one limit in crewd's words, then "Asked Rae"
 *  with the job's state, into the helper's chat. */
function HandOff({ c, state, go }: { c: A.HandChip; state: Json; go: Ctx['go'] }) {
  const t = useLook();
  const h = A.crew(state).find((x) => x.id === c.helper);
  if (!h) return null;
  return <View style={{ paddingLeft: 46, gap: 8 }}>
    {!!c.limit && <View style={[s.them, { backgroundColor: t.solid, borderColor: t.line }]}><T style={s.read}>{c.limit}</T></View>}
    <Pressable onPress={() => go({ view: 'helper', id: h.id })} accessibilityRole="link" accessibilityLabel={`Asked ${h.name}: ${c.word}`} style={({ pressed }) => [s.hand, { backgroundColor: t.soft }, pressed && { opacity: 0.7 }]}>
      <Face who={{ kind: h.kind, name: h.name, mood: h.mood }} size={32} />
      <Text style={[s.semi, { flexShrink: 1, color: t.ink }]}>Asked {h.name}</Text>
      {c.done ? <View style={[s.row, { gap: 8 }]}><Text style={{ color: t.ok, ...fw('700') }}>✓</Text><T tone="mute" style={[s.read, s.b]}>{c.word}</T></View> : c.working && <View style={[s.statusDot, { backgroundColor: t.ok }]} />}
    </Pressable>
  </View>;
}

function Head({ children, onBack, wrap }: { children: ReactNode; onBack: () => void; wrap?: boolean }) {
  const t = useLook();
  return (
    <View style={[s.head, { borderColor: t.line }, wrap && { flexWrap: 'wrap' }]}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back"><Text style={{ fontSize: 30, color: t.ink, paddingRight: 4 }}>‹</Text></Pressable>
      {children}
    </View>
  );
}

/** Chief's thread, opened from his card on Home: his header, then his chat. */
function ChiefPage(ctx: Ctx & { m?: number }) {
  return (
    <View style={{ flex: 1 }}>
      <ChiefHead offline={ctx.offline} gear={<Gear go={ctx.go} />} />
      <Chat {...ctx} id="chief" m={ctx.m} hero={<ContinueOffer canAct={ctx.canAct} onMoved={ctx.refresh} />} />
    </View>
  );
}

function Room(ctx: Ctx) {
  const { state, tick, refresh } = ctx;
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.room().then(setPage).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, tick]);
  const crew = A.crew(state);
  const lines = A.room(page, state);
  const newestRoom = [...lines].reverse().find((l) => l.text)?.id;
  return <View style={{ flex: 1 }}><Head onBack={ctx.back}><View style={{ width: 40, flexDirection: 'row' }}>{crew.slice(0, 2).map((h, i) => <View key={h.id} style={{ marginLeft: i ? -12 : 0 }}><Face who={h} size={26} /></View>)}</View><View style={{ flex: 1 }}><T style={s.rowTitle}>The crew</T><T tone="ink2" style={s.small}>Work handed between helpers</T></View></Head>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>{lines.map((l: { id: number; who?: A.Helper; from?: string; to?: string; text: string; at: number; author: string; files: A.FileView[] }) => <View key={l.id} style={{ width: '100%', maxWidth: '92%', alignSelf: l.author === 'person' ? 'flex-end' : 'flex-start' }}>
      {l.who && <View style={s.row}><Face who={l.who} size={28} /><T style={s.rowTitle}>{l.from && l.to ? `${l.from} → ${l.to}` : l.who.name}</T><T tone="mute" style={s.time}>{A.clock(l.at)}</T></View>}
      <View style={{ paddingLeft: l.author === 'person' ? 0 : 36 }}><ChatText text={l.text} latest={l.id === newestRoom} /></View>{l.files.map((f) => <Card key={f.url}><FileRow f={f} /></Card>)}
    </View>)}{!lines.length && <T tone="mute">Start a job here and follow along as the crew works together.</T>}</ScrollView>
    <View style={s.dock}><T tone="mute" style={s.small}>You can read along here. To change a job or ask the crew anything, ask Chief.</T><Btn ghost label="Ask Chief about this" onPress={() => { keepDraft('chief', 'the crew, '); ctx.go({ view: 'chief' }); }} /></View>
  </View>;
}

// ---------- the crew ----------
/** Your crew (Stack, web/src/main.tsx Crew): Chief and every helper as a tile in their own colour, each with the one
 *  status every screen reads (A.chiefStatus, A.statusOf). A tile opens that member's chat. */
function Crew(ctx: Ctx) {
  const { state, go, offline } = ctx;
  const view = useOffice(state, offline, OUT);
  const t = useLook();
  const { width } = useWindowDimensions();
  const cols = Math.max(2, Math.floor((width - 22) / 170)), w = Math.floor((width - 32 - 10 * (cols - 1)) / cols);
  const roles = new Map(A.crew(state).map((h) => [h.id, A.tagOf(h)]));
  // Chief's blue takes light words (art.inkOn); one short role line each (A.tagOf), the full role on the sheet.
  const tile = (key: string, face: ReactNode, kind: art.Kind | 'chief', name: string, word: string, role: string, route: Route) => {
    const ink = { color: art.inkOn(kind), opacity: 1 };
    return <Pressable key={key} onPress={() => go(route)} accessibilityRole="button" accessibilityLabel={`${name}: ${word}`} style={({ pressed }) => [s.stTile, { width: w, backgroundColor: art.colourOf(kind) }, pressed && { opacity: 0.8 }]}>
      <Text style={[s.stPill, { alignSelf: 'flex-end', maxWidth: '100%', color: ink.color }]}>{word}</Text>
      <View style={{ alignSelf: 'center', marginTop: 10, marginBottom: 12 }}>{face}</View>
      <Text style={[s.semi, { color: ink.color }]}>{name}</Text><Text style={[s.stSub, kind === 'chief' && ink]}>{role}</Text>
    </Pressable>;
  };
  return <Page back={['Home', () => go({ view: 'home' }, true)]}>
    <T style={[s.wide, { fontSize: 40, lineHeight: 42 }]}>Your crew</T>
    <T tone="mute" style={s.read}>Chief deals each job to one of them. Tap one to see what they are doing.</T>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
      {tile('chief', <Face who="chief" size={72} mood={view.chief.mood} />, 'chief', 'Chief', offline ? OUT : A.chiefStatus(view).word, 'Hands out the jobs', { view: 'chief' })}
      {A.roster(view.crew).map((c) => tile(c.id, <Face who={{ kind: c.kind, name: c.name, mood: c.mood }} size={72} />, c.kind, c.name, offline ? OUT : A.statusOf(c, view).word, roles.get(c.id) ?? '', { view: 'helper', id: c.id }))}
      {ctx.canAct && <Pressable onPress={() => go({ view: 'add' })} accessibilityRole="button" style={({ pressed }) => [s.stTile, { width: w, borderWidth: 2, borderStyle: 'dashed', borderColor: t.line2, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
        <T style={{ fontSize: 36, lineHeight: 40 }}>+</T><T style={[s.semi, s.centerText, { marginTop: 10, alignSelf: 'stretch' }]}>Add a helper</T><T tone="mute" style={[s.read, s.centerText]}>Tell Chief who you need</T>
      </Pressable>}
    </View>
  </Page>;
}

function HelperPage(ctx: Ctx & { id: string; tab: string; m?: number; setTab: (t: string) => void }) {
  const { id, tab, m, setTab, state, tick, refresh, canAct, back, go } = ctx;
  const h = A.crew(state).find((x) => x.id === id);
  const [page, setPage] = useState<Json>(null);
  const [all, setAll] = useState(false); // Details shows what it is doing now; "What happened" opens the whole trail in place
  const load = useCallback(() => api.bot(id).then(setPage).catch(() => {}), [id]);
  useEffect(() => { void load(); }, [load, tick]);
  const { width, fontScale } = useWindowDimensions();
  if (!h) return <Center><T tone="mute">This helper has left the crew.</T></Center>;
  const b = state.bots.find((x: Json) => x.id === id);
  // The chat is the page; everything else lives behind Details. Old deep links to a section land on Details too.
  const details = tab !== 'chat';
  const trail = A.steps(page?.trail ?? []);
  // Opened from the bubble ('screen' after taking the wheel, or 'watch'): the screen leads and opens by itself.
  const screenFirst = tab === 'screen' || tab === 'watch';
  // When the screen is narrow for its text (a large font) the name's column no longer has room beside the two
  // controls, so the role wrapped to one word a line. The controls drop to their own row below and the name and
  // role keep the full width, the switch the phone's head already makes (`PhoneHead`).
  const narrow = width / fontScale < 360;
  const screen = h.computer && desktopAvailable && <>
    <T style={s.b}>{`See ${h.name}'s screen`}</T>
    <Screen bot={{ ...page?.bot, ...b }} canAct={canAct} showing={A.showing(state, id)} watchNow={screenFirst} refresh={() => { refresh(); void load(); }} />
  </>;
  return (
    <View style={{ flex: 1 }}>
      {tab === 'chat' ? <>
        <Head onBack={back} wrap={narrow}>
          <Face who={h} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}><T style={s.rowTitle}>{h.name}</T><T tone="ink2" style={s.small}>{ctx.offline ? OUT : h.role}</T></View>
          <View style={[s.row, { gap: 12 }, narrow && { width: '100%', justifyContent: 'flex-end' }]}>
            {b?.task && canAct && <Btn label="Stop" onPress={() => attempt(async () => { await api.reset(id); refresh(); }, `Stopped ${h.name}`)} />}
            <Btn ghost label="Details" onPress={() => setTab('details')} />
          </View>
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

/** One plain line for a screen that would not open. desklink's own failure text is diagnostic, never shown; a path
 *  that never formed ('never-connected') will not reopen itself, so say what to check instead of "try again". */
const screenFailWords = (name: string, code?: string) => code === 'never-connected'
  ? `This phone can't reach ${name}'s computer directly. Bring it onto the home Wi-Fi, then try again.`
  : `Couldn't open ${name}'s screen. Try again in a moment.`;

/** A bot's own screen on the phone, through desklink over the encrypted link: Watch, Take control, Hand it back.
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
    onError: (fail) => setErr(screenFailWords(bot.display, fail.code)),
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
          {idle && <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 16 }]}><T tone="mute" style={s.centerText}>{live === 'failed' ? (err || "Couldn't open it. Try again in a moment.") : `Opening ${bot.display}'s screen…`}</T></View>}
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
          {help && <T tone="mute" style={s.small}>{bot.display} has its own computer at home, separate from yours. Taking control pauses it, for a sign-in or anything it's stuck on; handing it back lets it carry on.</T>}
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
        {canAct && <Btn label="Take control" onPress={act(async () => { await api.takeOver(bot.id); watching.current = true; if (idle) watch(); })} />}
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
      <T tone="mute" style={s.small}>{bot.display} has its own computer at home, separate from yours. Taking control pauses it, for a sign-in or anything it's stuck on; handing it back lets it carry on.</T>
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
          <Face who={{ kind: g.kind, name: g.name } as any} size={44} /><View style={{ flex: 1, minWidth: 0 }}><TextInput style={{ fontFamily: 'Inter', ...fw('500'), fontSize: 15, color: t.ink, padding: 0 }} value={names[g.id] ?? g.name} onChangeText={(v) => setNames({ ...names, [g.id]: v })} accessibilityLabel={`Name for ${g.name}`} /><T tone="mute" style={s.small} lines={2}>{g.does}</T></View>
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
  const [held, setHeld] = useState(false); // the phone that set up a cloud computer keeps its boat.dev key
  const [pasting, setPasting] = useState<(typeof A.AIS)[number] | null>(null);
  const mine = useSignedIn(pasting ? 0 : 1), top = mine?.length ? mine.map((r) => r.ai) : [A.AIS[0]], others = A.AIS.filter((ai) => !top.includes(ai));
  useEffect(() => { void keptKey().then((k) => setHeld(!!k)); }, []);
  const row = (ai: (typeof A.AIS)[number]) => <View key={ai.key} style={[s.row, { gap: 12, paddingVertical: 10 }]}>
    <AiMark ai={ai} />
    <View style={{ flex: 1 }}><T style={s.b}>{ai.name}</T>{!!ai.cli && <T tone="mute" style={s.small}>Needs {ai.cli} first.</T>}</View>
  </View>;
  return <>
    <Card style={{ gap: 0, paddingVertical: 6 }}>
      {top.map(row)}
      <T tone="mute" style={[s.small, { paddingBottom: 10 }]}>{mine?.length ? 'Signed in on the home computer. Signing in happens there, in Settings.' : mine ? 'Nothing is signed in yet. Signing in happens on the home computer, in Settings.' : "Signing in happens on the home computer, in Settings. This phone can't tell whether an account is signed in."}</T>
    </Card>
    <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} accessibilityLabel="More ways to sign in"
      style={[s.row, { minHeight: 48, paddingHorizontal: 4, marginTop: 8 }]}>
      <T tone="ink2" style={{ flex: 1, ...fw('500') }}>More ways to sign in</T>
      {!more && <View style={[s.row, { gap: 4 }]}>{others.map((ai) => <AiMark key={ai.key} ai={ai} size={22} />)}</View>}
      <T tone="mute">{more ? '⌄' : '›'}</T>
    </Pressable>
    {more && <Card style={{ gap: 0, paddingVertical: 6 }}>{others.map(row)}</Card>}
    {held && A.AIS.filter((ai) => 'keyEntry' in ai && ai.keyEntry).map((ai) => <Btn key={ai.key} soft tall label={`Paste your ${ai.name} key`} onPress={() => setPasting(ai)} />)}
    {pasting && <PhoneKeySheet ai={pasting} onClose={() => setPasting(null)} />}
    <T tone="mute" style={[s.small, { marginTop: 6, marginHorizontal: 4 }]}>{A.AI_ROUTES}</T>
  </>;
}

/** A cloud computer has no screen of its own, so its owner phone pastes the key: the two calls the web sign-in sheet makes
 *  (web/src/flows.tsx SignIn), then the wait until the computer says it is signed in. The key goes to that computer only. */
function PhoneKeySheet({ ai, onClose }: { ai: (typeof A.AIS)[number]; onClose: () => void }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const send = async () => {
    setBusy(true); setErr('');
    try {
      await api.signIn(ai.key, { via: 'key' });
      await api.signInPaste(ai.key, key.trim()); setKey('');
      for (let i = 0; i < 40; i++) {
        const g = A.account(await api.accounts(), ai.key);
        if (g.state === 'ready') { setDone(true); setModels((await api.models(ai.key).catch(() => ({ models: [] }))).models); break; }
        if (g.key?.error) { setErr(g.key.error); break; }
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) { setErr(FRIENDLY[trouble(e)]); }
    setBusy(false);
  };
  return <Modal visible transparent animationType={motion.sheet(reduce)} onRequestClose={onClose}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Pressable style={s.scrim} onPress={onClose}>
        <Pressable style={[s.sheet, { backgroundColor: t.bg }]} onPress={() => {}}>
          <T style={s.h2}>{done ? `You're signed in with ${ai.name}` : `Paste your ${ai.name} key`}</T>
          {done ? <>
            <T tone="ink2">The crew thinks with your own {ai.name} now. The key stays on your cloud computer.</T>
            {models.length > 0 && <>
              <T style={s.b}>Which model should your crew use?</T>
              <ScrollView style={{ maxHeight: 260 }}>{models.map((m) => <Btn key={m.id} soft tall label={m.name} onPress={() => void api.pickModel(ai.key, m.id).then(() => onClose()).catch((e) => setErr(FRIENDLY[trouble(e)]))} />)}</ScrollView>
              {!!err && <T tone="pinkInk">{err}</T>}
            </>}
          </> : <>
            <T tone="ink2">Paste the key from your {ai.name} account. It uses your own {ai.name} plan and stays on your cloud computer.</T>
            <TextInput style={[s.input, { color: t.ink, borderColor: t.line }]} value={key} onChangeText={setKey} editable={!busy}
              placeholder={`${ai.name} key`} placeholderTextColor={t.mute} accessibilityLabel={`${ai.name} key`} autoCapitalize="none" autoCorrect={false} secureTextEntry />
            {!!err && <T tone="pinkInk">{err}</T>}
          </>}
          {busy ? <ActivityIndicator color={t.pink} style={{ margin: 12 }} /> : done ? <Btn go big label="Done" onPress={onClose} />
            : <><Btn go big label={`Sign in with ${ai.name}`} disabled={!key.trim()} onPress={() => void send()} /><Btn ghost label="Cancel" onPress={onClose} /></>}
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  </Modal>;
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
      <T tone="mute" style={s.small}>Ask Chief, Write with Writer Will and Record a demo with Video Vic also go in Control Center, on the Lock Screen, and on the Action button if yours has one. Each opens the chat with your words in the box; nothing is sent until you tap send.</T>
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
const GO_TO: [Route['view'] | null, string, art.Tab | null][] = [['things', 'Your things', 'things'], ['routines', 'Routines', 'routines'], [null, 'Apps', null], ['crew', 'Your crew', 'crew'],
  ...(cloudOn ? [['computer', A.computer(null).title, null] as [Route['view'], string, null]] : [])];
function CustomRules({ writer }: { writer: boolean }) {
  const t = useLook(), [rules, setRules] = useState<string[]>([]), [editing, setEditing] = useState<string | null>(null), [text, setText] = useState(''), [error, setError] = useState('');
  const load = async () => { try { setRules((await api.rules()).rules); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, []);
  const save = (next: string, old: string) => void attempt(async () => { await api.setRule(next, old); setEditing(null); await load(); }, next ? 'Saved' : 'Removed');
  return <><Label>Custom rules</Label><T tone="ink2">Rules you confirmed with Chief. Every helper reads them before a job. These do not change safety checks.</T>
    {!!error && <T>{error}</T>}
    {rules.length ? rules.map((rule) => <Card key={rule}>{editing === rule ? <>
      <TextInput style={[s.input, { color: t.ink, borderColor: t.line, minHeight: 120 }]} value={text} onChangeText={setText} multiline maxLength={1000} accessibilityLabel="Edit rule" />
      <View style={s.chips}><Btn go label="Save changes" disabled={!text.trim() || !writer} onPress={() => save(text, rule)} /><Btn label="Cancel" onPress={() => setEditing(null)} /></View>
    </> : <><T>{rule}</T>{writer && <View style={s.chips}><Btn label="Edit" onPress={() => { setEditing(rule); setText(rule); }} /><Btn ghost label="Remove" onPress={() => save('', rule)} /></View>}</>}</Card>) : !error && <T tone="mute">No custom rules yet. Tell Chief how you want the crew to work.</T>}
  </>;
}
/** Which Crewhouse this is, in small print: this app's build (app.json, `-dev` from Metro) and the home computer's. */
function Versions({ state, hint = true }: { state: Json; hint?: boolean }) {
  const v = A.versions(state, { version: `${expo.version}${__DEV__ ? '-dev' : ''}`, made: process.env.EXPO_PUBLIC_CREWHOUSE_VERSION ?? '' });
  return <T tone="mute" style={[s.small, { textAlign: 'center' }]}>{v.line}{hint && v.hint ? `\n${v.hint}` : ''}</T>;
}
function ThisPhone({ state, grant, status, person, writer, refresh, go, back, onForget, onClear }: { state: Json; grant: Grant; status: Status; person: Json; writer: boolean; refresh: () => void; go: Ctx['go']; back: [string, () => void]; onForget: () => void; onClear: () => void }) {
  const t = useLook();
  // This phone knows its own news state: allowed and working, said no, or this build can't push at all.
  const [push, setPush] = useState<'on' | 'off' | 'missing' | null>(null);
  useEffect(() => { void pushState().then(setPush).catch(() => {}); }, []);
  const quiet = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(String(person?.quiet ?? ''));
  const hm = (h: string, m: string) => `${+h}:${m}`;
  // News is the phone's own permission: a switch that asks, or sends the person to the phone's settings when asking can't.
  const news = async () => {
    if (push === 'on') return void Linking.openSettings();
    const now = await pushState(true).catch(() => push);
    setPush(now);
    if (now === 'off') void Linking.openSettings();
  };
  const sw = (on: boolean, label: string, change: () => void, off = false) => <Switch value={on} disabled={off} accessibilityLabel={label} trackColor={{ false: t.line, true: t.ink }} thumbColor={t.bg} onValueChange={change} />;
  const line = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line };
  const group = [s.listGroup, { backgroundColor: t.solid, borderColor: t.line, borderRadius: 24 }];
  return (
    <Page>
      <View style={[s.row, { gap: 12 }]}>
        <Pressable onPress={back[1]} accessibilityRole="button" accessibilityLabel={`Back to ${back[0]}`} hitSlop={8} style={[s.roundBack, { backgroundColor: t.soft, marginTop: 0 }]}><T style={s.backChevron}>{'\u2039'}</T></Pressable>
        <View style={{ flex: 1 }}><T style={s.semi}>This phone</T><T tone="ink2">Settings</T></View>
      </View>
      <View style={group}>
        <View style={[s.listRow, { minHeight: 80 }]}>
          <View style={[s.markTile, { backgroundColor: t.soft }]}><View style={[s.phoneGlyph, { borderColor: t.ink }]} /></View>
          <View style={{ flex: 1 }}>
            <T style={s.rowTitle}>{A.displayName(person) ? `Paired with ${A.displayName(person)}'s computer` : 'Paired with your computer'}</T>
            <T tone="ink2">{status !== 'online' ? 'Looking for your computer…' : grant.device.role === 'view' ? 'Watches the crew, can’t answer' : 'Answers as you'}</T>
          </View>
        </View>
        <View style={[s.listRow, line, { minHeight: 80 }]}>
          <View style={{ flex: 1 }}><T style={s.rowTitle}>News when the app is closed</T><T tone="ink2">{push === 'missing' ? PUSH_WORDS.missing : push === 'off' ? 'Off for Crewhouse on this phone' : 'Content-free: it only says something happened'}</T></View>
          {sw(push === 'on', 'News when the app is closed', () => void news(), push === null || push === 'missing')}
        </View>
        <View style={[s.listRow, line, { minHeight: 80 }]}>
          <View style={{ flex: 1 }}><T style={s.rowTitle}>Quiet hours</T><T tone="ink2">{quiet ? `${hm(quiet[1], quiet[2])} to ${hm(quiet[3], quiet[4])}` : 'Off'}</T></View>
          {sw(!!quiet, 'Quiet hours', () => void attempt(async () => { await api.person(person.id, { quiet: quiet ? null : '22:00-07:00' }); refresh(); }), !writer)}
        </View>
      </View>
      <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel="Clear what this phone kept" style={({ pressed }) => [...group, s.listRow, { minHeight: 80 }, pressed && { opacity: 0.6 }]}>
        <View style={{ flex: 1 }}><T style={s.rowTitle}>Clear what this phone kept</T><T tone="ink2">The crew keeps everything at home</T></View>
        <T tone="ink2" style={{ fontSize: 24 }}>›</T>
      </Pressable>
      <Btn soft tall label="Remove this phone" onPress={onForget} />
      <View style={[s.listGroup, { backgroundColor: t.solid, borderColor: t.line }]}>{GO_TO.map(([v, label, icon], i) => {
        const body = <>
          <View style={{ width: 24, alignItems: 'center' }}>{icon && <Dots rows={art.TABS[icon]} pal={{ x: t.ink2 }} d={20 / 9} crisp />}
            {v === 'computer' && <Image source={WHERE.cloud} style={{ width: 20, height: 20, tintColor: t.ink2 }} />}</View>
          {/* Apps connect where the sign-in happens; this phone has no apps screen of its own. */}
          <View style={{ flex: 1 }}><T style={s.rowTitle}>{label}</T>{!v && <T tone="mute" style={s.small}>Connected on the home computer, in Apps.</T>}</View>
          {!!v && <T tone="mute">›</T>}
        </>;
        const edge = { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.line };
        return v ? <Pressable key={label} onPress={() => go({ view: v })} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.listRow, edge, pressed && { opacity: 0.6 }]}>{body}</Pressable>
          : <View key={label} style={[s.listRow, edge]}>{body}</View>;
      })}</View>
      <CustomRules writer={writer && status === 'online'} />
      <Label>Your AI accounts</Label>
      <PhoneAccounts />
      {Platform.OS === 'android' && <StatusBarRow />}
      {Platform.OS === 'android' && grant.device.role === 'control' && <BubbleRow grant={grant} />}
      {Platform.OS === 'ios' && <OnYourScreen />}
      <T tone="mute" style={s.small}>{A.atHome('the home computer').join(' ')}</T>
      <T tone="mute" style={s.small}>To take a phone's access away for good, remove it on the computer too: Settings, Phones.</T>
      <Versions state={state} />
    </Page>
  );
}

/** The owner phone manages its bound cloud computer through the kit, even when crewd is out of touch. */
function ChiefComputer({ back, onRestored }: { back: [string, () => void]; onRestored: (g: Grant) => void }) {
  const t = useLook();
  const reduce = motion.useReduceMotion();
  const [c, setC] = useState<A.Computer | null>(null);
  const [resetting, setResetting] = useState(false);
  const [more, setMore] = useState(false);
  const [nudged, setNudged] = useState(false);
  const [note, setNote] = useState('');
  const nudgeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroll = useRef<ScrollView | null>(null);
  const reasonY = useRef(0);
  const [held, setHeld] = useState(false); // this phone keeps the boat.dev key
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const acting = useRef(false);
  const act = async (x?: A.ComputerAct) => {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError('');
    try {
      const g = await loadGrant(), key = await keptKey(); setHeld(!!key);
      if (!g || !key) throw new Error('Use the phone that set up this computer to manage it.');
      const next = await computerCall(boatOn(key), cloudStore, g.host, x, c?.snapshotId, lab, async (relay) => onRestored(await keepGrant(computerGrant(g, relay))));
      setC(next); setNote(next?.warning || (x ? 'Finished.' : ''));
    } catch (e) { setError(e instanceof MachineError ? said(e) : e instanceof Error ? e.message : 'Could not reach your computer.'); }
    finally { acting.current = false; setBusy(false); }
  };
  useEffect(() => { void act(); }, []);
  useEffect(() => () => { if (nudgeT.current) clearTimeout(nudgeT.current); }, []);
  const w = A.computer(c), boat = A.CLOUD.boat, off = !c;
  // Not connected: the dimmed rows never act — a tap flashes the reason line, says it aloud, and brings it into
  // view (at the largest text it starts below the fold) instead.
  const nudge = () => {
    setNudged(true); setNote(w.connect);
    scroll.current?.scrollTo({ y: Math.max(0, reasonY.current - 120), animated: !reduce });
    if (nudgeT.current) clearTimeout(nudgeT.current);
    nudgeT.current = setTimeout(() => { setNudged(false); setNote(''); }, 1600);
  };
  const group = [s.listGroup, { backgroundColor: t.solid, borderColor: t.line }];
  const row = (i: number, body: ReactNode, onPress?: () => void, label?: string) => {
    const line = { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.line };
    return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.listRow, line, pressed && { opacity: 0.6 }]}>{body}</Pressable>
      : <View style={[s.listRow, line]}>{body}</View>;
  };
  const two = ([l, v]: string[], red = false) => <View style={{ flex: 1 }}><T style={[s.rowTitle, red && { color: t.danger }]}>{l}</T><T tone="mute" style={s.small}>{v}</T></View>;
  // Wraps: at the largest text the value drops under its label rather than splitting a word.
  const value = ([l, v]: string[]) => <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12 }}><T style={s.rowTitle}>{l}</T><T tone="mute">{v}</T></View>;
  const offReset = <Pressable onPress={nudge} accessible={false}>
    <View style={[s.listRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, opacity: 0.55 }]}
      accessibilityRole="button" accessibilityLabel={w.reset[0]} accessibilityState={{ disabled: true }}>{two(w.reset, true)}</View>
  </Pressable>;
  const offDaily = <View style={[s.listRow, { opacity: 0.55 }]}>
    {two(w.daily)}<Switch value={false} disabled accessibilityLabel={w.daily[0]} trackColor={{ false: t.line, true: t.ok }} thumbColor={t.solid} />
  </View>;
  return (
    <Page title={w.title} back={back} scroll={scroll}>
      <View pointerEvents={busy ? 'none' : 'auto'} style={[group, busy && { opacity: 0.5 }]}>{row(0, value(w.update), off ? undefined : () => void act('update'), w.update[0])}{off || !c?.snapshotId ? offReset : row(1, two(w.reset, true), () => setResetting(true), w.reset[0])}</View>
      {busy && <ActivityIndicator accessibilityLabel="Working on your computer" color={t.ink} />}
      {!!error && <View accessibilityLiveRegion="polite"><T tone="pinkInk">{error}</T></View>}
      <Btn label="Refresh computer" disabled={busy} onPress={() => void act()} />
      <T tone="mute" style={[s.small, { marginHorizontal: 16, marginTop: -4 }]}>{w.caption}</T>
      <View style={group}>
        {offDaily}
        {row(1, two(w.save), !off && !busy ? () => void act('snapshot') : undefined, w.save[0])}
        {row(2, value(w.disk))}</View>
      <T tone="mute" style={s.small}>{w.last}</T>
      {off && <View onLayout={(e) => { reasonY.current = e.nativeEvent.layout.y; }}><T tone="mute" style={[s.small, { marginHorizontal: 16 }, nudged && { color: t.ink }]}>{w.connect}</T></View>}
      {!!note && <View accessibilityLiveRegion="polite"><T>{note}</T></View>}
      <View style={group}>{row(0, <><View style={[s.mark, { backgroundColor: boat.tile }]}><Text style={s.markText}>{boat.mark}</Text></View>{two(w.host)}</>)}</View>
      {held && <View style={group}>{row(0, <>{two(w.key)}<Btn disabled={busy} label={w.forget} onPress={() => void attempt(async () => { await forgetKey(); setHeld(false); setC(null); })} /></>)}</View>}
      <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} accessibilityLabel={w.more} style={[s.row, { minHeight: 48, paddingHorizontal: 4 }]}>
        <T tone="ink2" style={{ flex: 1, ...fw('500') }}>{w.more}</T><T tone="mute">{more ? '⌄' : '›'}</T></Pressable>
      {more && <View style={group}>
        {row(0, <View accessibilityState={{ disabled: true }} style={{ opacity: 0.55, flex: 1 }}>{two([w.undo, w.unavailable])}</View>)}
        {row(1, <T style={[s.rowTitle, { flex: 1, color: t.danger }]}>{w.remove}</T>, () => Alert.alert(w.removeAsk[0], w.removeAsk[1],
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void act('delete') }]), w.remove)}</View>}
      <Modal visible={resetting} transparent animationType={motion.sheet(reduce)} onRequestClose={() => setResetting(false)}>
        <Pressable style={s.scrim} onPress={() => setResetting(false)}>
          <Pressable style={[s.sheet, { backgroundColor: t.bg }]} onPress={() => {}}>
            <T style={s.title}>{w.sheet.title}</T>
            <T tone="ink2">{w.sheet.lost.map((p, i) => (i % 2 ? <Text key={i} style={[s.b, { color: t.ink }]}>{p}</Text> : p))}</T>
            <T tone="ink2">{w.sheet.safe}</T>
            <Btn danger big disabled={busy} label={w.sheet.yes} onPress={() => { setResetting(false); void act('reset'); }} />
            <Btn ghost big label={w.sheet.no} onPress={() => setResetting(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Page>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  centerScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  centerText: { textAlign: 'center' },
  page: { padding: 16, gap: 12, paddingBottom: 32 },
  tabs: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10, borderTopWidth: 1 },
  tab: { flex: 1, minWidth: 0, minHeight: 54, alignItems: 'center', gap: 2, paddingVertical: 4 },
  tabIc: { width: 56, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 14, lineHeight: 17, ...fw('700') },
  tabBadge: { position: 'absolute', top: 0, left: '50%', marginLeft: 10, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, overflow: 'hidden', fontSize: 13, lineHeight: 20, color: color.day.ink, textAlign: 'center', ...fw('700') },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { fontFamily: 'Inter', fontSize: 15, lineHeight: 22, fontVariant: ['tabular-nums'] },
  h1: { fontSize: 26, lineHeight: 32, ...fw('700'), letterSpacing: -0.6, marginVertical: 4 },
  display: { fontFamily: 'Inter', fontSize: 38, lineHeight: 42, ...fw('600'), letterSpacing: 0, textAlign: 'center' },
  // Titles and names: Inter 600 (welcome, pairing, Hello, the office's sheets).
  serif: { fontFamily: 'Inter', ...fw('600'), letterSpacing: 0 },
  stepNum: { width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, fontSize: 12, ...fw('700'), overflow: 'hidden', marginTop: 0 },
  h2: { fontSize: 17, ...fw('600'), lineHeight: 24 },
  b: { ...fw('600') },
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
  label: { fontSize: 12, lineHeight: 16, ...fw('600'), letterSpacing: 0.7, textTransform: 'uppercase' },
  count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, fontSize: 11, lineHeight: 18, ...fw('700'), textAlign: 'center', overflow: 'hidden' },
  stats: { flexDirection: 'row', gap: 6, marginTop: 14 },
  stat: { flex: 1, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  statNum: { fontSize: 18, lineHeight: 22, ...fw('700'), letterSpacing: -0.3 },
  statLabel: { fontSize: 12, lineHeight: 16 },
  time: { fontSize: 12, lineHeight: 16 },
  fp: { fontSize: 22, ...fw('600'), fontVariant: ['tabular-nums'], marginVertical: 8, textAlign: 'center' },
  card: { borderRadius: radius.card, padding: 16, gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 8, maxWidth: '100%' },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: 'Inter', fontSize: 13, ...fw('500'), flexShrink: 1 },
  btn: { borderRadius: radius.control, paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  btnBig: { alignSelf: 'stretch', minHeight: 48 },
  btnText: { fontFamily: 'Inter', fontSize: 14, ...fw('600') },
  // J17's wide buttons: the black one and the grey one, 50 tall with a 16 corner.
  btnTall: { alignSelf: 'stretch', minHeight: 50, borderRadius: 16 },
  btnTallText: { fontSize: 17, ...fw('700') },
  markTile: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  phoneGlyph: { width: 16, height: 26, borderWidth: 2, borderRadius: 5 },
  roundBack: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  backChevron: { fontSize: 28, lineHeight: 30 },
  codeInput: { minHeight: 54, borderRadius: 16, fontSize: 17 },
  input: { fontFamily: 'Inter', borderWidth: 1, borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: radius.pill, borderWidth: 1, paddingVertical: 7, paddingRight: 7, paddingLeft: 14, minHeight: 52 },
  composerInput: { fontFamily: 'Inter', flex: 1, fontSize: 15, paddingVertical: 8, maxHeight: 140 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  square: { width: 42, height: 42, borderRadius: 13 },
  threadBox: { alignItems: 'center', gap: 6, minHeight: 54, padding: 6, paddingLeft: 16, borderRadius: 18 },
  dock: { paddingHorizontal: 12, paddingVertical: 8 },
  bubble: { alignItems: 'center', gap: 4, width: 64 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  stepDot: { width: 10, height: 10, borderRadius: 5 },
  line: { width: '100%', maxWidth: '92%', gap: 4, alignSelf: 'flex-start' },
  intro: { alignItems: 'center', gap: 2, paddingTop: 12, paddingBottom: 6 },
  introName: { fontSize: 20, lineHeight: 26, ...fw('700'), letterSpacing: -0.3, marginTop: 8 },
  day: { alignItems: 'center', marginTop: 10 },
  dayText: { fontSize: 12, lineHeight: 16, ...fw('500') },
  // A thread's NEW divider over the first line the person hasn't seen yet.
  newDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  newPill: { position: 'absolute', bottom: 10, alignSelf: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, shadowColor: '#14121a', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  newPillText: { fontSize: 13, lineHeight: 18, ...fw('600') },
  newDividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  newDividerText: { fontSize: 11, lineHeight: 16, letterSpacing: 1, textTransform: 'uppercase', ...fw('700') },
  typing: { flexDirection: 'row', gap: 5, paddingVertical: 8, flex: 1 },
  typingDot: { width: 7, height: 7, borderRadius: 4 },
  bar: { height: 14, borderRadius: 7 },
  listGroup: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
  rowTitle: { fontSize: 15, lineHeight: 22, ...fw('500') },
  fileIc: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fileGlyph: { fontSize: 20, lineHeight: 24 },
  fileChip: { alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 1, borderRadius: radius.card, paddingVertical: 8, paddingHorizontal: 10 },
  fileTag: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  fileOpen: { borderRadius: radius.control, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  offline: { paddingVertical: 7, paddingHorizontal: 16 },
  offlineText: { textAlign: 'center', fontSize: 13, ...fw('700') },
  toast: { position: 'absolute', bottom: 84, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, ...fw('500'), overflow: 'hidden', maxWidth: '90%' },
  scanHint: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, gap: 12, backgroundColor: '#000a' },
  scrim: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  sheet: { padding: 22, paddingTop: 12, gap: 12, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: 2 },
  askStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  askWords: { fontSize: 17, lineHeight: 24, ...fw('600') },
  askQ: { fontSize: 20, lineHeight: 26, ...fw('600'), letterSpacing: -0.2 },
  askInline: { gap: 8, borderTopWidth: 1, borderStyle: 'dashed', paddingTop: 14, marginTop: 6 },
  ev: { borderRadius: radius.control, padding: 12, gap: 6, width: '100%' },
  orderRow: { flexDirection: 'row', gap: 12, alignItems: 'baseline', alignSelf: 'stretch' },
  label2: { fontSize: 12, lineHeight: 16, ...fw('500') },
  // The first screen and the cloud steps (mocks C, provider, signin-key): one phone column, the last line at the foot.
  screen: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 28 },
  foot: { marginTop: 'auto', paddingTop: 18 },
  title: { fontSize: 22, lineHeight: 28, ...fw('600') },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.card },
  mark: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  markText: { fontFamily: 'Inter', fontSize: 15, ...fw('700'), color: '#FFFFFF' },
  radio: { width: 22, height: 22, borderRadius: 11 },
  // The Stack (web/src/styles.css .stack): Archivo titles, Chief's card, crew cards and tiles in each one's colour.
  wide: { fontFamily: 'Archivo_Wide', fontSize: 36, lineHeight: 38 },
  semi: { fontFamily: 'Archivo_Semi', fontSize: 18, lineHeight: 22 },
  stChief: { borderWidth: 1, borderRadius: 26, padding: 18, gap: 14 },
  stLabel: { fontSize: 14, lineHeight: 18, ...fw('700'), letterSpacing: 1.1, textTransform: 'uppercase' },
  stCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 22 },
  stPill: { fontFamily: 'Inter', fontSize: 14, lineHeight: 18, ...fw('700'), color: '#0B0B0B', backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, overflow: 'hidden' },
  // Chief's thread (J03): the bubbles, the "Asked Rae" chip, and the job card in its helper's colour.
  them: { alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 12, paddingHorizontal: 15, borderRadius: 20, borderBottomLeftRadius: 6, borderWidth: 1 },
  mine: { alignSelf: 'flex-end', maxWidth: '82%', paddingVertical: 12, paddingHorizontal: 15, borderRadius: 20, borderBottomRightRadius: 6 },
  hand: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: '100%', alignItems: 'center', alignSelf: 'flex-start', gap: 12, paddingVertical: 6, paddingLeft: 6, paddingRight: 18, borderRadius: 24 },
  live: { flex: 1, minWidth: 0, gap: 12, padding: 16, borderRadius: 24 },
  liveBtn: { minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stSub: { fontFamily: 'Inter', fontSize: 16, lineHeight: 21, ...fw('600'), color: '#0B0B0B', opacity: 0.75 },
  stTile: { minHeight: 204, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 14, borderRadius: 24, gap: 2 },
});

// The bubble's panel (src/panel.tsx) is its own screen over other apps, built from these same pieces.
export { AskSheet, attempt, Btn, Card, Composer, Face, look, s, say, ShareIn, T, Theme, Toast };
