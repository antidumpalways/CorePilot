import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAccount } from "wagmi";
import { WalletButton } from "./WalletButton";
import { CorePilotMark } from "./CorePilotMark";
import { DataSourceBadge } from "./DataSourceBadge";
import { elysiumTestnet } from "../lib/wagmi";

const navigation = [
  { to: "/strategies", label: "Explore" },
  { to: "/my-strategies", label: "My Strategies" },
  { to: "/activity", label: "Activity" },
];

function Navigation({ onNavigate, mobile = false }: { onNavigate?: () => void; mobile?: boolean }) {
  return <nav aria-label="Primary navigation" className={mobile ? "grid grid-cols-3 gap-1" : "hidden items-center gap-1 md:flex"}>
    {navigation.map(item => <NavLink key={item.to} to={item.to} onClick={onNavigate} className={({ isActive }) => `cp-nav-item justify-center whitespace-nowrap ${isActive ? "cp-nav-item-active" : ""}`}>{item.label}</NavLink>)}
  </nav>;
}

function AppHeader() {
  const { chainId, isConnected } = useAccount();
  const [mobileOpen, setMobileOpen] = useState(false);
  const wrongNetwork = isConnected && chainId !== elysiumTestnet.id;
  return <header className="sticky top-0 z-30 border-b border-line bg-ink-950/85 backdrop-blur-xl">
    <div className="mx-auto flex h-[66px] max-w-[1520px] items-center gap-4 px-4 sm:px-6 lg:px-8">
      <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="CorePilot Home" onClick={() => setMobileOpen(false)}><CorePilotMark /><span className="text-[16px] font-extrabold tracking-[-.055em] text-paper">CorePilot</span></Link>
      <span className="mx-3 hidden h-5 w-px bg-line lg:block" />
      <Navigation />
      <div className="ml-auto flex items-center gap-2 sm:gap-3"><span className={`hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.08em] xl:inline-flex ${wrongNetwork ? "text-warn" : "text-muted"}`}><span className={`cp-status-dot ${wrongNetwork ? "bg-warn" : "bg-accent"}`} />{wrongNetwork ? "Wrong network" : "Elysium testnet"}</span><Link to="/create" className="cp-btn-primary hidden lg:inline-flex">Create Strategy <span aria-hidden>↗</span></Link><Link to="/create" className="cp-btn-primary hidden min-w-9 px-2 sm:inline-flex lg:hidden" aria-label="Create Strategy">＋</Link><WalletButton /><button type="button" className="cp-btn-ghost min-w-9 px-2 md:hidden" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? "×" : "☰"}</button></div>
    </div>
    {mobileOpen && <div className="border-t border-line bg-ink-900 px-4 py-3 md:hidden"><Navigation mobile onNavigate={() => setMobileOpen(false)} /><Link to="/create" onClick={() => setMobileOpen(false)} className="cp-btn-primary mt-3 w-full sm:hidden">Create Strategy ↗</Link></div>}
  </header>;
}

export function Layout({ children }: { children: ReactNode }) {
  return <div className="app-shell flex min-h-screen flex-col"><AppHeader />
    <main className="mx-auto w-full max-w-[1520px] flex-1 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">{children}</main>
    <footer className="border-t border-line"><div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-[11px] text-muted sm:px-6 lg:px-8"><span>CorePilot · Elysium testnet prototype</span><div className="flex items-center gap-3"><DataSourceBadge source="TESTNET" /><Link className="hover:text-paper" to="/monitor">Technical monitor ↗</Link><Link className="hover:text-paper" to="/app">System overview ↗</Link></div></div></footer>
  </div>;
}
