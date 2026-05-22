import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../api';
import { useAuth } from '../auth.jsx';
import TableSkeleton from '../components/TableSkeleton.jsx';
import PageProgress from '../components/PageProgress.jsx';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';
import PhoneInput from '../components/PhoneInput.jsx';

const ADMIN_ROLE_IDS = new Set(['role-superadmin', 'role-admin']);

const STATUS_BADGE = {
  active: 'badge-active',
  suspended: 'badge-suspended',
  inactive: 'badge-inactive',
};

const ROLE_BADGE_TONE = {
  'role-superadmin': 'bg-brand-orange/15 border-brand-orange/40 text-brand-orange',
  'role-admin': 'bg-brand-magenta/15 border-brand-magenta/40 text-brand-magenta',
  'role-license-mgr': 'bg-brand-cyan/15 border-brand-cyan/40 text-brand-cyan',
  'role-support': 'bg-brand-purple/30 border-brand-purple/50 text-ink-100',
  'role-viewer': 'bg-ink-700/40 border-ink-700 text-ink-300',
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState(null); // row id being suspend/activated
  const [resetBusy, setResetBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Reset-password flow
  const [resetForId, setResetForId] = useState(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetReveal, setResetReveal] = useState(null); // { name, email, password }

  // Hard-delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null); // employee row

  const canCreate = hasPermission('employees.create');
  const canEdit = hasPermission('employees.edit');
  // Hard delete is restricted to Admin / Super Admin (mirrors server requireAdminRole)
  const canDelete =
    ADMIN_ROLE_IDS.has(user?.role_id) && hasPermission('employees.delete');
  const canSuspend = hasPermission('employees.delete');
  const myLevel = user?.role_level ?? 0;

  async function load({ initial = false } = {}) {
    setErr('');
    if (initial) setLoading(true);
    else setRefreshing(true);
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
    } finally {
      if (initial) setLoading(false);
      else setRefreshing(false);
    }
  }
  useEffect(() => {
    load({ initial: true });
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
    setActingId(emp.id);
    try {
      await post(`/api/employees/${emp.id}/suspend`, {});
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setActingId(null);
    }
  }
  async function activate(emp) {
    setActingId(emp.id);
    try {
      await post(`/api/employees/${emp.id}/activate`, {});
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setActingId(null);
    }
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await del('/api/employees/' + deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      alert(e.message);
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
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
    setResetBusy(true);
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
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setResetBusy(false);
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
    return canSuspend && canActOn(emp) && emp.id !== user?.id;
  }
  function canDeleteRow(emp) {
    return canDelete && canActOn(emp) && emp.id !== user?.id;
  }
  function canResetRow(emp) {
    return canEdit && canActOn(emp);
  }

  return (
    <div className="space-y-6">
      <PageProgress active={refreshing} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Employees</h1>
        {canCreate && (
          <button className="btn-primary" onClick={startNew}>
            + Add employee
          </button>
        )}
      </div>

      {err && (
        <div className="text-brand-red text-sm bg-brand-red/10 border border-brand-red/30 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="card grid grid-cols-1 md:grid-cols-2 gap-4 relative">
          <button
            type="button"
            aria-label="Close"
            onClick={cancel}
            className="absolute top-3 right-3 h-8 w-8 inline-flex items-center justify-center rounded-md text-ink-300 hover:text-brand-orange hover:bg-cardAlt transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
          <div className="md:col-span-2 text-sm font-semibold text-ink-100 pr-8">
            {editing === 'new' ? 'New employee' : 'Edit employee'}
          </div>

          <div>
            <label className="label">Full name *</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email / login *</label>
            <input
              className="input"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <PhoneInput
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
          </div>
          <div>
            <label className="label">Department</label>
            <input
              className="input"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <label className="label">Role *</label>
            <select
              className="input"
              required
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
            >
              <option value="">— select role —</option>
              {assignableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (level {r.role_level})
                </option>
              ))}
            </select>
            {selectedRole?.description && (
              <div className="text-xs text-ink-300 mt-2 italic">{selectedRole.description}</div>
            )}
          </div>

          {selectedRolePerms && (
            <div className="md:col-span-2 bg-page/40 border border-line rounded-lg p-3">
              <div className="text-xs uppercase tracking-wider text-ink-300 mb-2">
                Permissions granted by this role ({selectedRolePerms.length})
              </div>
              {selectedRolePerms.length === 0 ? (
                <div className="text-sm text-ink-500">No permissions assigned</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                  {Object.entries(permsByCategory).map(([cat, group]) => (
                    <div key={cat}>
                      <div className="text-xs text-brand-cyan mt-1">
                        {cat}
                      </div>
                      {group.items.map((p) => (
                        <div key={p.id} className="text-sm text-ink-300 pl-2">
                          {p.name}
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
                  <span className="label !mb-0">Password * (min 8, Aa1)</span>
                  <button
                    type="button"
                    className="text-brand-cyan hover:underline text-[11px]"
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
                <label className="label">Confirm password</label>
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
            <span className="text-xs uppercase tracking-wider text-ink-300">
              Status
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
                <span className={s === 'active' ? 'text-brand-cyan' : 'text-brand-orange'}>{s}</span>
              </label>
            ))}
          </div>

          <div className="md:col-span-2 flex gap-3">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? <Spinner /> : editing === 'new' ? 'Create employee' : 'Save changes'}
            </button>
            <button className="btn-secondary" type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {resetForId && (
        <form onSubmit={doReset} className="card border-brand-orange/40 space-y-3 relative">
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setResetForId(null);
              setResetPwd('');
              setResetConfirm('');
            }}
            className="absolute top-3 right-3 h-8 w-8 inline-flex items-center justify-center rounded-md text-ink-300 hover:text-brand-orange hover:bg-cardAlt transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
          <div className="text-sm font-semibold text-brand-orange pr-8">
            Reset password
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label !mb-0">New password (min 8, Aa1)</span>
                <button
                  type="button"
                  className="text-brand-cyan hover:underline text-[11px]"
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
            <button className="btn-primary" type="submit" disabled={resetBusy}>
              {resetBusy ? <Spinner /> : 'Reset password'}
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
          <thead className="bg-page/60">
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
          {loading ? (
            <TableSkeleton columns={8} rows={6} />
          ) : (
            <tbody className="row-stripe">
              {rows.map((r) => (
                <tr key={r.id} className={`status-${r.status}`}>
                  <td className="table-td font-mono text-brand-cyan">{r.employee_code}</td>
                  <td className="table-td">{r.name}</td>
                  <td className="table-td text-ink-300">{r.email}</td>
                  <td className="table-td">
                    <span
                      className={`id-mono text-[11px] px-2 py-0.5 rounded border ${
                        ROLE_BADGE_TONE[r.role_id] || 'bg-ink-300/10 border-line text-ink-300'
                      }`}
                    >
                      {r.role_name || r.role_id}
                    </span>
                  </td>
                  <td className="table-td text-ink-300 text-sm">{r.department || '—'}</td>
                  <td className="table-td"><span className={STATUS_BADGE[r.status] || 'badge-inactive'}>{r.status}</span></td>
                  <td className="table-td text-xs text-ink-300">{r.last_login || '—'}</td>
                  <td className="table-td text-right space-x-3 whitespace-nowrap">
                    {canEditRow(r) && (
                      <button
                        className="text-brand-cyan hover:underline text-sm"
                        onClick={() => startEdit(r)}
                      >
                        Edit
                      </button>
                    )}
                    {canResetRow(r) && (
                      <button
                        className="text-brand-orange hover:underline text-sm"
                        onClick={() => startReset(r)}
                      >
                        Reset pw
                      </button>
                    )}
                    {canSuspendRow(r) &&
                      (r.status === 'active' ? (
                        <button
                          className="text-brand-orange hover:underline text-sm"
                          onClick={() => suspend(r)}
                          disabled={actingId === r.id}
                        >
                          {actingId === r.id ? <Spinner /> : 'Suspend'}
                        </button>
                      ) : (
                        <button
                          className="text-status-green hover:underline text-sm"
                          onClick={() => activate(r)}
                          disabled={actingId === r.id}
                        >
                          {actingId === r.id ? <Spinner /> : 'Activate'}
                        </button>
                      ))}
                    {canDeleteRow(r) && (
                      <button
                        className="text-brand-red hover:underline text-sm"
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
                  <td colSpan="8" className="table-td text-center text-ink-500 py-8">
                    No employees yet
                  </td>
                </tr>
              )}
            </tbody>
          )}
        </table>
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={() => !deleteBusy && setDeleteTarget(null)}
        maxWidth="max-w-md"
        className="border-brand-red/40"
        closeOnBackdrop={!deleteBusy}
        title={deleteTarget ? 'Delete employee' : ''}
      >
        {deleteTarget && (
          <>
            <div className="text-sm text-ink-100 leading-relaxed">
              Are you sure you want to delete{' '}
              <span className="font-semibold">{deleteTarget.name}</span>?
            </div>
            <div className="flex gap-3 justify-end mt-5">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmDelete} disabled={deleteBusy} autoFocus>
                {deleteBusy ? <Spinner /> : 'Delete'}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={!!resetReveal}
        onClose={() => setResetReveal(null)}
        maxWidth="max-w-md"
        className="border-brand-orange/40"
      >
        {resetReveal && (
          <>
            <div className="text-lg font-semibold text-brand-orange mb-2 pr-8">
              Password reset · share it now
            </div>
            <div className="text-sm text-ink-300 mb-3">
              New password for{' '}
              <span className="font-semibold text-ink-100">{resetReveal.name}</span> (
              {resetReveal.email}). This is the <strong>only</strong> time it will be shown.
            </div>
            <div className="font-mono text-base bg-page border border-line rounded p-3 text-brand-cyan break-all select-all">
              {resetReveal.password}
            </div>
            <div className="text-[11px] text-ink-500 mt-2">
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
          </>
        )}
      </Modal>
    </div>
  );
}
