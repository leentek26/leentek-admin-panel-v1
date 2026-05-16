import { useEffect, useState } from 'react';
import { get, post, del } from '../api';

export default function ApiKeysPage() {
  const [rows, setRows] = useState([]);
  const [productCode, setProductCode] = useState('CNC');
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState(null); // plaintext shown once
  const [err, setErr] = useState('');

  async function load() {
    try { setRows(await get('/api/apikeys')); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr('');
    try {
      const r = await post('/api/apikeys', { product_code: productCode, label });
      setCreated(r);
      setLabel('');
      load();
    } catch (e) { setErr(e.message); }
  }

  async function revoke(id) {
    if (!confirm('Revoke this API key? · إلغاء؟')) return;
    await del('/api/apikeys/' + id);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <div className="text-sm text-slate-400">مفاتيح API للتحقق</div>
      </div>

      <form onSubmit={create} className="card flex flex-col md:flex-row gap-3 md:items-end">
        <div className="flex-1">
          <label className="label">Product code · المنتج</label>
          <input className="input" required value={productCode} onChange={(e) => setProductCode(e.target.value.toUpperCase())} />
        </div>
        <div className="flex-1">
          <label className="label">Label (optional)</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. prod-CNC-westus" />
        </div>
        <button className="btn-primary" type="submit">+ Create key · إنشاء</button>
      </form>

      {err && <div className="text-rose-400 text-sm">{err}</div>}

      {created && (
        <div className="card border-amber-500/50">
          <div className="text-amber-400 text-xs uppercase tracking-wider mb-2">
            Save this key now — it will never be shown again · احفظه الآن
          </div>
          <div className="font-mono text-sm break-all bg-slate-950 border border-slate-800 rounded p-3 text-emerald-400">
            {created.key}
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            Server stores only the SHA-256 hash. Distribute to product binary via X-API-Key header.
          </div>
          <button className="btn-secondary mt-3" onClick={() => navigator.clipboard.writeText(created.key)}>Copy</button>
          <button className="btn-secondary mt-3 ml-2" onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-900/60">
            <tr>
              <th className="table-th">ID</th>
              <th className="table-th">Product</th>
              <th className="table-th">Label</th>
              <th className="table-th">Status</th>
              <th className="table-th">Created</th>
              <th className="table-th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/40">
                <td className="table-td font-mono">#{r.id}</td>
                <td className="table-td"><span className="primary-id">{r.product_code}</span></td>
                <td className="table-td">{r.label || <span className="text-slate-500">—</span>}</td>
                <td className="table-td">
                  <span className={r.active ? 'text-emerald-400' : 'text-slate-500'}>
                    {r.active ? 'active' : 'revoked'}
                  </span>
                </td>
                <td className="table-td text-xs text-slate-400">{r.created_at}</td>
                <td className="table-td text-right">
                  {r.active && (
                    <button className="text-rose-400 hover:underline text-sm" onClick={() => revoke(r.id)}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan="6" className="table-td text-center text-slate-500 py-8">No API keys yet · لا توجد مفاتيح</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
