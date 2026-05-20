import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, put, del } from '../api';
import { PrimaryId, DisplayCode } from '../components/IdBadge.jsx';

const PRODUCTS = ['CNC', 'PLC', 'IOT', 'ERP', 'CAD', 'DRV'];

export default function CustomersPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', product_code: '', country_code: '' });
  const [editing, setEditing] = useState(null); // customer being edited inline
  const [err, setErr] = useState('');

  async function load() {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    try {
      const r = await get('/api/customers?' + q.toString());
      setRows(r);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load(); // initial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function softDelete(id) {
    if (!confirm('Mark inactive (soft delete)? · تعطيل العميل؟')) return;
    await del('/api/customers/' + id);
    load();
  }

  async function saveEdit() {
    try {
      await put('/api/customers/' + editing.id, {
        name: editing.name,
        company: editing.company,
        email: editing.email,
        phone: editing.phone,
        country_code: editing.country_code,
        product_code: editing.product_code,
        city: editing.city || '',
        status: editing.status,
      });
      setEditing(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <div className="text-sm text-ink-300">العملاء</div>
        </div>
        <Link to="/register" className="btn-primary">+ New customer · عميل جديد</Link>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            className="input md:col-span-2"
            placeholder="Search by name, company, email, ID, display code… · بحث"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="pending">pending</option>
            <option value="inactive">inactive</option>
          </select>
          <select className="input" value={filters.product_code} onChange={(e) => setFilters({ ...filters, product_code: e.target.value })}>
            <option value="">All products</option>
            {PRODUCTS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <button className="btn-secondary" onClick={load}>Apply · تطبيق</button>
        </div>
      </div>

      {err && <div className="text-brand-red text-sm">{err}</div>}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-page/60">
            <tr>
              <th className="table-th">Primary Key</th>
              <th className="table-th">Display Code</th>
              <th className="table-th">Customer · العميل</th>
              <th className="table-th">Company</th>
              <th className="table-th">Country</th>
              <th className="table-th">Product</th>
              <th className="table-th">Status</th>
              <th className="table-th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-card/40">
                <td className="table-td"><PrimaryId id={r.id} /></td>
                <td className="table-td"><DisplayCode code={r.display_code} /></td>
                <td className="table-td">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-ink-500">{r.email}</div>
                </td>
                <td className="table-td">{r.company}</td>
                <td className="table-td">{r.country_code}</td>
                <td className="table-td">{r.product_code}</td>
                <td className="table-td">
                  <span className={
                    r.status === 'active' ? 'badge-active' :
                    r.status === 'pending' ? 'badge-pending' : 'badge-inactive'
                  }>{r.status}</span>
                </td>
                <td className="table-td text-right space-x-2">
                  <button className="text-brand-cyan hover:underline text-sm" onClick={() => setEditing({ ...r })}>Edit</button>
                  <button className="text-brand-red hover:underline text-sm" onClick={() => softDelete(r.id)}>Disable</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan="8" className="table-td text-center text-ink-500 py-8">No customers yet · لا يوجد عملاء</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Edit customer · تعديل عميل</h3>
            <div className="mb-4 space-y-1">
              <div><span className="text-[10px] text-ink-500 mr-2">Primary</span><PrimaryId id={editing.id} /></div>
              <div><span className="text-[10px] text-ink-500 mr-2">Current display</span><DisplayCode code={editing.display_code} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Name</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><label className="label">Company</label><input className="input" value={editing.company} onChange={(e) => setEditing({ ...editing, company: e.target.value })} /></div>
              <div><label className="label">Email</label><input className="input" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
              <div><label className="label">Phone</label><input className="input" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
              <div>
                <label className="label">Country (changing regenerates display)</label>
                <input className="input" value={editing.country_code} onChange={(e) => setEditing({ ...editing, country_code: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="label">Product (changing regenerates display + seq)</label>
                <select className="input" value={editing.product_code} onChange={(e) => setEditing({ ...editing, product_code: e.target.value })}>
                  {PRODUCTS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div><label className="label">City</label><input className="input" value={editing.city || ''} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  <option>active</option><option>pending</option><option>inactive</option>
                </select>
              </div>
            </div>
            <div className="text-[11px] text-brand-orange mt-3">
              Note · ملاحظة: Primary Key never changes. If country or product changes, Display Code is regenerated.
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
