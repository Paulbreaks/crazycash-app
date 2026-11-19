import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ShellProviders } from './providers/ShellProviders';
import { DevPage } from '../pages/DevPage';
import { GamePage } from '../pages/GamePage';
import { HomePage } from '../pages/HomePage';
import { TermsPage } from '../pages/TermsPage';

function AppRoutes() {
  const location = useLocation();
  const isGameRoute = location.pathname === '/game';
  const isHomeRoute = location.pathname === '/';
  const isTermsRoute = location.pathname === '/terms';

  return (
    <div className={isGameRoute ? 'game-shell' : isHomeRoute ? 'home-shell' : isTermsRoute ? 'terms-shell' : 'shell min-h-dvh'}>
      {!isGameRoute && !isHomeRoute && !isTermsRoute ? (
          <header className="shell-header">
            <h1>Crazy Cash Shell</h1>
            <nav className="shell-nav">
              <Link to="/">Home</Link>
              <Link to="/game">Game</Link>
              <Link to="/dev">Dev</Link>
            </nav>
          </header>
      ) : null}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/game" element={<GamePage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/dev" element={<DevPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export function App() {
  return (
    <ShellProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ShellProviders>
  );
}
