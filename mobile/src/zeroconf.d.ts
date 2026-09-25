// react-native-zeroconf ships no types: only the part mobile/src/link.ts uses.
declare module 'react-native-zeroconf' {
  export default class Zeroconf {
    on(event: 'resolved', fn: (s: { txt?: Record<string, string> }) => void): void;
    on(event: 'error', fn: (e: unknown) => void): void;
    scan(type: string, protocol: string, domain: string): void;
    stop(): void;
    removeDeviceListeners(): void;
  }
}
