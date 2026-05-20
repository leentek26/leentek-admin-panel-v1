import { useEffect, useState } from 'react';
import { get, post, put, del } from '../api';
import { useAuth } from '../auth.jsx';

const STATUS_COLORS = {
  active: 'text-emerald-400',
  suspended: 'text-amber-400',
  inactive: 'text-slate-500',
};

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  password: '',
  role_id: '',
  department: '',
  status: 'active',
};

export default function EmployeesPage() {
  const { hasPermission, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [resetForId, setResetForId] = useState(null);
  const [resetPwd, setResetPwd] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const canCreate = hasPermission('employees.create');
  const canEdit = hasPermission('employees.edit');
  const canDelete = hasPermission('employees.delete');

  async function load() {
    setErr('');
    try {
      const [e, r] = await Promise.all([get('/api/employees'), get('/api/roles')]);
      setRows(e);
      setRoles(r);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setForm({ ...emptyForm, role_id: roles[0]?.id || '' });
    setEditing('new');
  }
  function startEdit(emp) {
    setForm({
      name: emp.name,
      email: emp.email,
      phone: emp.phone || '',
      password: '',
      role_id: emp.role_id || '',
      department: emp.department || '',
      status: emp.status,
    });
    setEditing(emp.id);
  }
  function cancel() {
    setEditing(null);
    setForm(emptyForm);
    setErr('');
  }

  async function save(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (editing === 'new') {
        await post('/api/employees', form);
      } else {
        const { password, ...rest } = form;
        await put('/api/employees/' + editing, rest);
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
    if (!confirm(`Suspend ${emp.name}? · تعليق؟`)) return;
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
  async function remove(emp) {
    if (!confirm(`Delete (deactivate) ${emp.name}? · حذف؟`)) return;
    try {
      await del('/api/employees/' + emp.id);
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function doReset(e) {
    e.preventDefault();
    try {
      await post(`/api/employees/${resetForId}/reset-password`, {
        new_password: resetPwd,
      });
      setResetForId(null);
      setResetPwd('');
      alert('Password reset · تم إعادة التعيين');
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <div className="text-sm text-slate-400">الموظفون</div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive · إظهار المحذوفين
          </label>
          {canCreate && (
            <button className="btn-primary" onClick={startNew}>
              + Add employee · إضافة
            </button>
          )}
        </div>
      </div>

      {err && <div className="text-rose-400 text-sm">{err}</div>}

      {editing && (
        <form onSubmit={save} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Name · الاسم</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email · البريد</label>
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
          <div>
            <label className="label">Role · الدور</label>
            <select
              className="input"
              required
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
              disabled={editing !== 'new' && editing === user?.id}
            >
              <option value="">— select —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.name_ar}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status · الحالة</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="inactive">inactive</option>
            </select>
          </div>
          {editing === 'new' && (
            <div className="md:col-span-2">
              <label className="label">Password · كلمة المرور (min 8, Aa1)</label>
              <input
                className="input"
                type="password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          )}
          <div className="md:col-span-2 flex gap-3">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : editing === 'new' ? 'Create' : 'Save'}
            </button>
            <button className="btn-secondary" type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {resetForId && (
        <form onSubmit={doReset} className="card border-amber-500/40 flex gap-3 items-end">
          <div className="flex-1">
            <label className="label">New password</label>
            <input
              className="input"
              type="password"
              required
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
            />
          </div>
          <button className="btn-primary" type="submit">
            Reset
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              setResetForId(null);
              setResetPwd('');
            }}
          >
            Cancel
          </button>
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
              <th className="table-th">Status</th>
              <th className="table-th">Last login</th>
              <th className="table-th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(showInactive ? rows : rows.filter((r) => r.status !== 'inactive')).map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/40">
                <td className="table-td font-mono text-cyan-300">{r.employee_code}</td>
                <td className="table-td">{r.name}</td>
                <td className="table-td text-slate-300">{r.email}</td>
                <td className="table-td">
                  <span className="primary-id">{r.role_name || r.role_id}</span>
                </td>
                <td className={`table-td ${STATUS_COLORS[r.status]}`}>{r.status}</td>
                <td className="table-td text-xs text-slate-400">{r.last_login || '—'}</td>
                <td className="table-td text-right space-x-3">
                  {canEdit && (
                    <button
                      className="text-cyan-300 hover:underline text-sm"
                      onClick={() => startEdit(r)}
                    >
                      Edit
                    </button>
                  )}
                  {canEdit && (
                    <button
                      className="text-amber-300 hover:underline text-sm"
                      onClick={() => setResetForId(r.id)}
                    >
                      Reset pw
                    </button>
                  )}
                  {canDelete && r.id !== user?.id && r.role_id !== 'role-superadmin' && (
                    <>
                      {r.status === 'active' ? (
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
                      )}
                      {r.status !== 'inactive' && (
                        <button
                          className="text-rose-400 hover:underline text-sm"
                          onClick={() => remove(r)}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(showInactive ? rows : rows.filter((r) => r.status !== 'inactive')).length === 0 && (
              <tr>
                <td colSpan="7" className="table-td text-center text-slate-500 py-8">
                  {rows.length === 0
                    ? 'No employees yet · لا يوجد موظفون'
                    : 'No active employees — toggle "Show inactive" to see deleted ones'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
