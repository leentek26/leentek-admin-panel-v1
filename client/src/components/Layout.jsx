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

// Brand-aligned role badge tones. Super Admin gets the warm orange "command" tone;
// Admin shares the magenta family; lower roles take cooler tones.
const ROLE_BADGE_TONE = {
  'role-superadmin': 'bg-brand-orange/15 border-brand-orange/40 text-brand-orange',
  'role-admin': 'bg-brand-magenta/15 border-brand-magenta/40 text-brand-magenta',
  'role-license-mgr': 'bg-brand-cyan/15 border-brand-cyan/40 text-brand-cyan',
  'role-support': 'bg-brand-purple/20 border-brand-purple/40 text-ink-100',
  'role-viewer': 'bg-ink-700/40 border-ink-700 text-ink-300',
};

export default function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  const visible = NAV.filter((n) => !n.perm || hasPermission(n.perm));
  const roleLabel = user?.role_name || user?.role_id || '';
  const badgeClass =
    ROLE_BADGE_TONE[user?.role_id] || 'bg-ink-700/40 border-ink-700 text-ink-100';

  return (
    <div className="min-h-full bg-page text-ink-100 flex">
      <aside className="w-64 bg-brand-purpleNav border-r border-line flex flex-col">
        <div className="px-5 py-5 border-b border-line/60 flex flex-col items-center">
          <img src="/icon.png" alt="Leentek" className="h-8 w-auto mb-2" />
          <div className="text-[11px] text-ink-300 tracking-wider uppercase">License Admin</div>
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
                    ? 'bg-brand-orange/15 text-brand-orange border-r-2 border-brand-orange'
                    : 'text-ink-100/85 hover:bg-white/5 hover:text-ink-100'
                }`
              }
            >
              <span>{n.label}</span>
              <span className="text-[11px] text-ink-300">{n.ar}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-line/60 text-xs space-y-2">
          <div>
            <div className="text-ink-300 mb-1">Signed in · مسجل دخول</div>
            <div className="font-medium text-ink-100 truncate">{user?.name || '—'}</div>
            <div className="text-ink-300 truncate">{user?.email}</div>
            {user?.employee_code && (
              <div className="text-[10px] font-mono text-ink-500 mt-0.5">
                {user.employee_code}
              </div>
            )}
            <div className="mt-2">
              <span
                className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${badgeClass}`}
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
