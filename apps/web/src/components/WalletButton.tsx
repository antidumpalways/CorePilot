import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { elysiumTestnet } from "../lib/wagmi";
import { shortenAddress } from "../lib/format";

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (!isConnected) {
    const injectedConnector = connectors[0];
    return (
      <button
        type="button"
        className="cp-btn-primary"
        disabled={!injectedConnector || isPending}
        title={error ? error.message : "Connect an injected wallet"}
        onClick={() => {
          if (injectedConnector) connect({ connector: injectedConnector });
        }}
      >
        {isPending ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  const wrongChain = chainId !== elysiumTestnet.id;

  return (
    <div className="flex items-center gap-2">
      {wrongChain && (
        <button
          type="button"
          className="cp-btn border-warn/50 bg-warn/10 text-warn"
          disabled={isSwitching}
          onClick={() => switchChain({ chainId: elysiumTestnet.id })}
        >
          {isSwitching ? "Switching…" : "Switch to Elysium"}
        </button>
      )}
      <button
        type="button"
        className="cp-btn-ghost cp-mono"
        title={`${address ?? ""} — click to disconnect`}
        onClick={() => disconnect()}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${wrongChain ? "bg-warn" : "bg-long"}`} />
        {shortenAddress(address ?? "")}
      </button>
    </div>
  );
}
