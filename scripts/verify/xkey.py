# Move the pointer (optional) and press keys on the current X display through XTEST: xkey.py Return [x y]
import ctypes, sys, time
x = ctypes.CDLL('libX11.so.6'); t = ctypes.CDLL('libXtst.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
d = ctypes.c_void_p(x.XOpenDisplay(None))
if len(sys.argv) > 3:
    t.XTestFakeMotionEvent(d, -1, int(sys.argv[2]), int(sys.argv[3]), 0); x.XFlush(d); time.sleep(0.2)
x.XStringToKeysym.restype = ctypes.c_ulong
code = x.XKeysymToKeycode(d, x.XStringToKeysym(sys.argv[1].encode()))
for down in (1, 0):
    t.XTestFakeKeyEvent(d, code, down, 0); x.XFlush(d); time.sleep(0.05)
print('pressed', sys.argv[1], code)
