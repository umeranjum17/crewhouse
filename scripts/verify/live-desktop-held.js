// live-desktop's stand-in for a stream that has not come up yet: the desktop socket never opens, so the panel stays on its
// starting state long enough to look at. Runs before the app boots (GATE_INIT). Only /ws/desktop/ is held; everything else is real.
const Real = window.WebSocket;
window.WebSocket = function (url, protocols) {
  if (!String(url).includes('/ws/desktop/')) return new Real(url, protocols);
  return Object.assign(new EventTarget(), { readyState: 0, url: String(url), send() {}, close() {} });
};
Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, prototype: Real.prototype });
