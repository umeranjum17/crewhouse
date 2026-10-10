import './src/random'; // before anything loads @byokit/pair (libsodium wants crypto.getRandomValues)
import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import App from './App';
import { PANEL } from './src/bubble';
import { Panel } from './src/panel';

registerRootComponent(App);
AppRegistry.registerComponent(PANEL, () => Panel); // the bubble's panel, over other apps (src/bubble.ts)
