import { useEffect, useState } from 'react';
import { get } from '../api';
import { PrimaryId, DisplayCode } from '../components/IdBadge.jsx';

export default function VerifyPage() {
  const [apiKey, setApiKey] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [hwid, setHwid] = useState('');
  const [productCode, setProductCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [savedKeys, setSavedKeys] = useState([]);

  useEffect(() => {
    get('/api/apikeys').then(setSavedKeys).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          license_key: licenseKey.trim(),
          hwid: hwid || undefined,
          product_code: productCode || undefined,
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Verify license</h1>
        <div className="text-sm text-ink-300">التحقق من الترخيص</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label className="label">X-API-Key · مفتاح API</label>
            <input
              className="input font-mono"
              placeholder="lk_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
            {savedKeys.length > 0 && (
              <div className="mt-1 text-[11px] text-ink-500">
                {savedKeys.filter((k) => k.active).length} active API key(s) registered. Plaintext is shown once at creation only.
              </div>
            )}
          </div>
          <div>
            <label className="label">License key · مفتاح الترخيص</label>
            <textarea
              className="input font-mono text-xs"
              rows={3}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-CHECKSUM"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">HWID (optional)</label>
              <input className="input" value={hwid} onChange={(e) => setHwid(e.target.value)} />
            </div>
            <div>
              <label className="label">Product code (optional)</label>
              <input className="input" value={productCode} onChange={(e) => setProductCode(e.target.value.toUpperCase())} />
            </div>
          </div>

          {err && <div className="text-brand-red text-sm">{err}</div>}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify · تحقق'}
          </button>

          <div className="text-[11px] text-ink-500 leading-relaxed border-t border-line pt-3">
            This page calls <code className="text-brand-cyan">POST /api/verify</code> exactly the way a
            product binary would: <strong>X-API-Key</strong> header + license key body. Rate-limited 30/min.
          </div>
        </form>

        <div className="card">
          <div className="text-xs uppercase tracking-wider text-ink-300 mb-3">Result · النتيجة</div>
          {!result && <div className="text-ink-500 text-sm">Submit to see verification result…</div>}
          {result && result.valid && (
            <div className="space-y-3">
              <div className="inline-block px-3 py-1 rounded-full bg-brand-cyan/20 text-brand-cyan text-sm font-medium border border-brand-cyan/40">
                ✓ Valid · صالح
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">Primary Key (from decrypted payload)</div>
                  <PrimaryId id={result.primary_id} />
                </div>
                <div>
                  <div className="text-[10px] text-ink-500 mb-1">Display Code (DB lookup)</div>
                  <DisplayCode code={result.display_code} />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div><span className="text-ink-500">Customer</span> {result.customer}</div>
                  <div><span className="text-ink-500">Company</span> {result.company}</div>
                  <div><span className="text-ink-500">Product</span> {result.product}</div>
                  <div><span className="text-ink-500">Tier</span> <span className="display-code">{result.tier}</span></div>
                  <div><span className="text-ink-500">Expires</span> {result.expires_at}</div>
                  <div><span className="text-ink-500">Activations</span> {result.activations}/{result.activation_limit}</div>
                </div>
              </div>
              <div className="text-[11px] text-ink-500 border-t border-line pt-3 mt-3">
                Flow: license key → DB row → AES-256-GCM decrypt → <span className="text-brand-cyan">pid</span> (Primary Key) → customer lookup → Display Code.
              </div>
            </div>
          )}
          {result && !result.valid && (
            <div className="space-y-2">
              <div className="inline-block px-3 py-1 rounded-full bg-brand-red/20 text-brand-red text-sm font-medium border border-brand-red/40">
                ✗ Invalid · غير صالح
              </div>
              <div className="text-sm text-brand-red">{result.reason}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
