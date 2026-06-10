import { Link, NavLink, Outlet } from 'react-router-dom';

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-panel-2 text-snow' : 'text-fog hover:text-snow hover:bg-panel-2/60'
  }`;

export default function Layout() {
  return (
    <div className="min-h-screen bg-ink">
      <header className="sticky top-0 z-40 border-b border-edge bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 font-mono text-base font-bold text-ink">
              P
            </span>
            <span className="text-lg font-bold tracking-tight">
              PIXA <span className="gradient-text">Registry</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navLink}>
              Explore
            </NavLink>
            <NavLink to="/dashboard" className={navLink}>
              Dashboard
            </NavLink>
            <NavLink
              to="/register"
              className="ml-2 rounded-lg bg-gradient-to-r from-accent to-accent-2 px-4 py-1.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              List your API
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-edge py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-sm text-fog sm:flex-row sm:px-6">
          <p>
            PIXA Registry — agent-native discovery for <span className="font-mono text-accent">x402</span> machine-payable APIs.
          </p>
          <p className="font-mono text-xs">multichain · verified · open</p>
        </div>
      </footer>
    </div>
  );
}
