import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import CustomersPage from './pages/CustomersPage.jsx';
import GeneratePage from './pages/GeneratePage.jsx';
import LicensesPage from './pages/LicensesPage.jsx';
import VerifyPage from './pages/VerifyPage.jsx';
import ApiKeysPage from './pages/ApiKeysPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import RolesPage from './pages/RolesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-300">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="generate" element={<GeneratePage />} />
        <Route path="licenses" element={<LicensesPage />} />
        <Route path="verify" element={<VerifyPage />} />
        <Route path="apikeys" element={<ApiKeysPage />} />
        <Route path="audit" element={<AuditLogPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
