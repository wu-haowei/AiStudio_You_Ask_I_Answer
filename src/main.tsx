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
