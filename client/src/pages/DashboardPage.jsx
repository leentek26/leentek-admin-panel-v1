import { useEffect, useState } from 'react';
import { get } from '../api';

function Stat({ label, ar, value, accent = 'cyan' }) {
  const ring = accent === 'amber' ? 'text-amber-400' : 'text-cyan-400';
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-[11px] text-slate-500 mb-2">{ar}</div>
      <div className={`text-3xl font-bold ${ring}`}>{value ?? '—'}</div>
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
        <div className="text-sm text-slate-400">لوحة التحكم</div>
      </div>

      {err && <div className="text-rose-400 text-sm">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Active customers" ar="عملاء نشطون" value={stats?.customers} />
        <Stat label="Active licenses" ar="تراخيص نشطة" value={stats?.licenses} />
        <Stat label="Revoked" ar="ملغاة" value={stats?.revoked} accent="amber" />
        <Stat label="API keys" ar="مفاتيح API" value={stats?.apikeys} accent="amber" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-3">By product · حسب المنتج</h3>
          <div className="space-y-2">
            {(stats?.byProduct || []).map((p) => (
              <div key={p.product_code} className="flex justify-between text-sm">
                <span className="primary-id">{p.product_code}</span>
                <span className="text-slate-400">{p.c}</span>
              </div>
            ))}
            {(stats?.byProduct || []).length === 0 && (
              <div className="text-slate-500 text-sm">No data yet · لا توجد بيانات</div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-3">By tier · حسب الفئة</h3>
          <div className="space-y-2">
            {(stats?.byTier || []).map((p) => (
              <div key={p.tier} className="flex justify-between text-sm">
                <span className="display-code">{p.tier}</span>
                <span className="text-slate-400">{p.c}</span>
              </div>
            ))}
            {(stats?.byTier || []).length === 0 && (
              <div className="text-slate-500 text-sm">No data yet · لا توجد بيانات</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-3">Recent activity · النشاط الأخير</h3>
        <div className="space-y-1 text-sm font-mono">
          {(stats?.recent || []).map((r) => (
            <div key={r.id} className="flex gap-3 items-center py-1 border-b border-slate-800/60">
              <span className="text-slate-500 text-xs w-40">{r.timestamp}</span>
              <span className="text-cyan-400">{r.action}</span>
              <span className="text-slate-400">{r.entity_type}</span>
              <span className="text-amber-400 truncate">{r.entity_id}</span>
            </div>
          ))}
          {(stats?.recent || []).length === 0 && (
            <div className="text-slate-500 text-sm">Empty · فارغ</div>
          )}
        </div>
      </div>
    </div>
  );
}
