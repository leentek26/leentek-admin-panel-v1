import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, put, del } from '../api';
import { PrimaryId, DisplayCode } from '../components/IdBadge.jsx';
import TableSkeleton from '../components/TableSkeleton.jsx';
import PageProgress from '../components/PageProgress.jsx';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';
import { useAuth } from '../auth.jsx';
import { toast } from '../toast.jsx';

const PRODUCTS = ['CNC', 'PLC', 'IOT', 'ERP', 'CAD', 'DRV'];

const ADMIN_ROLE_IDS = new Set(['role-superadmin', 'role-admin']);

export default function CustomersPage() {
  const { hasPermission, user } = useAuth();
  // Destructive cascade requires Admin / Super Admin role AND the perm.
  const canDelete =
    ADMIN_ROLE_IDS.has(user?.role_id) && hasPermission('customers.delete');
  const canEdit = hasPermission('customers.edit');
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', product_code: '', country_code: '' });
  const [editing, setEditing] = useState(null); // customer being edited inline
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true); // first-time skeleton
  const [refreshing, setRefreshing] = useState(false); // subsequent refresh = thin top bar
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [deleteResult, setDeleteResult] = useState(null);

  async function load({ initial = false } = {}) {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const r = await get('/api/customers?' + q.toString());
      setRows(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      if (initial) setLoading(false);
      else setRefreshing(false);
    }
  }

  useEffect(() => {
    load({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeDeleteModal() {
    setDeleteTarget(null);
    setDeleteErr('');
    setDeleteResult(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      const r = await del('/api/customers/' + deleteTarget.id);
      setDeleteResult(r);
      toast.success(
        `Deleted ${deleteTarget.display_code} · revoked ${r.revoked_license_ids?.length ?? 0} licenses · unassigned ${r.unassigned_unit_serials?.length ?? 0} units`
      );
      await load();
    } catch (e) {
      setDeleteErr(e.body?.error || e.message);
      toast.error(e.body?.error || e.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function saveEdit() {
    setSavingEdit(true);
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
      toast.success('Customer updated');
      load();
    } catch (e) {
      setErr(e.message);
      toast.error(e.message);
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageProgress active={refreshing} />
      <div className="flex justify-between items-start">
        <h1 className="text-2xl font-bold">Customers</h1>
        <Link to="/register" className="btn-primary">+ New customer</Link>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            className="input md:col-span-2"
            placeholder="Search by name, company, email, ID, display code…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="pending">pending</option>
            <option value="inactive">inactive</option>
            <option value="deleted">deleted</option>
          </select>
          <select className="input" value={filters.product_code} onChange={(e) => setFilters({ ...filters, product_code: e.target.value })}>
            <option value="">All products</option>
            {PRODUCTS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => load()} disabled={refreshing}>
            {refreshing ? <Spinner /> : 'Apply'}
          </button>
        </div>
      </div>

      {err && <div className="text-brand-red text-sm">{err}</div>}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-page/60">
            <tr>
              <th className="table-th">Primary Key</th>
              <th className="table-th">Display Code</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Company</th>
              <th className="table-th">Country</th>
              <th className="table-th">Product</th>
              <th className="table-th">Status</th>
              <th className="table-th text-right">Actions</th>
            </tr>
          </thead>
          {loading ? (
            <TableSkeleton columns={8} rows={6} />
          ) : (
            <tbody className="row-stripe">
              {rows.map((r) => (
                <tr key={r.id} className={`status-${r.status}`}>
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
                      r.status === 'pending' ? 'badge-pending' :
                      r.status === 'deleted' ? 'badge-revoked' :
                      'badge-inactive'
                    }>{r.status}</span>
                  </td>
                  <td className="table-td text-right">
                    <div className="inline-flex items-center gap-2">
                      {canEdit && (
                        <button
                          className="text-brand-cyan hover:underline text-sm"
                          onClick={() => setEditing({ ...r })}
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          aria-label={`Delete ${r.display_code}`}
                          title="Delete customer (irreversible)"
                          onClick={() => {
                            setDeleteTarget(r);
                            setDeleteErr('');
                            setDeleteResult(null);
                          }}
                          className="inline-flex items-center justify-center px-2 py-1 rounded-lg border border-brand-red/40 text-brand-red hover:bg-brand-red/10 transition-colors"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan="8" className="table-td text-center text-ink-500 py-8">No customers yet</td></tr>
              )}
            </tbody>
          )}
        </table>
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit customer"
      >
        {editing && (
          <>
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
              Note: Primary Key never changes. If country or product changes, Display Code is regenerated.
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-secondary" onClick={() => setEditing(null)} disabled={savingEdit}>Cancel</button>
              <button className="btn-primary" onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? <Spinner /> : 'Save'}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => !deleteBusy && closeDeleteModal()}
        maxWidth="max-w-md"
        className="border-brand-red/60"
        closeOnBackdrop={!deleteBusy && !deleteResult}
        title={deleteTarget ? 'Delete customer' : ''}
      >
        {deleteTarget && !deleteResult && (
          <>
            <div className="text-sm text-ink-100 leading-relaxed">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-ink-100">{deleteTarget.name}</span>?
              All their licenses will be revoked and units unassigned.
            </div>

            {deleteErr && (
              <div className="mt-3 text-sm bg-brand-red/10 border border-brand-red/30 text-brand-red rounded-lg px-3 py-2">
                {deleteErr}
              </div>
            )}

            <div className="flex gap-3 justify-end mt-5">
              <button
                className="btn-secondary"
                onClick={closeDeleteModal}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={confirmDelete}
                disabled={deleteBusy}
                autoFocus
              >
                {deleteBusy ? <Spinner /> : 'Delete'}
              </button>
            </div>
          </>
        )}

        {deleteTarget && deleteResult && (
          <>
            <div className="text-xs uppercase tracking-wider text-brand-red mb-2">
              Customer deleted
            </div>
            <div className="text-sm text-ink-300 leading-relaxed">
              The customer record and all associated licenses have been removed.
              Units previously assigned to this customer are back in stock.
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="bg-cardAlt border border-line rounded-lg p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-ink-500">
                  Licenses revoked
                </div>
                <div className="text-2xl font-bold text-brand-red mt-1">
                  {deleteResult.revoked_license_ids?.length ?? 0}
                </div>
              </div>
              <div className="bg-cardAlt border border-line rounded-lg p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-ink-500">
                  Units unassigned
                </div>
                <div className="text-2xl font-bold text-brand-orange mt-1">
                  {deleteResult.unassigned_unit_serials?.length ?? 0}
                </div>
              </div>
            </div>
            {(deleteResult.revoked_license_ids?.length > 0 ||
              deleteResult.unassigned_unit_serials?.length > 0) && (
              <div className="mt-3 max-h-40 overflow-y-auto border border-line rounded-lg divide-y divide-line text-xs">
                {deleteResult.revoked_license_ids?.map((id) => (
                  <div key={id} className="px-3 py-1.5 flex items-center gap-2">
                    <span className="badge-revoked">revoked</span>
                    <span className="font-mono text-brand-cyan">{id}</span>
                  </div>
                ))}
                {deleteResult.unassigned_unit_serials?.map((sn) => (
                  <div key={sn} className="px-3 py-1.5 flex items-center gap-2">
                    <span className="badge-in_stock">in_stock</span>
                    <span className="font-mono text-brand-cyan break-all">{sn}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button className="btn-primary" onClick={closeDeleteModal}>
                Close
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function TrashIcon() {
  // ti-trash, inline (CSP blocks external icon fonts)
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}
