# CLAUDE.md — UPDATE: Employee Management & RBAC

## NEW FEATURE: Employee Management with Role-Based Access Control

Add this to the existing license admin panel. Do NOT rebuild existing features — only ADD the new employee/RBAC system.

## Database: Add these tables

```sql
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  category TEXT NOT NULL,
  category_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  employee_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role_id TEXT REFERENCES roles(id),
  department TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','inactive')),
  last_login DATETIME,
  login_attempts INTEGER DEFAULT 0,
  locked_until DATETIME,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_sessions (
  id TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_employees_role ON employees(role_id);
CREATE INDEX idx_employees_status ON employees(status);
CREATE INDEX idx_sessions_employee ON employee_sessions(employee_id);
CREATE INDEX idx_sessions_expires ON employee_sessions(expires_at);
```

## Seed Data: Default Roles

```sql
-- Super Admin: full unrestricted access — only the main admin
INSERT INTO roles (id, name, name_ar, description, is_system) VALUES
  ('role-superadmin', 'Super Admin', 'مدير عام', 'Full unrestricted access to all features', 1);

-- Admin: can manage customers, licenses, employees (no role/permission editing)
INSERT INTO roles (id, name, name_ar, description, is_system) VALUES
  ('role-admin', 'Admin', 'مدير', 'Manage customers, licenses, and employees', 1);

-- License Manager: can only manage licenses and verify
INSERT INTO roles (id, name, name_ar, description, is_system) VALUES
  ('role-license-mgr', 'License Manager', 'مدير تراخيص', 'Generate, revoke, and verify licenses only', 1);

-- Support: read-only access + verify
INSERT INTO roles (id, name, name_ar, description, is_system) VALUES
  ('role-support', 'Support', 'دعم فني', 'View customers and verify licenses only', 1);

-- Viewer: read-only dashboard
INSERT INTO roles (id, name, name_ar, description, is_system) VALUES
  ('role-viewer', 'Viewer', 'مشاهد', 'View dashboard and reports only', 1);
```

## Seed Data: Permissions

```sql
INSERT INTO permissions (id, code, name, name_ar, category, category_ar) VALUES
  -- Customers
  ('p-cust-view', 'customers.view', 'View Customers', 'عرض العملاء', 'Customers', 'العملاء'),
  ('p-cust-create', 'customers.create', 'Create Customers', 'إضافة عملاء', 'Customers', 'العملاء'),
  ('p-cust-edit', 'customers.edit', 'Edit Customers', 'تعديل عملاء', 'Customers', 'العملاء'),
  ('p-cust-delete', 'customers.delete', 'Delete Customers', 'حذف عملاء', 'Customers', 'العملاء'),
  -- Licenses
  ('p-lic-view', 'licenses.view', 'View Licenses', 'عرض التراخيص', 'Licenses', 'التراخيص'),
  ('p-lic-generate', 'licenses.generate', 'Generate Licenses', 'إنشاء تراخيص', 'Licenses', 'التراخيص'),
  ('p-lic-revoke', 'licenses.revoke', 'Revoke Licenses', 'إلغاء تراخيص', 'Licenses', 'التراخيص'),
  ('p-lic-export', 'licenses.export', 'Export Licenses', 'تصدير تراخيص', 'Licenses', 'التراخيص'),
  -- Verify
  ('p-verify', 'verify.check', 'Verify License Keys', 'التحقق من الرخص', 'Verification', 'التحقق'),
  -- Employees
  ('p-emp-view', 'employees.view', 'View Employees', 'عرض الموظفين', 'Employees', 'الموظفين'),
  ('p-emp-create', 'employees.create', 'Create Employees', 'إضافة موظفين', 'Employees', 'الموظفين'),
  ('p-emp-edit', 'employees.edit', 'Edit Employees', 'تعديل موظفين', 'Employees', 'الموظفين'),
  ('p-emp-delete', 'employees.delete', 'Delete/Suspend Employees', 'حذف/تعليق موظفين', 'Employees', 'الموظفين'),
  -- Roles
  ('p-role-view', 'roles.view', 'View Roles', 'عرض الأدوار', 'Roles', 'الأدوار'),
  ('p-role-manage', 'roles.manage', 'Manage Roles & Permissions', 'إدارة الأدوار والصلاحيات', 'Roles', 'الأدوار'),
  -- API Keys
  ('p-api-view', 'apikeys.view', 'View API Keys', 'عرض مفاتيح API', 'API Keys', 'مفاتيح API'),
  ('p-api-manage', 'apikeys.manage', 'Manage API Keys', 'إدارة مفاتيح API', 'API Keys', 'مفاتيح API'),
  -- Audit
  ('p-audit-view', 'audit.view', 'View Audit Log', 'عرض سجل المراجعة', 'Audit', 'المراجعة'),
  -- Settings
  ('p-settings', 'settings.manage', 'System Settings', 'إعدادات النظام', 'Settings', 'الإعدادات');
```

## Seed Data: Role-Permission Mapping

```sql
-- Super Admin: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
  SELECT 'role-superadmin', id FROM permissions;

-- Admin: all except roles.manage and settings
INSERT INTO role_permissions (role_id, permission_id)
  SELECT 'role-admin', id FROM permissions WHERE code NOT IN ('roles.manage', 'settings.manage');

-- License Manager: licenses + verify + view customers
INSERT INTO role_permissions (role_id, permission_id)
  SELECT 'role-license-mgr', id FROM permissions
  WHERE code IN ('customers.view', 'licenses.view', 'licenses.generate', 'licenses.revoke', 'licenses.export', 'verify.check');

-- Support: view customers + verify only
INSERT INTO role_permissions (role_id, permission_id)
  SELECT 'role-support', id FROM permissions
  WHERE code IN ('customers.view', 'licenses.view', 'verify.check');

-- Viewer: view only
INSERT INTO role_permissions (role_id, permission_id)
  SELECT 'role-viewer', id FROM permissions
  WHERE code IN ('customers.view', 'licenses.view', 'audit.view');
```

## API Endpoints: Employee Management

### Employees (JWT protected + permission check)
- GET    /api/employees                — requires employees.view
- GET    /api/employees/:id            — requires employees.view
- POST   /api/employees                — requires employees.create
- PUT    /api/employees/:id            — requires employees.edit
- POST   /api/employees/:id/suspend    — requires employees.delete
- POST   /api/employees/:id/activate   — requires employees.delete
- DELETE /api/employees/:id            — requires employees.delete (soft delete)
- POST   /api/employees/:id/reset-password — requires employees.edit

### Roles (JWT protected + permission check)
- GET    /api/roles                    — requires roles.view
- GET    /api/roles/:id                — requires roles.view (includes permissions)
- POST   /api/roles                    — requires roles.manage
- PUT    /api/roles/:id                — requires roles.manage
- DELETE /api/roles/:id                — requires roles.manage (cannot delete system roles)
- PUT    /api/roles/:id/permissions    — requires roles.manage

### Auth Updates
- POST   /api/auth/login              — support employee login (check employees table too)
- POST   /api/auth/change-password    — any logged-in user can change own password
- POST   /api/auth/update-profile     — any logged-in user can update own name/email
- GET    /api/auth/me                 — returns current user + role + permissions
- GET    /api/auth/sessions           — Super Admin: view all active sessions
- DELETE /api/auth/sessions/:id       — Super Admin: force logout a session

## Middleware: Permission Check

```javascript
// middleware/checkPermission.js
function checkPermission(permissionCode) {
  return (req, res, next) => {
    // Super Admin bypasses all checks
    if (req.user.role === 'role-superadmin') return next();
    
    const hasPermission = req.user.permissions.includes(permissionCode);
    if (!hasPermission) {
      auditLog('permission_denied', 'auth', req.user.id, { 
        attempted: permissionCode, 
        role: req.user.role 
      }, req.ip);
      return res.status(403).json({ 
        error: 'غير مصرح / Forbidden',
        required: permissionCode 
      });
    }
    next();
  };
}

// Usage:
router.post('/customers', auth, checkPermission('customers.create'), createCustomer);
router.post('/licenses/generate', auth, checkPermission('licenses.generate'), generateLicense);
```

## Security Rules

1. Super Admin (is_system=1) role cannot be deleted or modified
2. Super Admin account cannot be deleted — only password/email can change
3. Account locks after 5 failed login attempts for 15 minutes
4. Password minimum 8 chars, must include uppercase + lowercase + number
5. Employee cannot elevate their own role
6. Employee cannot edit/delete users with higher role level
7. All permission denials logged to audit_log
8. Sessions expire after 24 hours, can be force-terminated by Super Admin
9. Password changes invalidate all other sessions for that user

## Frontend: New Pages

### EmployeesPage
- Table: employee_code, name, email, role (badge), status, last_login
- Create/Edit modal with role selector dropdown
- Suspend/Activate/Reset Password actions
- Only visible if user has employees.view permission

### RolesPage  
- Card grid showing all roles with permission count badge
- Click role → expand to show permission checkboxes grouped by category
- Toggle permissions on/off per role
- Create custom roles
- System roles (is_system=1) show lock icon — cannot delete
- Only visible if user has roles.view permission
- Edit only if user has roles.manage permission

### SettingsPage
- Change own password (available to all users)
- Change own name/email (available to all users)
- Super Admin section: change admin email/password
- Active sessions list with force-logout button (Super Admin only)
- Only full settings visible to users with settings.manage permission

### Sidebar Updates
- Show/hide menu items based on user permissions
- Show current user name + role badge at bottom of sidebar
- Logout button

## Employee Code Format
- Format: EMP-{4-digit-sequential} — e.g. EMP-0001
- Sequential per organization (not per role)
- Simple because employees are internal — no security concern with sequential
