import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, get, post, setAccessToken } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const me = await get('/api/auth/me');
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  // On mount, try to refresh — gives us a session if the httpOnly cookie is still valid
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (r.ok) {
          const { accessToken } = await r.json();
          setAccessToken(accessToken);
          await refreshMe();
        }
      } catch {
        /* not logged in */
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshMe]);

  const login = useCallback(async (email, password) => {
    const data = await post('/api/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (code) => {
      if (!user) return false;
      if (user.role_id === 'role-superadmin') return true;
      return Array.isArray(user.permissions) && user.permissions.includes(code);
    },
    [user]
  );

  return (
    <AuthCtx.Provider
      value={{ user, admin: user, loading, login, logout, hasPermission, refreshMe }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
