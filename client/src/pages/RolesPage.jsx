import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../api';
import { useAuth } from '../auth.jsx';

export default function RolesPage() {
  const { hasPermission } = useAuth();
  const [roles, setRoles] = useState([]);
  const [allPerms, setAllPerms] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [permsByRole, setPermsByRole] = useState({}); // roleId -> Set of permission ids
  const [pending, setPending] = useState({}); // roleId -> Set (unsaved edits)
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', name_ar: '', description: '' });

  const canManage = hasPermission('roles.manage');

  async function load() {
    setErr('');
    try {
      const [r, p] = await Promise.all([
        get('/api/roles'),
        get('/api/roles/permissions/all'),
      ]);
      setRoles(r);
      setAllPerms(p);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const permsByCategory = useMemo(() => {
    const groups = {};
    for (const p of allPerms) {
      groups[p.category] = groups[p.category] || { label_ar: p.category_ar, items: [] };
      groups[p.category].items.push(p);
    }
    return groups;
  }, [allPerms]);

  async function expand(role) {
    if (expandedId === role.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(role.id);
    if (permsByRole[role.id]) return;
    try {
      const detail = await get('/api/roles/' + role.id);
      const ids = new Set(detail.permissions.map((p) => p.id));
      setPermsByRole((s) => ({ ...s, [role.id]: ids }));
      setPending((s) => ({ ...s, [role.id]: new Set(ids) }));
    } catch (e) {
      setErr(e.message);
    }
  }

  function togglePerm(roleId, permId) {
    setPending((s) => {
      const next = new Set(s[roleId] || []);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return { ...s, [roleId]: next };
    });
  }

  function isDirty(roleId) {
    const a = permsByRole[roleId];
    const b = pending[roleId];
    if (!a || !b) return false;
    if (a.size !== b.size) return true;
    for (const x of a) if (!b.has(x)) return true;
    return false;
  }

  async function savePerms(role) {
    try {
      const ids = Array.from(pending[role.id] || []);
      await put(`/api/roles/${role.id}/permissions`, { permission_ids: ids });
      setPermsByRole((s) => ({ ...s, [role.id]: new Set(ids) }));
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function createRole(e) {
    e.preventDefault();
    try {
      await post('/api/roles', { ...newRole, permission_ids: [] });
      setCreating(false);
      setNewRole({ name: '', name_ar: '', description: '' });
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function removeRole(role) {
    if (!confirm(`Delete role "${role.name}"? · حذف؟`)) return;
    try {
      await del('/api/roles/' + role.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles &amp; Permissions</h1>
          <div className="text-sm text-slate-400">الأدوار والصلاحيات</div>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setCreating(!creating)}>
            + Custom role · دور مخصص
          </button>
        )}
      </div>

      {err && <div className="text-rose-400 text-sm">{err}</div>}

      {creating && (
        <form onSubmit={createRole} className="card grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Name (English)</label>
            <input
              className="input"
              required
              value={newRole.name}
              onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Name (Arabic)</label>
            <input
              className="input"
              required
              value={newRole.name_ar}
              onChange={(e) => setNewRole({ ...newRole, name_ar: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Description</label>
            <input
              className="input"
              value={newRole.description}
              onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
            />
          </div>
          <div className="md:col-span-3 flex gap-3">
            <button className="btn-primary" type="submit">
              Create
            </button>
            <button className="btn-secondary" type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roles.map((r) => (
          <div key={r.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">{r.name}</div>
                  {r.is_system ? (
                    <span title="System role" className="text-amber-400 text-xs">
                      🔒 system
                    </span>
                  ) : (
                    <span className="text-emerald-400 text-xs">custom</span>
                  )}
                </div>
                <div className="text-xs text-slate-400">{r.name_ar}</div>
                {r.description && (
                  <div className="text-xs text-slate-500 mt-1">{r.description}</div>
                )}
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Permissions</div>
                <div className="text-xl font-mono text-cyan-300">{r.permission_count}</div>
                <div className="text-[11px] text-slate-500">{r.employee_count} employees</div>
              </div>
            </div>

            <div className="mt-3 flex gap-3">
              <button className="btn-secondary text-sm" onClick={() => expand(r)}>
                {expandedId === r.id ? 'Hide' : 'View / Edit'}
              </button>
              {canManage && !r.is_system && (
                <button
                  className="text-rose-400 hover:underline text-sm"
                  onClick={() => removeRole(r)}
                >
                  Delete
                </button>
              )}
            </div>

            {expandedId === r.id && (
              <div className="mt-4 border-t border-slate-700 pt-4 space-y-4">
                {Object.entries(permsByCategory).map(([cat, group]) => (
                  <div key={cat}>
                    <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                      {cat} · {group.label_ar}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {group.items.map((p) => {
                        const set = pending[r.id] || new Set();
                        const checked = set.has(p.id);
                        const disabled = !canManage || r.id === 'role-superadmin';
                        return (
                          <label
                            key={p.id}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-800/40 px-2 py-1 rounded"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => togglePerm(r.id, p.id)}
                            />
                            <span className="flex-1">{p.name}</span>
                            <span className="text-xs text-slate-500">{p.name_ar}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {canManage && r.id !== 'role-superadmin' && (
                  <div className="flex gap-3">
                    <button
                      className="btn-primary text-sm"
                      disabled={!isDirty(r.id)}
                      onClick={() => savePerms(r)}
                    >
                      Save permissions
                    </button>
                    <button
                      className="btn-secondary text-sm"
                      onClick={() =>
                        setPending((s) => ({
                          ...s,
                          [r.id]: new Set(permsByRole[r.id] || []),
                        }))
                      }
                    >
                      Reset
                    </button>
                  </div>
                )}
                {r.id === 'role-superadmin' && (
                  <div className="text-xs text-amber-400">
                    Super Admin always has every permission — not editable.
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
