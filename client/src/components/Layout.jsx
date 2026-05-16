import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', ar: 'لوحة التحكم' },
  { to: '/register', label: 'Register', ar: 'تسجيل عميل' },
  { to: '/customers', label: 'Customers', ar: 'العملاء' },
  { to: '/generate', label: 'Generate License', ar: 'إصدار ترخيص' },
  { to: '/licenses', label: 'Licenses', ar: 'التراخيص' },
  { to: '/verify', label: 'Verify', ar: 'التحقق' },
  { to: '/apikeys', label: 'API Keys', ar: 'مفاتيح API' },
  { to: '/audit', label: 'Audit Log', ar: 'سجل التدقيق' },
];

export default function Layout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-full bg-slate-900 text-slate-100 flex">
      <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-xl font-bold tracking-tight">Leentek</div>
          <div className="text-xs text-slate-400">License Admin · لوحة الإدارة</div>
        </div>
        <nav className="flex-1 py-4 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center justify-between px-5 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-cyan-500/15 text-cyan-300 border-r-2 border-cyan-400'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
                }`
              }
            >
              <span>{n.label}</span>
              <span className="text-[11px] text-slate-500">{n.ar}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800 text-xs">
          <div className="text-slate-400 mb-1">Signed in</div>
          <div className="truncate">{admin?.email}</div>
          <button
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            className="mt-3 w-full btn-secondary"
          >
            Sign out · تسجيل خروج
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
