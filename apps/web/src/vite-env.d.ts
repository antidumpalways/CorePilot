/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_ELYSIUM_RPC_URL?: string;
  readonly VITE_ELYSIUM_CHAIN_ID?: string;
  readonly VITE_PILOT_TOKEN_ADDRESS?: string;
  readonly VITE_STAKING_ADDRESS?: string;
  readonly VITE_STRATEGY_REGISTRY_ADDRESS?: string;
  readonly VITE_EXECUTION_CONTROLLER_ADDRESS?: string;
  readonly VITE_MARKET_DATA_ORACLE_ADDRESS?: string;
  readonly VITE_FEE_MODULE_ADDRESS?: string;
  readonly VITE_RECEIPT_REGISTRY_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
