require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
require('./db'); // initialise schema + bootstrap admin

const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const licenseRoutes = require('./routes/licenses');
const verifyRoutes = require('./routes/verify');
const apikeyRoutes = require('./routes/apikeys');
const auditRoutes = require('./routes/audit');
const employeeRoutes = require('./routes/employees');
const roleRoutes = require('./routes/roles');

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", CORS_ORIGIN],
        imgSrc: ["'self'", 'data:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(
  cors({
    origin: CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// 100 req/min for admin routes
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate limit exceeded — 100 req/min' },
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'license-admin' }));

app.use('/api/auth', adminLimiter, authRoutes);
app.use('/api/customers', adminLimiter, customerRoutes);
app.use('/api/licenses', adminLimiter, licenseRoutes);
app.use('/api/apikeys', adminLimiter, apikeyRoutes);
app.use('/api/audit', adminLimiter, auditRoutes);
app.use('/api/employees', adminLimiter, employeeRoutes);
app.use('/api/roles', adminLimiter, roleRoutes);
app.use('/api/verify', verifyRoutes); // verify has its own 30/min limiter inside

// 404
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// Error handler
app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => {
  logger.info(`License admin server listening on http://localhost:${PORT}`);
  logger.info(`CORS origin: ${CORS_ORIGIN}`);
});
