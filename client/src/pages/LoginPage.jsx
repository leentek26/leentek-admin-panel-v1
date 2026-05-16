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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-cyan-400">Leentek</div>
          <div className="text-sm text-slate-400">License Admin · لوحة الإدارة</div>
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
            <div className="text-sm bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in · دخول'}
          </button>
        </form>

        <div className="mt-6 text-[11px] text-slate-500 text-center">
          Default bootstrap admin uses ADMIN_EMAIL / ADMIN_PASSWORD from .env
        </div>
      </div>
    </div>
  );
}
