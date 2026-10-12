import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { DataSourceBadge } from "./DataSourceBadge";
import { FaucetButton } from "./FaucetButton";
import { WalletButton } from "./WalletButton";
import { hasContractConfig } from "../lib/corepilot";

const NAV = [
  { to: "/strategies", label: "Strategies" },
  { to: "/create", label: "Create" },
  { to: "/monitor", label: "Monitor" },
];

function navClass(isActive: boolean): string {
  return `rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive ? "bg-ink-700 text-paper" : "text-muted hover:bg-ink-700/60 hover:text-paper"
  }`;
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      <header className="sticky top-0 z-20 border-b border-line bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded border border-accent/50 bg-accent/15 text-accent">
                <span className="text-xs font-bold">CP</span>
              </span>
              <span className="text-sm font-semibold tracking-tight text-paper">CorePilot</span>
            </NavLink>
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => navClass(isActive)}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <FaucetButton />
            <WalletButton />
          </div>
        </div>
        <nav className="flex items-center gap-1 border-t border-line px-4 py-1.5 md:hidden">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => navClass(isActive)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {!hasContractConfig && (
        <div className="border-b border-warn/30 bg-warn/10">
          <div className="mx-auto w-full max-w-7xl px-4 py-2 text-[11px] text-warn">
            SDK unconfigured — set the <span className="cp-mono">VITE_*_ADDRESS</span> variables to
            enable on-chain reads, strategy creation and the PILOT faucet. Read-only demo mode is active.
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t border-line bg-ink-900/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 text-[11px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="cp-label">Data sources</span>
            <DataSourceBadge source="LIVE" />
            <DataSourceBadge source="TESTNET" />
            <DataSourceBadge source="SIMULATED" />
            <DataSourceBadge source="DEMO" />
          </div>
          <p className="max-w-xl leading-relaxed">
            CorePilot is non-custodial. Nothing here is a return promise or APY. Simulated data is
            never presented as live. Testnet only.
          </p>
        </div>
      </footer>
    </div>
  );
}
