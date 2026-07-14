import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { tryAdminLogin, isAdminPasswordCustomized } from '../services/adminAuth';

/**
 * Soft password gate for the admin area. Workers see this if they tap on
 * "Admin" in the topbar; managers know the password and proceed.
 *
 * NOT real security — anyone with browser dev tools can read the stored
 * password. This is a UX gate to keep warehouse workers out of management
 * screens by accident, not a security boundary.
 */
export function AdminGateRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tryAdminLogin(password)) {
      // Re-render at the same path; the AdminGate wrapper in App.tsx now
      // sees us as authenticated and renders the wrapped route.
      navigate(location.pathname, { replace: true });
      // Force re-render via small state hop — since sessionStorage isn't
      // reactive, the simplest reliable approach is a hard reload
      window.location.reload();
    } else {
      setError('Incorrect password. Try again.');
      setPassword('');
    }
  };

  return (
    <main>
      <div className="admin-gate">
        <div className="admin-gate__lock">🔒</div>
        <h1 className="admin-gate__title">Admin access</h1>
        <p className="admin-gate__sub">
          Enter the admin password to access management screens.
        </p>

        <form onSubmit={submit}>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError('');
            }}
            placeholder="Admin password"
            autoFocus
            autoComplete="off"
            style={{ textAlign: 'center', letterSpacing: '0.1em' }}
          />
          {error && <div className="admin-gate__error">{error}</div>}
          <button
            type="submit"
            className="btn btn--accent btn--lg"
            disabled={!password}
            style={{ width: '100%', marginTop: 12 }}
          >
            Unlock
          </button>
        </form>

        {!isAdminPasswordCustomized() && (
          <div className="admin-gate__hint">
            Default password not yet changed. Manager: change it from inside admin.
          </div>
        )}

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => navigate('/')}
          style={{ marginTop: 16 }}
        >
          ← Back to inspections
        </button>
      </div>
    </main>
  );
}
