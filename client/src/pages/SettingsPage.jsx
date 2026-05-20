import { useEffect, useState } from 'react';
import { get, post, del } from '../api';
import { useAuth } from '../auth.jsx';

const ADMIN_ROLES = new Set(['role-superadmin', 'role-admin']);

export default function SettingsPage() {
  const { user, hasPermission, refreshMe } = useAuth();
  const [profile, setProfile] = useState({ name: '', phone: '' });
  const [pwd, setPwd] = useState({ current_password: '', new_password: '' });
  const [profileMsg, setProfileMsg] = useState(null);
  const [pwdMsg, setPwdMsg] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessErr, setSessErr] = useState('');

  const isSuper = user?.role_id === 'role-superadmin';
  const isAdmin = ADMIN_ROLES.has(user?.role_id);
  const canManageSettings = hasPermission('settings.manage');

  useEffect(() => {
    if (user) {
      setProfile({ name: user.name || '', phone: user.phone || '' });
    }
  }, [user]);

  async function loadSessions() {
    if (!canManageSettings) return;
    try {
      setSessions(await get('/api/auth/sessions'));
    } catch (e) {
      setSessErr(e.message);
    }
  }
  useEffect(() => {
    loadSessions();
  }, [canManageSettings]);

  async function saveProfile(e) {
    e.preventDefault();
    setProfileMsg(null);
    try {
      await post('/api/auth/update-profile', profile);
      await refreshMe();
      setProfileMsg({ kind: 'ok', text: 'Profile updated · تم التحديث' });
    } catch (e) {
      setProfileMsg({ kind: 'err', text: e.message });
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwdMsg(null);
    try {
      await post('/api/auth/change-password', pwd);
      setPwd({ current_password: '', new_password: '' });
      setPwdMsg({
        kind: 'ok',
        text: 'Password changed — other sessions signed out · تم تغيير كلمة المرور',
      });
      await loadSessions();
    } catch (e) {
      setPwdMsg({ kind: 'err', text: e.message });
    }
  }

  async function terminate(id) {
    if (!confirm('Force-terminate this session? · إنهاء الجلسة؟')) return;
    try {
      await del('/api/auth/sessions/' + id);
      loadSessions();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="text-sm text-slate-400">الإعدادات</div>
      </div>

      <section className="card space-y-4">
        <div>
          <div className="text-lg font-semibold">Profile · الملف الشخصي</div>
          <div className="text-xs text-slate-400">
            You can update your display name and phone. Email/login and password are managed by
            an administrator.
          </div>
        </div>
        <form onSubmit={saveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Name · الاسم</label>
            <input
              className="input"
              required
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Phone · الهاتف</label>
            <input
              className="input"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />
          </div>
          {/* Email is shown read-only for reference; cannot be edited here. */}
          <div className="md:col-span-2">
            <label className="label">Email / login (read-only)</label>
            <input className="input opacity-70" value={user?.email || ''} disabled readOnly />
          </div>
          <div className="md:col-span-2 flex items-center gap-4">
            <button className="btn-primary" type="submit">
              Save profile
            </button>
            {profileMsg && (
              <span
                className={
                  profileMsg.kind === 'ok' ? 'text-emerald-400 text-sm' : 'text-rose-400 text-sm'
                }
              >
                {profileMsg.text}
              </span>
            )}
          </div>
        </form>
      </section>

      {isAdmin ? (
        <section className="card space-y-4">
          <div>
            <div className="text-lg font-semibold">Change password · تغيير كلمة المرور</div>
            <div className="text-xs text-slate-400">
              Only administrators can change their own password. For other employees, ask an admin
              to reset it from the Employees page.
            </div>
          </div>
          <form onSubmit={changePassword} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Current password</label>
              <input
                className="input"
                type="password"
                required
                value={pwd.current_password}
                onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })}
              />
            </div>
            <div>
              <label className="label">New password (min 8, Aa1)</label>
              <input
                className="input"
                type="password"
                required
                value={pwd.new_password}
                onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })}
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-4">
              <button className="btn-primary" type="submit">
                Change password
              </button>
              {pwdMsg && (
                <span
                  className={
                    pwdMsg.kind === 'ok' ? 'text-emerald-400 text-sm' : 'text-rose-400 text-sm'
                  }
                >
                  {pwdMsg.text}
                </span>
              )}
            </div>
          </form>
        </section>
      ) : (
        <section className="card border-slate-700/60">
          <div className="text-sm text-slate-300">
            <span className="font-semibold text-slate-100">Password & login</span> — managed by an
            administrator. Need a password reset? Ask a Super Admin or Admin.
          </div>
        </section>
      )}

      {canManageSettings && (
        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Active sessions · الجلسات النشطة</div>
              <div className="text-xs text-slate-400">
                Super Admin can force-terminate any session.
              </div>
            </div>
            <button className="btn-secondary text-sm" onClick={loadSessions}>
              Refresh
            </button>
          </div>
          {sessErr && <div className="text-rose-400 text-sm">{sessErr}</div>}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/60">
                <tr>
                  <th className="table-th">Employee</th>
                  <th className="table-th">IP</th>
                  <th className="table-th">User agent</th>
                  <th className="table-th">Created</th>
                  <th className="table-th">Expires</th>
                  <th className="table-th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/40">
                    <td className="table-td">
                      <div className="font-medium">{s.employee_name}</div>
                      <div className="text-xs text-slate-400">{s.employee_email}</div>
                    </td>
                    <td className="table-td font-mono text-xs">{s.ip_address}</td>
                    <td className="table-td text-xs text-slate-400 max-w-xs truncate">
                      {s.user_agent}
                    </td>
                    <td className="table-td text-xs">{s.created_at}</td>
                    <td className="table-td text-xs">{s.expires_at}</td>
                    <td className="table-td text-right">
                      <button
                        className="text-rose-400 hover:underline text-sm"
                        onClick={() => terminate(s.id)}
                      >
                        Force logout
                      </button>
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan="6" className="table-td text-center text-slate-500 py-8">
                      No active sessions
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isSuper && (
        <section className="card border-amber-500/40">
          <div className="text-amber-400 text-xs uppercase tracking-wider mb-2">
            Super Admin · مدير عام
          </div>
          <div className="text-sm text-slate-300">
            This account cannot be deleted or suspended. Change your own password above; reset
            another employee&apos;s from the Employees page.
          </div>
        </section>
      )}
    </div>
  );
}
