import './src/random'; // before anything loads @byokit/link (libsodium wants crypto.getRandomValues)
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
