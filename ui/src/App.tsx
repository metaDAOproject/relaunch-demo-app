import { useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { DemoProvider, type DemoConfig } from "./lib/demo";
import { ChainStateProvider, useChain } from "./lib/state";
import { ToastProvider, Toasts } from "./lib/toasts";
import { Header } from "./components/Header";
import { Stepper } from "./components/Stepper";
import { Banners } from "./components/Banners";
import { HowItWorks, StatusCard } from "./components/StatusCard";
import { DepositCard } from "./components/DepositCard";
import {
  ClaimCard,
  DaoCard,
  ExecutionCard,
  PositionCard,
  RefundCard,
} from "./components/LifecycleCards";
import { CheatsPanel } from "./components/CheatsPanel";

function Layout() {
  const { chain } = useChain();

  return (
    <div className="wrap">
      <Header />
      <Stepper />
      {chain && (
        <>
          <Banners />
          <div className="a-grid">
            <div className="col">
              <StatusCard />
              <ExecutionCard />
              {["initialized", "live"].includes(chain.relaunch.stateName) && (
                <HowItWorks />
              )}
            </div>
            <div className="col">
              <DepositCard />
              <ClaimCard />
              <RefundCard />
              <PositionCard />
              <DaoCard />
            </div>
          </div>
        </>
      )}
      {!chain && (
        <div className="splash-box" style={{ marginTop: 40 }}>
          Reading the relaunch from the fork…
        </div>
      )}
      <CheatsPanel />
      <Toasts />
    </div>
  );
}

function DemoApp({ config }: { config: DemoConfig }) {
  // Explicit adapters keep all three visible in the modal even when the
  // extension isn't installed; wallet-standard detection dedupes installed
  // ones by name, so nothing is listed twice.
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new BackpackWalletAdapter(),
    ],
    [],
  );
  return (
    <ConnectionProvider
      endpoint={config.rpcUrl}
      config={{ commitment: "confirmed", wsEndpoint: config.wsUrl }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <DemoProvider config={config}>
            <ToastProvider>
              <ChainStateProvider>
                <Layout />
              </ChainStateProvider>
            </ToastProvider>
          </DemoProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function Root() {
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/demo-config.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            "demo-config.json not found — the bootstrap writes it; start everything with ./demo/relaunch/run.sh",
          );
        }
        return response.json();
      })
      .then(setConfig)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="splash">
        <div className="splash-box error">
          <b>No demo config</b>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="splash">
        <div className="splash-box">Loading…</div>
      </div>
    );
  }
  return <DemoApp config={config} />;
}
