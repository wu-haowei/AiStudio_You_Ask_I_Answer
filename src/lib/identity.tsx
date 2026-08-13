import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Who the current browser tab is playing as.
 *
 * Identity is simply the name the person typed on the entry screen. It is kept
 * per tab (sessionStorage) so two windows on one machine can play against each
 * other, and mirrored to localStorage so a normal reload restores the session.
 */

const SESSION_KEY = 'milktea_coplay_session_name';
const LOCAL_KEY = 'milktea_coplay_name';

interface IdentityValue {
  /** Empty string when nobody is signed in. */
  name: string;
  isSignedIn: boolean;
  signIn: (name: string) => void;
  signOut: () => void;
}

const IdentityContext = createContext<IdentityValue | null>(null);

const readStoredName = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(LOCAL_KEY) || '';
  } catch {
    return '';
  }
};

export const IdentityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [name, setName] = useState<string>(readStoredName);

  const signIn = useCallback((next: string) => {
    const clean = next.trim();
    if (!clean) return;
    try {
      sessionStorage.setItem(SESSION_KEY, clean);
      localStorage.setItem(LOCAL_KEY, clean);
    } catch {
      // storage may be unavailable in private mode — the session still works
    }
    setName(clean);
  }, []);

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LOCAL_KEY);
    } catch {
      // ignore
    }
    setName('');
  }, []);

  const value = useMemo(
    () => ({ name, isSignedIn: !!name, signIn, signOut }),
    [name, signIn, signOut]
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
};

export const useIdentity = (): IdentityValue => {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used inside <IdentityProvider>');
  return ctx;
};
