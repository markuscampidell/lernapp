import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cloudEnabled, friendly, MIN_PASSWORD, supabase, usernameToEmail, USERNAME_RE } from './supabase';

export interface User {
  id: string;
  username: string;
}

interface AuthValue {
  /** Ist ein Server eingetragen (src/cloud/supabase.ts)? */
  enabled: boolean;
  ready: boolean;
  user: User | null;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (password: string) => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

type SessionUser = { id: string; user_metadata?: Record<string, unknown> } | null | undefined;
const toUser = (u: SessionUser): User | null =>
  u ? { id: u.id, username: String(u.user_metadata?.username ?? '') } : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!cloudEnabled);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUser(toUser(data.session?.user));
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser((prev) => {
        const next = toUser(session?.user);
        // Gleiche Person -> altes Objekt behalten (verhindert unnötiges Neuladen bei Token-Erneuerung).
        return prev && next && prev.id === next.id && prev.username === next.username ? prev : next;
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    if (!supabase) throw new Error('Kein Server eingerichtet.');
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) {
      if (/invalid login credentials/i.test(error.message)) throw new Error('Benutzername oder Passwort ist falsch.');
      throw new Error(friendly(error.message));
    }
  }, []);

  const signUp = useCallback(async (username: string, password: string) => {
    if (!supabase) throw new Error('Kein Server eingerichtet.');
    const name = username.trim();
    if (!USERNAME_RE.test(name)) {
      throw new Error('Benutzername: 3–20 Zeichen, nur Buchstaben, Ziffern, „-“ und „_“ (Beginn mit Buchstabe oder Ziffer).');
    }
    if (password.length < MIN_PASSWORD) throw new Error(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
    const taken = await supabase.rpc('username_taken', { name });
    if (taken.error) throw new Error(friendly(taken.error.message));
    if (taken.data) throw new Error('Dieser Benutzername ist schon vergeben.');
    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(name),
      password,
      options: { data: { username: name } },
    });
    if (error) {
      if (/already registered|already exists/i.test(error.message)) throw new Error('Dieser Benutzername ist schon vergeben.');
      if (/password/i.test(error.message)) throw new Error('Das Passwort ist zu schwach.');
      throw new Error(friendly(error.message));
    }
    if (!data.session) throw new Error('Registriert, aber nicht angemeldet – in Supabase muss „Confirm email“ ausgeschaltet sein.');
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut().catch(() => {});
    setUser(null);
  }, []);

  const changePassword = useCallback(async (password: string) => {
    if (!supabase) return;
    if (password.length < MIN_PASSWORD) throw new Error(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(friendly(error.message));
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ enabled: cloudEnabled, ready, user, signIn, signUp, signOut, changePassword }),
    [ready, user, signIn, signUp, signOut, changePassword],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth außerhalb von AuthProvider');
  return v;
}
