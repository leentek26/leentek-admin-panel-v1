import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

// `perm: null` → always visible to anyone logged in.
const NAV = [
  { to: '/', label: 'Dashboard', ar: 'لوحة التحكم', perm: null, end: true },
  { to: '/register', label: 'Register', ar: 'تسجيل عميل', perm: 'customers.create' },
  { to: '/customers', label: 'Customers', ar: 'العملاء', perm: 'customers.view' },
  { to: '/generate', label: 'Generate License', ar: 'إصدار ترخيص', perm: 'licenses.generate' },
  { to: '/licenses', label: 'Licenses', ar: 'التراخيص', perm: 'licenses.view' },
  { to: '/verify', label: 'Verify', ar: 'التحقق', perm: 'verify.check' },
  { to: '/employees', label: 'Employees', ar: 'الموظفون', perm: 'employees.view' },
  { to: '/roles', label: 'Roles', ar: 'الأدوار', perm: 'roles.view' },
  { to: '/apikeys', label: 'API Keys', ar: 'مفاتيح API', perm: 'apikeys.view' },
  { to: '/audit', label: 'Audit Log', ar: 'سجل التدقيق', perm: 'audit.view' },
  { to: '/settings', label: 'Settings', ar: 'الإعدادات', perm: null },
];

export default function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  const visible = NAV.filter((n) => !n.perm || hasPermission(n.perm));
  const roleLabel = user?.role_name || user?.role_id || '';
  const isSuper = user?.role_id === 'role-superadmin';

  return (
    <div className="min-h-full bg-slate-900 text-slate-100 flex">
      <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-xl font-bold tracking-tight">Leentek</div>
          <div className="text-xs text-slate-400">License Admin · لوحة الإدارة</div>
        </div>
        <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
          {visible.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
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
        <div className="p-4 border-t border-slate-800 text-xs space-y-2">
          <div>
            <div className="text-slate-400 mb-1">Signed in · مسجل دخول</div>
            <div className="font-medium text-slate-100 truncate">{user?.name || '—'}</div>
            <div className="text-slate-400 truncate">{user?.email}</div>
            {user?.employee_code && (
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                {user.employee_code}
              </div>
            )}
            <div className="mt-2">
              <span
                className={
                  isSuper
                    ? 'inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-amber-400/15 border border-amber-400/40 text-amber-300'
                    : 'inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-400/15 border border-cyan-400/40 text-cyan-300'
                }
              >
                {roleLabel}
                {user?.role_name_ar ? ` · ${user.role_name_ar}` : ''}
              </span>
            </div>
          </div>
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
