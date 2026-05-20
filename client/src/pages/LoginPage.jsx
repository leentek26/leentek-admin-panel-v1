import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function LoginPage() {
  const { admin, login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (loading) return null;
  if (admin) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (e) {
      setErr(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Brand gradient halo behind the card */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-30 blur-3xl bg-brand-gradient pointer-events-none"
      />
      <div className="w-full max-w-md card relative z-10">
        <div className="flex flex-col items-center mb-6">
          <img
            src="/logo.png"
            alt="Leentek"
            className="h-16 w-auto mb-3 drop-shadow-[0_0_18px_rgba(232,118,42,0.35)]"
          />
          <div className="text-sm text-ink-300">License Admin · لوحة الإدارة</div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Email · البريد الإلكتروني</label>
            <input
              className="input"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@leentek.local"
              required
            />
          </div>
          <div>
            <label className="label">Password · كلمة المرور</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {err && (
            <div className="text-sm bg-brand-red/10 border border-brand-red/40 text-brand-red rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in · دخول'}
          </button>
        </form>

        <div className="mt-6 text-[11px] text-ink-500 text-center">
          Default bootstrap admin uses ADMIN_EMAIL / ADMIN_PASSWORD from .env
        </div>
      </div>
    </div>
  );
}
