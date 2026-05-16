import { useEffect, useState } from 'react';
import { get } from '../api';

const ACTION_COLORS = {
  login: 'text-emerald-400',
  customer: 'text-cyan-400',
  license: 'text-amber-400',
  apikey: 'text-violet-400',
  verify: 'text-sky-400',
};

function actionColor(action) {
  const root = action.split('.')[0];
  return ACTION_COLORS[root] || 'text-slate-300';
}

export default function AuditLogPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ action: '', entity_type: '', from: '', to: '' });
  const [err, setErr] = useState('');

  async function load() {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    try { setRows(await get('/api/audit?' + q.toString())); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <div className="text-sm text-slate-400">سجل التدقيق</div>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input className="input" placeholder="action prefix (e.g. license)" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
          <select className="input" value={filters.entity_type} onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}>
            <option value="">all entities</option>
            <option value="customer">customer</option>
            <option value="license">license</option>
            <option value="api_key">api_key</option>
            <option value="admin">admin</option>
          </select>
          <input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          <button className="btn-secondary" onClick={load}>Apply · تطبيق</button>
        </div>
      </div>

      {err && <div className="text-rose-400 text-sm">{err}</div>}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-900/60">
            <tr>
              <th className="table-th">Timestamp</th>
              <th className="table-th">Action</th>
              <th className="table-th">Entity</th>
              <th className="table-th">ID</th>
              <th className="table-th">IP</th>
              <th className="table-th">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/40 align-top">
                <td className="table-td font-mono text-xs text-slate-400 whitespace-nowrap">{r.timestamp}</td>
                <td className={`table-td font-mono text-xs ${actionColor(r.action)}`}>{r.action}</td>
                <td className="table-td text-xs">{r.entity_type || '—'}</td>
                <td className="table-td font-mono text-xs">{r.entity_id || '—'}</td>
                <td className="table-td font-mono text-xs text-slate-500">{r.ip_address || '—'}</td>
                <td className="table-td font-mono text-[11px] text-slate-400 max-w-md break-all">{r.details}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan="6" className="table-td text-center text-slate-500 py-8">No audit entries · لا توجد سجلات</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
