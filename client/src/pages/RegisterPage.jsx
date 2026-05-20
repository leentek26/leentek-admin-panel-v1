import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post, get } from '../api';
import { PrimaryId, DisplayCode } from '../components/IdBadge.jsx';

const PRODUCTS = [
  { code: 'CNC', name: 'CNC Controller' },
  { code: 'PLC', name: 'PLC Suite' },
  { code: 'IOT', name: 'IoT Gateway' },
  { code: 'ERP', name: 'ERP Connector' },
  { code: 'CAD', name: 'CAD Plugin' },
  { code: 'DRV', name: 'Driver Pack' },
];

const COUNTRIES = [
  ['QA', 'Qatar · قطر'],
  ['SA', 'Saudi Arabia · السعودية'],
  ['AE', 'UAE · الإمارات'],
  ['EG', 'Egypt · مصر'],
  ['KW', 'Kuwait · الكويت'],
  ['OM', 'Oman · عُمان'],
  ['BH', 'Bahrain · البحرين'],
  ['JO', 'Jordan · الأردن'],
  ['IQ', 'Iraq · العراق'],
  ['LB', 'Lebanon · لبنان'],
  ['TR', 'Türkiye'],
  ['US', 'United States'],
  ['DE', 'Germany'],
  ['GB', 'United Kingdom'],
];

const yy = new Date().getFullYear().toString().slice(-2);

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    country_code: 'QA',
    product_code: 'CNC',
    city: '',
    status: 'active',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [previewSeq, setPreviewSeq] = useState(null);

  // Live preview: peek at the *next* seq_num via a quick list query.
  // The real seq is allocated server-side at insert.
  useEffect(() => {
    get(`/api/customers?product_code=${form.product_code}`)
      .then((rows) => {
        const max = rows.reduce((m, r) => Math.max(m, r.seq_num || 0), 0);
        setPreviewSeq(max + 1);
      })
      .catch(() => setPreviewSeq(null));
  }, [form.product_code]);

  const previewDisplay = `${form.country_code}-${form.product_code}-${String(previewSeq || 1).padStart(4, '0')}-${yy}`;
  const previewPrimary = 'CUS-xxxxxxxxxxxx'; // opaque placeholder

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const r = await post('/api/customers', form);
      setResult(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Register customer</h1>
        <div className="text-sm text-ink-300">تسجيل عميل جديد</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={submit} className="card lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Name · الاسم</label>
              <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label className="label">Company · الشركة</label>
              <input className="input" required value={form.company} onChange={(e) => set('company', e.target.value)} />
            </div>
            <div>
              <label className="label">Email · البريد</label>
              <input className="input" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className="label">Phone · الهاتف</label>
              <input className="input" required value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="label">Country · الدولة</label>
              <select className="input" value={form.country_code} onChange={(e) => set('country_code', e.target.value)}>
                {COUNTRIES.map(([c, n]) => (
                  <option key={c} value={c}>
                    {c} — {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Product · المنتج</label>
              <select className="input" value={form.product_code} onChange={(e) => set('product_code', e.target.value)}>
                {PRODUCTS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">City · المدينة</label>
              <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <label className="label">Status · الحالة</label>
              <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">active</option>
                <option value="pending">pending</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
          </div>

          {err && (
            <div className="text-sm bg-brand-red/10 border border-brand-red/30 text-brand-red rounded-lg px-3 py-2">
              {err}
            </div>
          )}

          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Register · تسجيل'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate('/customers')}
            >
              Cancel · إلغاء
            </button>
          </div>
        </form>

        <div className="space-y-4">
          <div className="card">
            <div className="text-xs uppercase tracking-wider text-ink-300 mb-2">Live preview · معاينة مباشرة</div>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] text-ink-500 mb-1">Primary Key (assigned on save · يُنشأ عند الحفظ)</div>
                <PrimaryId id={previewPrimary} />
              </div>
              <div>
                <div className="text-[10px] text-ink-500 mb-1">Display Code (next available · المتاح التالي)</div>
                <DisplayCode code={previewDisplay} />
              </div>
            </div>
            <div className="mt-4 text-[11px] text-ink-500 leading-relaxed">
              <span className="text-brand-cyan">Cyan</span> = opaque <strong>Primary Key</strong> — immutable, used by all foreign keys + license encryption.<br />
              <span className="text-brand-orange">Amber</span> = <strong>Display Code</strong> — human-readable, regenerated if country/product change.
            </div>
          </div>

          {result && (
            <div className="card border-brand-cyan/40">
              <div className="text-xs uppercase tracking-wider text-brand-cyan mb-2">Created · تم الإنشاء</div>
              <div className="space-y-2">
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">Primary Key</div>
                  <PrimaryId id={result.id} />
                </div>
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">Display Code</div>
                  <DisplayCode code={result.display_code} />
                </div>
              </div>
              <button
                className="btn-secondary mt-4 w-full"
                onClick={() => navigate('/generate?customer_id=' + result.id)}
              >
                Generate license now →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
