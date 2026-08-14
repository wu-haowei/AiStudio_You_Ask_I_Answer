import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {IdentityProvider} from './lib/identity.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IdentityProvider>
      <App />
    </IdentityProvider>
  </StrictMode>,
);

/*
 * Register the cache-free service worker. It only exists to make the app
 * installable on a phone's home screen — every request still goes to the
 * network, so there is no stale-asset behaviour to reason about.
 */
const isProduction = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD;

if ('serviceWorker' in navigator && isProduction) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI).href)
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}
