const { audit } = require('./audit');

function checkPermission(permissionCode) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'missing user context' });

    // Super Admin bypasses all checks
    if (req.user.role === 'role-superadmin') return next();

    const perms = req.user.permissions || [];
    if (perms.includes(permissionCode)) return next();

    audit(req, 'permission_denied', 'auth', req.user.sub || req.user.id, {
      attempted: permissionCode,
      role: req.user.role,
    });
    return res.status(403).json({
      error: 'غير مصرح / Forbidden',
      required: permissionCode,
    });
  };
}

module.exports = { checkPermission };
