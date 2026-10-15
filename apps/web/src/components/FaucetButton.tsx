import { useEffect, useState } from "react";
import type { WalletClient } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { getCorePilotClient, hasContractConfig } from "../lib/corepilot";
import { fetchCapabilities } from "../lib/api";
import { shortenHash } from "../lib/format";
import { Spinner } from "./Feedback";
import { elysiumTestnet } from "../lib/wagmi";

export function FaucetButton({ onConfirmed }: { onConfirmed?: () => void }) {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [claimed, setClaimed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    setClaimed(null);
    setStatus(null);
    if (!address || !hasContractConfig) return;
    getCorePilotClient().read.hasClaimedPilotFaucet(address)
      .then(used => { if (active) setClaimed(used); })
      .catch(() => { if (active) { setClaimed(false); setStatus("Faucet status unavailable; check again before claiming."); } });
    return () => { active = false; };
  }, [address]);

  const disabled = !isConnected || !walletClient || !hasContractConfig ||
    chainId !== elysiumTestnet.id || busy || claimed !== false;

  async function run() {
    if (!walletClient || !address) return;
    setBusy(true);
    setStatus(null);
    try {
      const client = getCorePilotClient();
      const capabilities = await fetchCapabilities();
      if (capabilities.source !== "TESTNET" ||
          capabilities.data.contracts?.deployment?.pilotToken?.toLowerCase() !== client.addresses.pilotToken?.toLowerCase()) {
        throw new Error("Web and API use different PILOT deployments. Hard-refresh this tab before claiming.");
      }
      if (await client.read.hasClaimedPilotFaucet(address)) {
        setClaimed(true);
        setOk(true);
        setStatus("Already claimed · use your existing PILOT balance");
        onConfirmed?.();
        return;
      }
      const hash = await client.write.faucetPilot(walletClient as unknown as WalletClient);
      setStatus(`Confirming ${shortenHash(hash)}`);
      const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("PILOT faucet transaction reverted");
      setOk(true);
      setClaimed(true);
      setStatus(shortenHash(hash));
      onConfirmed?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "faucet failed";
      if (/PILOT_FAUCET_ALREADY_CLAIMED|PILOT: faucet used/i.test(message)) {
        setClaimed(true);
        setOk(true);
        setStatus("Already claimed · use your existing PILOT balance");
        onConfirmed?.();
      } else {
        setOk(false);
        setStatus(/ELYSIUM_GAS_ESTIMATE_ABOVE_SAFETY_LIMIT/i.test(message)
          ? "Gas estimate is unsafe. No transaction was sent; refresh and check the wallet/network."
          : message);
      }
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
        title={!hasContractConfig ? "Configure contract addresses to enable" : claimed ? "One claim per wallet" : "Mint test PILOT"}
        onClick={run}
      >
        {busy && <Spinner className="h-3.5 w-3.5" />}
        {claimed === null && address ? "Checking faucet…" : claimed ? "PILOT claimed" : "PILOT Faucet"}
      </button>
      {status && (
        <span
          className={`cp-mono text-[11px] ${
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
