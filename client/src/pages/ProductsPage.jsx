import { useEffect, useState } from 'react';
import { get, post, put, del } from '../api';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';
import { useAuth } from '../auth.jsx';
import { toast } from '../toast.jsx';

const TYPES = ['HARDWARE', 'SOFTWARE', 'HYBRID'];
const STATUSES = ['active', 'development', 'discontinued'];

const TYPE_LABEL = {
  HARDWARE: 'Hardware',
  SOFTWARE: 'Software',
  HYBRID: 'Hybrid',
};

const STATUS_BADGE = {
  active: 'badge-active',
  development: 'badge-pending',
  discontinued: 'badge-revoked',
};

const STATUS_LABEL = {
  active: 'Active',
  development: 'Development',
  discontinued: 'Discontinued',
};

const EMPTY = {
  code: '',
  name: '',
  type: 'HARDWARE',
  category: '',
  description: '',
  version: '1.0',
  manufacturer_prefix: 'LT',
  warranty_months: 12,
  has_license: true,
  status: 'active',
};

const ADMIN_ROLE_IDS = new Set(['role-superadmin', 'role-admin']);

export default function ProductsPage() {
  const { hasPermission, user } = useAuth();
  // Destructive action requires Admin / Super Admin role AND the perm.
  const canDelete = ADMIN_ROLE_IDS.has(user?.role_id) && hasPermission('products.manage');
  const canManage = hasPermission('products.manage');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', product }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setProducts(await get('/api/products'));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setModal({ mode: 'create', form: { ...EMPTY } });
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await del(`/api/products/${deleteTarget.id}`);
      toast.success(`${deleteTarget.code} deleted`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      // 409 with reason=units_exist → offer Discontinue instead
      if (e.status === 409 && e.body?.reason === 'units_exist') {
        setDeleteErr(e.body.error);
        setDeleteTarget((t) => t && { ...t, _blocked: { unit_count: e.body.unit_count } });
      } else {
        setDeleteErr(e.body?.error || e.message);
        toast.error(`Delete failed: ${e.body?.error || e.message}`);
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  async function discontinueInstead() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await put(`/api/products/${deleteTarget.id}`, { status: 'discontinued' });
      toast.success(`${deleteTarget.code} discontinued`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setDeleteErr(e.body?.error || e.message);
      toast.error(`Discontinue failed: ${e.body?.error || e.message}`);
    } finally {
      setDeleteBusy(false);
    }
  }

  function openEdit(product) {
    setModal({
      mode: 'edit',
      product,
      form: {
        code: product.code,
        name: product.name,
        type: product.type,
        category: product.category,
        description: product.description || '',
        version: product.version || '1.0',
        manufacturer_prefix: product.manufacturer_prefix || 'LT',
        warranty_months: product.warranty_months ?? 12,
        has_license: !!product.has_license,
        status: product.status,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <button type="button" className="btn-primary" onClick={openCreate}>
          + New product
        </button>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs uppercase tracking-wider text-ink-300">
            Catalog
            {!loading && (
              <span className="ml-2 text-ink-500">({products.length})</span>
            )}
          </div>
          {loading && <Spinner />}
        </div>

        {err && (
          <div className="text-sm bg-brand-red/10 border border-brand-red/30 text-brand-red rounded-lg px-3 py-2 mb-3">
            {err}
          </div>
        )}

        {!loading && products.length === 0 && !err && (
          <div className="text-ink-500 text-sm">
            No products yet. Click <strong>+ New product</strong> to add one.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onEdit={() => openEdit(p)}
              onDelete={canDelete ? () => setDeleteTarget(p) : null}
            />
          ))}
        </div>

        <div className="mt-6 text-[11px] text-ink-500 border-t border-line pt-3 leading-relaxed">
          Backed by <code className="text-brand-cyan">GET /api/products</code>.
          Create &amp; edit hit{' '}
          <code className="text-brand-cyan">POST</code> /{' '}
          <code className="text-brand-cyan">PUT /api/products/:id</code> and are
          audit-logged.
        </div>
      </div>

      {modal && (
        <ProductFormModal
          mode={modal.mode}
          product={modal.product}
          initial={modal.form}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}

      <Modal
        open={!!deleteTarget}
        onClose={() => !deleteBusy && (setDeleteTarget(null), setDeleteErr(''))}
        maxWidth="max-w-md"
        className="border-brand-red/40"
        closeOnBackdrop={!deleteBusy}
        title={deleteTarget ? 'Delete product' : ''}
      >
        {deleteTarget && (
          <>
            {!deleteTarget._blocked ? (
              <div className="text-sm text-ink-100 leading-relaxed">
                Are you sure you want to delete{' '}
                <span className="font-semibold">{deleteTarget.name}</span>?
              </div>
            ) : (
              <div className="text-sm text-ink-100 leading-relaxed">
                Cannot delete: this product has{' '}
                <span className="font-semibold text-brand-orange">
                  {deleteTarget._blocked.unit_count}
                </span>{' '}
                {deleteTarget._blocked.unit_count === 1 ? 'unit' : 'units'}.
                Discontinue instead?
              </div>
            )}

            {deleteErr && !deleteTarget._blocked && (
              <div className="mt-3 text-sm bg-brand-red/10 border border-brand-red/30 text-brand-red rounded-lg px-3 py-2">
                {deleteErr}
              </div>
            )}

            <div className="flex gap-3 justify-end mt-5">
              <button
                className="btn-secondary"
                onClick={() => { setDeleteTarget(null); setDeleteErr(''); }}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              {!deleteTarget._blocked ? (
                <button
                  className="btn-danger"
                  onClick={confirmDelete}
                  disabled={deleteBusy}
                  autoFocus
                >
                  {deleteBusy ? <Spinner /> : 'Delete'}
                </button>
              ) : (
                <button
                  className="btn-danger"
                  onClick={discontinueInstead}
                  disabled={deleteBusy}
                  autoFocus
                >
                  {deleteBusy ? <Spinner /> : 'Discontinue'}
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function ProductCard({ product, onEdit, onDelete }) {
  const typeLabel = TYPE_LABEL[product.type] || product.type;
  const statusBadge = STATUS_BADGE[product.status] || 'badge-inactive';

  return (
    <div className="bg-cardAlt border border-line rounded-lg p-4 flex flex-col hover:border-brand-orange/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="display-code text-xs">{product.code}</span>
        <span className={statusBadge}>{STATUS_LABEL[product.status] || product.status}</span>
      </div>

      <div className="text-sm font-semibold text-ink-100">{product.name}</div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-500">
        <span className="px-1.5 py-0.5 rounded border border-brand-cyan/40 text-brand-cyan font-mono uppercase tracking-wider text-[10px]">
          {typeLabel}
        </span>
        <span className="text-ink-500">{product.category}</span>
      </div>

      <div className="mt-3 flex items-center justify-between text-[10px] text-ink-500">
        <span className="font-mono">{product.id}</span>
        <span>v{product.version || '1.0'}</span>
      </div>

      <div className="mt-3 pt-3 border-t border-line flex gap-2">
        <button type="button" className="btn-secondary flex-1 text-xs" onClick={onEdit}>
          Edit
        </button>
        {onDelete && (
          <button
            type="button"
            aria-label={`Discontinue ${product.code}`}
            title="Discontinue product"
            onClick={onDelete}
            className="inline-flex items-center justify-center px-2.5 rounded-lg border border-brand-red/40 text-brand-red hover:bg-brand-red/10 transition-colors"
          >
            <TrashIcon />
          </button>
        )}
      </div>
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

function ProductFormModal({ mode, product, initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const payload = {
        ...form,
        code: form.code.trim().toUpperCase(),
        manufacturer_prefix: (form.manufacturer_prefix || 'LT').trim().toUpperCase(),
        warranty_months: Number(form.warranty_months) || 0,
        has_license: !!form.has_license,
      };
      if (mode === 'create') {
        await post('/api/products', payload);
        toast.success(`Product ${payload.code} created`);
      } else {
        await put(`/api/products/${product.id}`, payload);
        toast.success(`Product ${payload.code} updated`);
      }
      await onSaved();
    } catch (e) {
      setErr(e.message);
      toast.error(e.body?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New product' : `Edit ${product.code}`}
      maxWidth="max-w-3xl"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Code</label>
            <input
              className="input font-mono uppercase"
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              maxLength={8}
              required
            />
            <div className="mt-1 text-[10px] text-ink-500">
              2–8 uppercase letters/digits. Used in serial numbers (e.g. LT-<strong>{form.code || 'CNC'}</strong>-H-…)
            </div>
          </div>
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) => set('type', e.target.value)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Category</label>
            <input
              className="input"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Version</label>
            <input
              className="input"
              value={form.version}
              onChange={(e) => set('version', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Manufacturer prefix</label>
            <input
              className="input font-mono uppercase"
              value={form.manufacturer_prefix}
              onChange={(e) => set('manufacturer_prefix', e.target.value.toUpperCase())}
              maxLength={4}
            />
          </div>
          <div>
            <label className="label">Warranty (months)</label>
            <input
              className="input"
              type="number"
              min="0"
              max="120"
              value={form.warranty_months}
              onChange={(e) => set('warranty_months', e.target.value)}
            />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input
              id="has_license"
              type="checkbox"
              className="h-4 w-4 accent-brand-orange"
              checked={!!form.has_license}
              onChange={(e) => set('has_license', e.target.checked)}
            />
            <label htmlFor="has_license" className="text-sm text-ink-100">
              This product requires a license key
            </label>
          </div>
        </div>

        {err && (
          <div className="text-sm bg-brand-red/10 border border-brand-red/30 text-brand-red rounded-lg px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2 border-t border-line">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Spinner /> : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
