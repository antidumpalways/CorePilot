import { useState } from "react";
import type { WalletClient } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { getCorePilotClient, hasContractConfig } from "../lib/corepilot";
import { shortenHash } from "../lib/format";
import { Spinner } from "./Feedback";

export function FaucetButton() {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const disabled = !isConnected || !walletClient || !hasContractConfig || busy;

  async function run() {
    if (!walletClient) return;
    setBusy(true);
    setStatus(null);
    try {
      const client = getCorePilotClient();
      const hash = await client.write.faucetPilot(walletClient as unknown as WalletClient);
      setOk(true);
      setStatus(shortenHash(hash));
    } catch (error) {
      setOk(false);
      setStatus(error instanceof Error ? error.message : "faucet failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="cp-btn-ghost"
        disabled={disabled}
        title={!hasContractConfig ? "Configure contract addresses to enable" : "Mint test PILOT"}
        onClick={run}
      >
        {busy && <Spinner className="h-3.5 w-3.5" />}
        PILOT Faucet
      </button>
      {status && (
        <span
          className={`cp-mono hidden text-[11px] sm:inline ${
            ok ? "text-long" : "text-short"
          }`}
          title={status}
        >
          {status}
        </span>
      )}
    </div>
  );
}
