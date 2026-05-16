import { Fragment, useEffect, useState } from 'react';
import { get, post, getAccessToken } from '../api';
import { PrimaryId, DisplayCode } from '../components/IdBadge.jsx';

const STATUS_COLORS = {
  active: 'text-emerald-400',
  revoked: 'text-rose-400',
  expired: 'text-amber-400',
};

export default function LicensesPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ customer_id: '', product_code: '', status: '' });
  const [expanded, setExpanded] = useState(null);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(null); // { kind: 'ok'|'err', text }

  function showFlash(kind, text) {
    setFlash({ kind, text });
    setTimeout(() => setFlash(null), 3500);
  }

  async function load() {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    try {
      setRows(await get('/api/licenses?' + q.toString()));
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function revoke(id) {
    if (!confirm('Revoke this license? · إلغاء الترخيص؟')) return;
    try {
      await post(`/api/licenses/${id}/revoke`);
      showFlash('ok', `Revoked ${id}`);
      load();
    } catch (e) {
      showFlash('err', e.message);
    }
  }

  async function activate(id) {
    try {
      const r = await post(`/api/licenses/${id}/activate`);
      showFlash('ok', `Activated ${id} · ${r.activations}/${r.activation_limit}`);
      load();
    } catch (e) {
      showFlash('err', `${id}: ${e.message}`);
    }
  }

  function exportCsv() {
    const token = getAccessToken();
    // Trigger via fetch + blob to include auth header
    fetch('/api/licenses/export/csv', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'licenses.csv';
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Licenses</h1>
          <div className="text-sm text-slate-400">التراخيص</div>
        </div>
        <button className="btn-secondary" onClick={exportCsv}>Export CSV · تصدير</button>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="input" placeholder="Customer (Primary or Display)" value={filters.customer_id} onChange={(e) => setFilters({ ...filters, customer_id: e.target.value })} />
          <input className="input" placeholder="Product code" value={filters.product_code} onChange={(e) => setFilters({ ...filters, product_code: e.target.value.toUpperCase() })} />
          <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="revoked">revoked</option>
            <option value="expired">expired</option>
          </select>
          <button className="btn-secondary" onClick={load}>Apply · تطبيق</button>
        </div>
      </div>

      {err && <div className="text-rose-400 text-sm">{err}</div>}
      {flash && (
        <div
          className={`text-sm rounded-lg px-3 py-2 border ${
            flash.kind === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/40 text-rose-300'
          }`}
        >
          {flash.text}
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-900/60">
            <tr>
              <th className="table-th">License ID</th>
              <th className="table-th">Customer · العميل</th>
              <th className="table-th">Product</th>
              <th className="table-th">Tier</th>
              <th className="table-th">Dongle</th>
              <th className="table-th">Activ.</th>
              <th className="table-th">Expires</th>
              <th className="table-th">Status</th>
              <th className="table-th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="hover:bg-slate-800/40">
                  <td className="table-td"><PrimaryId id={r.id} /></td>
                  <td className="table-td">
                    <div className="flex flex-col gap-1">
                      <PrimaryId id={r.customer_id} />
                      <DisplayCode code={r.display_code} />
                      <div className="text-xs text-slate-500">{r.customer_name}</div>
                    </div>
                  </td>
                  <td className="table-td">{r.product_code}</td>
                  <td className="table-td"><span className="display-code">{r.tier}</span></td>
                  <td className="table-td">{r.dongle_type}</td>
                  <td className="table-td">
                    <span className={r.activations >= r.activation_limit ? 'text-amber-400' : 'text-slate-300'}>
                      {r.activations}/{r.activation_limit}
                    </span>
                  </td>
                  <td className="table-td text-xs">{r.expires_at}</td>
                  <td className="table-td"><span className={STATUS_COLORS[r.status] || ''}>{r.status}</span></td>
                  <td className="table-td text-right space-x-3">
                    <button
                      className="text-cyan-400 hover:underline text-sm"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      {expanded === r.id ? 'Hide' : 'Details'}
                    </button>
                    {r.status === 'active' && (
                      <button
                        className="text-emerald-400 hover:underline text-sm disabled:text-slate-600 disabled:no-underline disabled:cursor-not-allowed"
                        onClick={() => activate(r.id)}
                        disabled={r.activations >= r.activation_limit}
                        title={
                          r.activations >= r.activation_limit
                            ? 'Activation limit reached · بلغ الحد الأقصى'
                            : 'Increment activation · زيادة التفعيل'
                        }
                      >
                        Activate
                      </button>
                    )}
                    {r.status === 'active' && (
                      <button className="text-rose-400 hover:underline text-sm" onClick={() => revoke(r.id)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr className="bg-slate-900/40">
                    <td colSpan="9" className="px-4 py-3 border-t border-slate-800">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">License key</div>
                      <div className="font-mono text-xs break-all bg-slate-950 border border-slate-800 rounded p-2 text-emerald-400 mb-2">
                        {r.license_key}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Encrypted payload (AES-256-GCM)</div>
                      <div className="font-mono text-[11px] break-all bg-slate-950 border border-slate-800 rounded p-2 text-slate-500">
                        {r.encrypted_payload}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-2">
                        Issued {r.issued_at} · HWID <span className="text-slate-300">{r.hwid}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan="9" className="table-td text-center text-slate-500 py-8">No licenses yet · لا توجد تراخيص</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
