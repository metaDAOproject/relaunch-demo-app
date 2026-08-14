// Demo runtime context: the bootstrap-written config, a Connection to the
// surfpool fork, the RelaunchClient (provider wallet = the demo admin
// keypair, which signs cheats and admin ops silently), and the injected
// global ALT that every send resolves accounts through.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { RelaunchClient } from "@metadaoproject/programs";

export type DemoConfig = {
  rpcUrl: string;
  wsUrl: string;
  relaunchProgramId: string;
  relaunch: string;
  newMint: string;
  oldMint: string;
  sourcePool: string;
  poolTokenVault: string;
  poolQuoteVault: string;
  ammCoinVault: string;
  ammPcVault: string;
  oldTokenVault: string;
  sourceQuoteVault: string;
  usdcVault: string;
  newTokenVault: string;
  globalAlt: string;
  adminSecretKey: number[];
  tokenName: string;
  tokenSymbol: string;
  oldTokenDecimals: number;
  newTokenDecimals: number;
  thresholdBps: number;
  secondsForDeposits: number;
  gracePeriodSeconds: number;
};

export type Demo = {
  config: DemoConfig;
  connection: Connection;
  client: RelaunchClient;
  admin: Keypair;
  alt: AddressLookupTableAccount;
  relaunch: PublicKey;
  newMint: PublicKey;
  oldMint: PublicKey;
  sourcePool: PublicKey;
  poolTokenVault: PublicKey;
  poolQuoteVault: PublicKey;
  ammCoinVault: PublicKey;
  ammPcVault: PublicKey;
  oldTokenVault: PublicKey;
  sourceQuoteVault: PublicKey;
  usdcVault: PublicKey;
  globalAlt: PublicKey;
};

// Minimal Wallet for AnchorProvider — the client's .rpc() conveniences are
// never used in the UI (everything goes through sendV0), so this only backs
// account fetching and instruction building.
class KeypairWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof VersionedTransaction) tx.sign([this.payer]);
    else tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

const DemoContext = createContext<Demo | null>(null);

export function useDemo(): Demo {
  const demo = useContext(DemoContext);
  if (!demo) throw new Error("useDemo outside DemoProvider");
  return demo;
}

export function DemoProvider({
  config,
  children,
}: {
  config: DemoConfig;
  children: ReactNode;
}) {
  const [demo, setDemo] = useState<Demo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const connection = new Connection(config.rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: config.wsUrl,
    });
    const admin = Keypair.fromSecretKey(Uint8Array.from(config.adminSecretKey));
    const provider = new AnchorProvider(connection, new KeypairWallet(admin), {
      commitment: "confirmed",
    });
    const client = RelaunchClient.createClient({
      provider,
      relaunchProgramId: new PublicKey(config.relaunchProgramId),
    });

    (async () => {
      const globalAlt = new PublicKey(config.globalAlt);
      const alt = await connection.getAddressLookupTable(globalAlt);
      if (cancelled) return;
      if (!alt.value) {
        setError(
          `global ALT ${config.globalAlt} not found on the fork — re-run the bootstrap`,
        );
        return;
      }
      setDemo({
        config,
        connection,
        client,
        admin,
        alt: alt.value,
        relaunch: new PublicKey(config.relaunch),
        newMint: new PublicKey(config.newMint),
        oldMint: new PublicKey(config.oldMint),
        sourcePool: new PublicKey(config.sourcePool),
        poolTokenVault: new PublicKey(config.poolTokenVault),
        poolQuoteVault: new PublicKey(config.poolQuoteVault),
        ammCoinVault: new PublicKey(config.ammCoinVault),
        ammPcVault: new PublicKey(config.ammPcVault),
        oldTokenVault: new PublicKey(config.oldTokenVault),
        sourceQuoteVault: new PublicKey(config.sourceQuoteVault),
        usdcVault: new PublicKey(config.usdcVault),
        globalAlt,
      });
    })().catch((e) => {
      if (!cancelled) setError(String(e));
    });

    return () => {
      cancelled = true;
    };
  }, [config]);

  if (error) {
    return (
      <div className="splash">
        <div className="splash-box error">
          <b>Demo failed to connect</b>
          <p>{error}</p>
          <p>
            Is surfpool running? Start everything with{" "}
            <code>./demo/relaunch/run.sh</code>.
          </p>
        </div>
      </div>
    );
  }
  if (!demo) {
    return (
      <div className="splash">
        <div className="splash-box">Connecting to the fork…</div>
      </div>
    );
  }
  return <DemoContext.Provider value={demo}>{children}</DemoContext.Provider>;
}
