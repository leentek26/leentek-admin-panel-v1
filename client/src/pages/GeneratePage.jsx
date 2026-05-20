import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { get, post, getAccessToken } from '../api';
import { PrimaryId, DisplayCode } from '../components/IdBadge.jsx';

const TIERS = ['TRIAL', 'BASIC', 'PRO', 'ENT', 'OEM'];
const DONGLES = ['SOFT', 'USB', 'CLOUD', 'NODE'];

export default function GeneratePage() {
  const [params] = useSearchParams();
  const presetCustomer = params.get('customer_id') || '';

  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({
    customer_id: presetCustomer,
    product_code: 'CNC',
    product_name: '',
    tier: 'PRO',
    dongle_type: 'SOFT',
    hwid: 'ANY',
    activation_limit: 1,
    expires_at: 'PERMANENT',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    get('/api/customers?status=active').then(setCustomers).catch(() => {});
  }, []);

  const selectedCustomer = customers.find(
    (c) => c.id === form.customer_id || c.display_code === form.customer_id
  );

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const payload = {
        ...form,
        activation_limit: Number(form.activation_limit),
        expires_at:
          form.expires_at === 'PERMANENT' || !form.expires_at
            ? 'PERMANENT'
            : new Date(form.expires_at).toISOString(),
      };
      const r = await post('/api/licenses/generate', payload);
      setResult(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadDongle() {
    if (!result) return;
    const res = await fetch(`/api/licenses/${result.id}/dongle`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.id}.lic`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Generate license</h1>
        <div className="text-sm text-ink-300">إصدار ترخيص</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={submit} className="card lg:col-span-2 space-y-4">
          <div>
            <label className="label">Customer · العميل</label>
            <select
              className="input"
              value={form.customer_id}
              onChange={(e) => set('customer_id', e.target.value)}
              required
            >
              <option value="">— select customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_code} — {c.name} ({c.company})
                </option>
              ))}
            </select>
            {selectedCustomer && (
              <div className="mt-2 p-3 rounded-lg bg-page/60 border border-brand-cyan/30 text-xs space-y-1">
                <div className="text-brand-cyan uppercase tracking-wider text-[10px]">
                  License will bind to Primary Key · سيُربط بالمفتاح الأساسي
                </div>
                <div><span className="text-[10px] text-ink-500 mr-2">Primary</span><PrimaryId id={selectedCustomer.id} /></div>
                <div><span className="text-[10px] text-ink-500 mr-2">Display</span><DisplayCode code={selectedCustomer.display_code} /></div>
                <div className="text-ink-300">{selectedCustomer.name} — {selectedCustomer.company}</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Product code · المنتج</label>
              <input className="input" value={form.product_code} onChange={(e) => set('product_code', e.target.value.toUpperCase())} required />
            </div>
            <div>
              <label className="label">Product name (optional)</label>
              <input className="input" value={form.product_name} onChange={(e) => set('product_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Tier · الفئة</label>
              <select className="input" value={form.tier} onChange={(e) => set('tier', e.target.value)}>
                {TIERS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Dongle type · نوع الدونجل</label>
              <select className="input" value={form.dongle_type} onChange={(e) => set('dongle_type', e.target.value)}>
                {DONGLES.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label">HWID lock (ANY = unlocked)</label>
              <input className="input" value={form.hwid} onChange={(e) => set('hwid', e.target.value)} />
            </div>
            <div>
              <label className="label">Activation limit</label>
              <input className="input" type="number" min="1" value={form.activation_limit} onChange={(e) => set('activation_limit', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">Expires (leave PERMANENT or pick date) · تاريخ الانتهاء</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  type="date"
                  value={form.expires_at === 'PERMANENT' ? '' : form.expires_at.slice(0, 10)}
                  onChange={(e) => set('expires_at', e.target.value || 'PERMANENT')}
                />
                <button type="button" className="btn-secondary" onClick={() => set('expires_at', 'PERMANENT')}>
                  Permanent
                </button>
              </div>
            </div>
          </div>

          {err && (
            <div className="text-sm bg-brand-red/10 border border-brand-red/30 text-brand-red rounded-lg px-3 py-2">
              {err}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={busy || !form.customer_id}>
            {busy ? 'Generating…' : 'Generate license · إصدار'}
          </button>
        </form>

        <div className="space-y-4">
          {result ? (
            <div className="card border-brand-cyan/40">
              <div className="text-xs uppercase tracking-wider text-brand-cyan mb-3">License issued · تم الإصدار</div>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">License ID</div>
                  <span className="primary-id">{result.id}</span>
                </div>
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">Bound to (Primary Key)</div>
                  <PrimaryId id={result.customer_id} />
                </div>
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">Customer display</div>
                  <DisplayCode code={result.display_code} />
                </div>
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">License key</div>
                  <div className="font-mono text-xs break-all bg-page border border-line rounded p-2 text-brand-cyan">
                    {result.license_key}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-ink-500">Tier</span> <span className="display-code">{result.tier}</span></div>
                  <div><span className="text-ink-500">Dongle</span> <span className="display-code">{result.dongle_type}</span></div>
                  <div><span className="text-ink-500">Expires</span> {result.expires_at}</div>
                  <div><span className="text-ink-500">Activations</span> {result.activations}/{result.activation_limit}</div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button className="btn-secondary flex-1" onClick={() => navigator.clipboard.writeText(result.license_key)}>
                    Copy key
                  </button>
                  <button className="btn-primary flex-1" onClick={downloadDongle}>
                    Download .lic
                  </button>
                </div>
                <Link className="block text-center text-xs text-brand-cyan hover:underline mt-2" to="/licenses">
                  View all licenses →
                </Link>
              </div>
            </div>
          ) : (
            <div className="card text-sm text-ink-300 leading-relaxed">
              <div className="text-brand-cyan font-semibold mb-2">Binding · الربط</div>
              The generated license will be cryptographically bound to the customer's
              <strong className="text-brand-cyan"> Primary Key</strong> — never to the Display Code.
              The encrypted payload contains <code className="text-brand-cyan">pid</code>, so if the
              Display Code is later regenerated, the license remains valid.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
