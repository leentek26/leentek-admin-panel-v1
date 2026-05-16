import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, post, setAccessToken } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, try to refresh — gives us a session if the httpOnly cookie is still valid
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (r.ok) {
          const { accessToken } = await r.json();
          setAccessToken(accessToken);
          // crude decode — only used for email display; trust on server.
          const payload = JSON.parse(atob(accessToken.split('.')[1]));
          setAdmin({ email: payload.email });
        }
      } catch {
        /* not logged in */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await post('/api/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setAdmin(data.admin);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    setAdmin(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ admin, loading, login, logout }}>{children}</AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
