import type { TradingAccess } from "@corepilot/shared";

const TESTNET_INFO = "https://api.hyperliquid-testnet.xyz/info";
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

async function userRole(address: string, request: typeof fetch): Promise<unknown> {
  const response = await request(TESTNET_INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "userRole", user: address }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HyperCore testnet role HTTP ${response.status}`);
  return response.json();
}

/** Read-only venue check. No order, agent approval or key access happens here. */
export async function inspectTradingAccessAtVenue(access: TradingAccess,
  request: typeof fetch = fetch): Promise<{ ready: boolean; reason: string }> {
  try {
    const agent = await userRole(access.agentAddress, request) as { role?: unknown; data?: { user?: unknown } };
    if (agent?.role !== "agent" || typeof agent.data?.user !== "string") return { ready: false, reason: "AGENT_NOT_APPROVED" };
    if (!same(agent.data.user, access.trader)) return { ready: false, reason: "AGENT_WRONG_OWNER" };
    if (access.isolationMode === "COMPATIBILITY") return same(access.executionAccount, access.trader)
      ? { ready: true, reason: "READY" } : { ready: false, reason: "ACCOUNT_MUST_MATCH_WALLET" };
    if (access.isolationMode !== "ISOLATED" || same(access.executionAccount, access.trader)) return { ready: false, reason: "SUBACCOUNT_REQUIRED" };
    const account = await userRole(access.executionAccount, request) as { role?: unknown; data?: { master?: unknown } };
    if (account?.role !== "subAccount" || typeof account.data?.master !== "string") return { ready: false, reason: "SUBACCOUNT_NOT_FOUND" };
    return same(account.data.master, access.trader)
      ? { ready: true, reason: "READY" } : { ready: false, reason: "SUBACCOUNT_WRONG_OWNER" };
  } catch {
    return { ready: false, reason: "VENUE_UNAVAILABLE" };
  }
}

export async function verifyTradingAccessAtVenue(access: TradingAccess,
  request: typeof fetch = fetch): Promise<boolean> {
  return (await inspectTradingAccessAtVenue(access, request)).ready;
}
