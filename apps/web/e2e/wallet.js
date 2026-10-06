/**
 * Test-only EIP-1193 wallet injected into the page for end-to-end runs against a LOCAL anvil chain.
 * Anvil's development accounts are unlocked, so signing requests are forwarded to the node.
 * Announced via EIP-6963 so the app discovers it exactly like a real browser wallet.
 */
(() => {
  const RPC = window.__E2E_RPC__ || "http://127.0.0.1:8545";
  const ACCOUNT = window.__E2E_ACCOUNT__;
  const listeners = {};
  let id = 0;
  // Like a real wallet: no accounts until the user connects; the approval persists across reloads.
  const KEY = "__e2e_wallet_approved__";
  let approved = localStorage.getItem(KEY) === "1";
  const approve = () => {
    approved = true;
    localStorage.setItem(KEY, "1");
  };
  const rpc = async (method, params) => {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }),
    });
    const body = await res.json();
    if (body.error) {
      const err = new Error(body.error.message);
      err.code = body.error.code;
      err.data = body.error.data;
      throw err;
    }
    return body.result;
  };
  const provider = {
    isMetaMask: false,
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
          approve();
          return [ACCOUNT];
        case "eth_accounts":
          return approved ? [ACCOUNT] : [];
        case "eth_chainId":
          return "0x7a69";
        case "net_version":
          return "31337";
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        case "wallet_requestPermissions":
          approve();
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_revokePermissions":
          approved = false;
          localStorage.removeItem(KEY);
          return null;
        case "wallet_getPermissions":
          return approved ? [{ parentCapability: "eth_accounts" }] : [];
        case "eth_signTypedData_v4":
          return rpc("eth_signTypedData_v4", params);
        default:
          return rpc(method, params);
      }
    },
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    removeListener(event, fn) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
    },
  };
  const info = {
    uuid: "4c7e1a52-0e2d-4b4f-9c50-6d1d8b0e2e2e",
    name: "E2E Test Wallet",
    icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' rx='8' fill='%23d6b26e'/></svg>",
    rdns: "dev.atlaspad.e2e",
  };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
