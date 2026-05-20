import { useEffect, useState } from 'react';
import { get } from '../api';

const ACCENT = {
  orange: 'text-brand-orange',
  cyan: 'text-brand-cyan',
  magenta: 'text-brand-magenta',
  red: 'text-brand-red',
};

function Stat({ label, ar, value, accent = 'orange' }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-ink-300">{label}</div>
      <div className="text-[11px] text-ink-500 mb-2">{ar}</div>
      <div className={`text-3xl font-bold ${ACCENT[accent] || ACCENT.orange}`}>
        {value ?? '—'}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    get('/api/audit/stats').then(setStats).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="text-sm text-ink-300">لوحة التحكم</div>
      </div>

      {err && <div className="text-brand-red text-sm">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Active customers" ar="عملاء نشطون" value={stats?.customers} accent="orange" />
        <Stat label="Active licenses" ar="تراخيص نشطة" value={stats?.licenses} accent="cyan" />
        <Stat label="Revoked" ar="ملغاة" value={stats?.revoked} accent="red" />
        <Stat label="API keys" ar="مفاتيح API" value={stats?.apikeys} accent="magenta" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-3">By product · حسب المنتج</h3>
          <div className="space-y-2">
            {(stats?.byProduct || []).map((p) => (
              <div key={p.product_code} className="flex justify-between text-sm">
                <span className="primary-id">{p.product_code}</span>
                <span className="text-ink-300">{p.c}</span>
              </div>
            ))}
            {(stats?.byProduct || []).length === 0 && (
              <div className="text-ink-500 text-sm">No data yet · لا توجد بيانات</div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-3">By tier · حسب الفئة</h3>
          <div className="space-y-2">
            {(stats?.byTier || []).map((p) => (
              <div key={p.tier} className="flex justify-between text-sm">
                <span className="display-code">{p.tier}</span>
                <span className="text-ink-300">{p.c}</span>
              </div>
            ))}
            {(stats?.byTier || []).length === 0 && (
              <div className="text-ink-500 text-sm">No data yet · لا توجد بيانات</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-3">Recent activity · النشاط الأخير</h3>
        <div className="space-y-1 text-sm font-mono">
          {(stats?.recent || []).map((r) => (
            <div key={r.id} className="flex gap-3 items-center py-1 border-b border-line/60">
              <span className="text-ink-500 text-xs w-40">{r.timestamp}</span>
              <span className="text-brand-cyan">{r.action}</span>
              <span className="text-ink-300">{r.entity_type}</span>
              <span className="text-brand-orange truncate">{r.entity_id}</span>
            </div>
          ))}
          {(stats?.recent || []).length === 0 && (
            <div className="text-ink-500 text-sm">Empty · فارغ</div>
          )}
        </div>
      </div>
    </div>
  );
}
