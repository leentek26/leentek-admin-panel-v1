import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../api';
import { useAuth } from '../auth.jsx';

const STATUS_COLORS = {
  active: 'text-emerald-400',
  suspended: 'text-amber-400',
  inactive: 'text-slate-500',
};

const ROLE_BADGE_TONE = {
  'role-superadmin': 'bg-amber-400/15 border-amber-400/40 text-amber-300',
  'role-admin': 'bg-rose-400/15 border-rose-400/40 text-rose-300',
  'role-license-mgr': 'bg-cyan-400/15 border-cyan-400/40 text-cyan-300',
  'role-support': 'bg-emerald-400/15 border-emerald-400/40 text-emerald-300',
  'role-viewer': 'bg-slate-400/15 border-slate-400/40 text-slate-300',
};

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  department: '',
  password: '',
  confirm_password: '',
  role_id: '',
  status: 'active',
};

function generatePassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*+-=';
  const all = upper + lower + digits + symbols;
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  let p = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
  while (p.length < length) p += pick(all);
  return p.split('').sort(() => Math.random() - 0.5).join('');
}

function passwordPolicyError(pwd, confirm) {
  if (!pwd || pwd.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pwd)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(pwd)) return 'Password must include a lowercase letter';
  if (!/[0-9]/.test(pwd)) return 'Password must include a number';
  if (confirm !== undefined && pwd !== confirm) return 'Passwords do not match';
  return null;
}

export default function EmployeesPage() {
  const { hasPermission, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [allPerms, setAllPerms] = useState([]);
  const [rolePermsCache, setRolePermsCache] = useState({}); // roleId -> [perm]
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  // Reset-password flow
  const [resetForId, setResetForId] = useState(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetReveal, setResetReveal] = useState(null); // { name, email, password }

  // Hard-delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null); // employee row

  const canCreate = hasPermission('employees.create');
  const canEdit = hasPermission('employees.edit');
  const canDelete = hasPermission('employees.delete');
  const myLevel = user?.role_level ?? 0;

  async function load() {
    setErr('');
    try {
      const [e, r, p] = await Promise.all([
        get('/api/employees'),
        get('/api/roles'),
        get('/api/roles/permissions/all'),
      ]);
      setRows(e);
      setRoles(r);
      setAllPerms(p);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // Roles the current user is allowed to assign (strictly below their level).
  const assignableRoles = useMemo(
    () => roles.filter((r) => r.role_level < myLevel),
    [roles, myLevel]
  );

  const selectedRole = roles.find((r) => r.id === form.role_id);

  // Fetch + cache the permission set for the currently selected role
  useEffect(() => {
    if (!form.role_id || rolePermsCache[form.role_id]) return;
    let cancelled = false;
    get('/api/roles/' + form.role_id)
      .then((data) => {
        if (cancelled) return;
        setRolePermsCache((c) => ({ ...c, [form.role_id]: data.permissions }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [form.role_id, rolePermsCache]);

  const selectedRolePerms = form.role_id ? rolePermsCache[form.role_id] : null;

  // Group selected role permissions by category for the summary card
  const permsByCategory = useMemo(() => {
    if (!selectedRolePerms) return {};
    const out = {};
    for (const p of selectedRolePerms) {
      out[p.category] = out[p.category] || { label_ar: p.category_ar, items: [] };
      out[p.category].items.push(p);
    }
    return out;
  }, [selectedRolePerms]);

  function startNew() {
    setForm({
      ...emptyForm,
      role_id: assignableRoles[0]?.id || '',
    });
    setEditing('new');
    setErr('');
  }
  function startEdit(emp) {
    setForm({
      name: emp.name,
      email: emp.email,
      phone: emp.phone || '',
      department: emp.department || '',
      password: '',
      confirm_password: '',
      role_id: emp.role_id || '',
      status: emp.status,
    });
    setEditing(emp.id);
    setErr('');
  }
  function cancel() {
    setEditing(null);
    setForm(emptyForm);
    setErr('');
  }

  async function save(e) {
    e.preventDefault();
    setErr('');

    if (editing === 'new') {
      const pe = passwordPolicyError(form.password, form.confirm_password);
      if (pe) {
        setErr(pe);
        return;
      }
    }

    setBusy(true);
    try {
      if (editing === 'new') {
        const { confirm_password, ...payload } = form;
        await post('/api/employees', payload);
      } else {
        const { password, confirm_password, ...payload } = form;
        await put('/api/employees/' + editing, payload);
      }
      cancel();
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function suspend(emp) {
    try {
      await post(`/api/employees/${emp.id}/suspend`, {});
      load();
    } catch (e) {
      alert(e.message);
    }
  }
  async function activate(emp) {
    try {
      await post(`/api/employees/${emp.id}/activate`, {});
      load();
    } catch (e) {
      alert(e.message);
    }
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await del('/api/employees/' + deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch (e) {
      alert(e.message);
      setDeleteTarget(null);
    }
  }

  function startReset(emp) {
    setResetForId(emp.id);
    setResetPwd('');
    setResetConfirm('');
  }
  async function doReset(e) {
    e.preventDefault();
    const pe = passwordPolicyError(resetPwd, resetConfirm);
    if (pe) {
      alert(pe);
      return;
    }
    try {
      await post(`/api/employees/${resetForId}/reset-password`, {
        new_password: resetPwd,
      });
      const emp = rows.find((r) => r.id === resetForId);
      setResetReveal({
        name: emp?.name || '',
        email: emp?.email || '',
        password: resetPwd,
      });
      setResetForId(null);
      setResetPwd('');
      setResetConfirm('');
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  // Permission helpers — these mirror the server-side level guard so we can
  // hide actions the server would refuse anyway.
  function canActOn(emp) {
    return (emp.role_level ?? 0) < myLevel;
  }
  function canEditRow(emp) {
    return canEdit && canActOn(emp);
  }
  function canSuspendRow(emp) {
    return canDelete && canActOn(emp) && emp.id !== user?.id;
  }
  function canDeleteRow(emp) {
    return canDelete && canActOn(emp) && emp.id !== user?.id;
  }
  function canResetRow(emp) {
    return canEdit && canActOn(emp);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <div className="text-sm text-slate-400">الموظفون</div>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={startNew}>
            + Add employee · إضافة
          </button>
        )}
      </div>

      {err && (
        <div className="text-rose-300 text-sm bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 text-sm font-semibold text-slate-200">
            {editing === 'new' ? 'New employee · موظف جديد' : 'Edit employee · تعديل'}
          </div>

          <div>
            <label className="label">Full name · الاسم الكامل *</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email / login · البريد *</label>
            <input
              className="input"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Phone · الهاتف</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Department · القسم</label>
            <input
              className="input"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <label className="label">Role · الدور *</label>
            <select
              className="input"
              required
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
            >
              <option value="">— select role —</option>
              {assignableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.name_ar}  (level {r.role_level})
                </option>
              ))}
            </select>
            {selectedRole?.description && (
              <div className="text-xs text-slate-400 mt-2 italic">{selectedRole.description}</div>
            )}
          </div>

          {selectedRolePerms && (
            <div className="md:col-span-2 bg-slate-900/40 border border-slate-700 rounded-lg p-3">
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Permissions granted by this role ({selectedRolePerms.length})
              </div>
              {selectedRolePerms.length === 0 ? (
                <div className="text-sm text-slate-500">No permissions assigned</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                  {Object.entries(permsByCategory).map(([cat, group]) => (
                    <div key={cat}>
                      <div className="text-xs text-cyan-400 mt-1">
                        {cat} · {group.label_ar}
                      </div>
                      {group.items.map((p) => (
                        <div key={p.id} className="text-sm text-slate-300 flex justify-between pl-2">
                          <span>{p.name}</span>
                          <span className="text-xs text-slate-500">{p.name_ar}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {editing === 'new' && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="label !mb-0">Password · كلمة المرور * (min 8, Aa1)</span>
                  <button
                    type="button"
                    className="text-cyan-300 hover:underline text-[11px]"
                    onClick={() => {
                      const p = generatePassword(12);
                      setForm({ ...form, password: p, confirm_password: p });
                    }}
                  >
                    Generate random
                  </button>
                </div>
                <input
                  className="input font-mono"
                  type="text"
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Confirm password · تأكيد</label>
                <input
                  className="input font-mono"
                  type="text"
                  required
                  value={form.confirm_password}
                  onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="md:col-span-2 flex items-center gap-6">
            <span className="text-xs uppercase tracking-wider text-slate-400">
              Status · الحالة
            </span>
            {['active', 'suspended'].map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="status"
                  value={s}
                  checked={form.status === s}
                  onChange={() => setForm({ ...form, status: s })}
                />
                <span className={s === 'active' ? 'text-emerald-400' : 'text-amber-400'}>{s}</span>
              </label>
            ))}
          </div>

          <div className="md:col-span-2 flex gap-3">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : editing === 'new' ? 'Create employee' : 'Save changes'}
            </button>
            <button className="btn-secondary" type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {resetForId && (
        <form onSubmit={doReset} className="card border-amber-500/40 space-y-3">
          <div className="text-sm font-semibold text-amber-300">
            Reset password · إعادة تعيين كلمة المرور
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label !mb-0">New password (min 8, Aa1)</span>
                <button
                  type="button"
                  className="text-cyan-300 hover:underline text-[11px]"
                  onClick={() => {
                    const p = generatePassword(12);
                    setResetPwd(p);
                    setResetConfirm(p);
                  }}
                >
                  Generate random
                </button>
              </div>
              <input
                className="input font-mono"
                type="text"
                required
                value={resetPwd}
                onChange={(e) => setResetPwd(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Confirm</label>
              <input
                className="input font-mono"
                type="text"
                required
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button className="btn-primary" type="submit">
              Reset password
            </button>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setResetForId(null);
                setResetPwd('');
                setResetConfirm('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-900/60">
            <tr>
              <th className="table-th">Code</th>
              <th className="table-th">Name</th>
              <th className="table-th">Email</th>
              <th className="table-th">Role</th>
              <th className="table-th">Dept.</th>
              <th className="table-th">Status</th>
              <th className="table-th">Last login</th>
              <th className="table-th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/40">
                <td className="table-td font-mono text-cyan-300">{r.employee_code}</td>
                <td className="table-td">{r.name}</td>
                <td className="table-td text-slate-300">{r.email}</td>
                <td className="table-td">
                  <span
                    className={`id-mono text-[11px] px-2 py-0.5 rounded border ${
                      ROLE_BADGE_TONE[r.role_id] || 'bg-slate-400/10 border-slate-700 text-slate-300'
                    }`}
                  >
                    {r.role_name || r.role_id}
                  </span>
                </td>
                <td className="table-td text-slate-400 text-sm">{r.department || '—'}</td>
                <td className={`table-td ${STATUS_COLORS[r.status]}`}>{r.status}</td>
                <td className="table-td text-xs text-slate-400">{r.last_login || '—'}</td>
                <td className="table-td text-right space-x-3 whitespace-nowrap">
                  {canEditRow(r) && (
                    <button
                      className="text-cyan-300 hover:underline text-sm"
                      onClick={() => startEdit(r)}
                    >
                      Edit
                    </button>
                  )}
                  {canResetRow(r) && (
                    <button
                      className="text-amber-300 hover:underline text-sm"
                      onClick={() => startReset(r)}
                    >
                      Reset pw
                    </button>
                  )}
                  {canSuspendRow(r) &&
                    (r.status === 'active' ? (
                      <button
                        className="text-amber-400 hover:underline text-sm"
                        onClick={() => suspend(r)}
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        className="text-emerald-400 hover:underline text-sm"
                        onClick={() => activate(r)}
                      >
                        Activate
                      </button>
                    ))}
                  {canDeleteRow(r) && (
                    <button
                      className="text-rose-400 hover:underline text-sm"
                      onClick={() => setDeleteTarget(r)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan="8" className="table-td text-center text-slate-500 py-8">
                  No employees yet · لا يوجد موظفون
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card border-rose-500/40 max-w-md w-full">
            <div className="text-lg font-semibold text-rose-300 mb-2">
              Permanently delete employee?
            </div>
            <div className="text-sm text-slate-300 mb-2">
              Are you sure you want to permanently delete{' '}
              <span className="font-semibold text-slate-100">{deleteTarget.name}</span>{' '}
              <span className="font-mono text-cyan-300">({deleteTarget.employee_code})</span>?
            </div>
            <div className="text-xs text-amber-400 mb-4">
              This is a hard delete — the record is removed from the database and cannot be
              recovered. All sessions for this employee will be terminated.
            </div>
            <div className="flex gap-3 justify-end">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmDelete}>
                Yes, delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {resetReveal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card border-amber-500/40 max-w-md w-full">
            <div className="text-lg font-semibold text-amber-300 mb-2">
              Password reset · share it now
            </div>
            <div className="text-sm text-slate-300 mb-3">
              New password for{' '}
              <span className="font-semibold text-slate-100">{resetReveal.name}</span> (
              {resetReveal.email}). This is the <strong>only</strong> time it will be shown.
            </div>
            <div className="font-mono text-base bg-slate-950 border border-slate-700 rounded p-3 text-emerald-300 break-all select-all">
              {resetReveal.password}
            </div>
            <div className="text-[11px] text-slate-500 mt-2">
              The password is bcrypt-hashed on the server and never recoverable from there.
            </div>
            <div className="flex gap-3 justify-end mt-4">
              <button
                className="btn-secondary"
                onClick={() => navigator.clipboard.writeText(resetReveal.password)}
              >
                Copy
              </button>
              <button className="btn-primary" onClick={() => setResetReveal(null)}>
                I have saved it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
