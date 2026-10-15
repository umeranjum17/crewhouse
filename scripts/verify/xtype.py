# Types on one X display through XTEST (DISPLAY and XAUTHORITY from the environment): xtype.py key:ctrl+l text:abc key:Return
# The lab's stand-in for the helper's own browser step: on the stub engine the helper's browser tool is headless.
import ctypes, sys, time
x = ctypes.CDLL('libX11.so.6'); t = ctypes.CDLL('libXtst.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
d = ctypes.c_void_p(x.XOpenDisplay(None))
if not d.value: sys.exit('no display')
x.XStringToKeysym.restype = ctypes.c_ulong
x.XKeycodeToKeysym.restype = ctypes.c_ulong
NAMES = {':': 'colon', '/': 'slash', '.': 'period', '@': 'at', '-': 'minus', '_': 'underscore', ' ': 'space', '?': 'question', '=': 'equal', '&': 'ampersand'}
def press(code, down): t.XTestFakeKeyEvent(d, code, down, 0); x.XFlush(d); time.sleep(0.02)
def tap(name, mods=()):
    sym = x.XStringToKeysym(name.encode()); code = x.XKeysymToKeycode(d, sym)
    shift = x.XKeycodeToKeysym(d, code, 0) != sym and x.XKeycodeToKeysym(d, code, 1) == sym
    held = [x.XKeysymToKeycode(d, x.XStringToKeysym(m.encode())) for m in (*mods, *(['Shift_L'] if shift else []))]
    for m in held: press(m, 1)
    press(code, 1); press(code, 0)
    for m in reversed(held): press(m, 0)
for arg in sys.argv[1:]:
    kind, _, val = arg.partition(':')
    if kind == 'key':
        *mods, k = val.split('+'); tap(k, tuple({'ctrl': 'Control_L', 'shift': 'Shift_L', 'alt': 'Alt_L'}[m] for m in mods))
    elif kind == 'text':
        for ch in val: tap(NAMES.get(ch, ch))
    elif kind == 'wait': time.sleep(float(val))
    time.sleep(0.1)
print('typed', len(sys.argv) - 1)
