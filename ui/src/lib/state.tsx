// Chain state polling. One getMultipleAccountsInfo every 2 seconds covers
// the relaunch account, the Clock sysvar, the source pool vaults, the
// relaunch vaults, the SOL/USDC whirlpool (for USD pricing), and the
// connected wallet's accounts; a depositRecord.all() alongside it counts
// depositors and carries the user's record. Countdowns everywhere derive
// from the polled Clock (extrapolated between polls), never Date.now()
// directly — so the time-travel cheat honestly moves every timer.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { AccountLayout, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { parseWhirlpool, USDC_SWAP_POOL } from "@metadaoproject/programs";
import { useDemo, type Demo } from "./demo";

export type RelaunchStateName =
  | "initialized"
  | "live"
  | "sellPending"
  | "sold"
  | "swapped"
  | "complete"
  | "failed";

export type RelaunchView = {
  stateName: RelaunchStateName;
  admin: PublicKey;
  totalDeposited: bigint;
  oldSupplySnapshot: bigint;
  threshold: bigint;
  thresholdBps: number;
  secondsForDeposits: number;
  gracePeriodSeconds: number;
  startedTs: number | null;
  closedTs: number | null;
  completedTs: number | null;
  quoteRecovered: bigint;
  usdcRecovered: bigint;
  dao: PublicKey | null;
  daoVault: PublicKey | null;
};

export type UserView = {
  wallet: PublicKey;
  sol: bigint;
  oldBalance: bigint;
  newBalance: bigint;
  deposited: bigint;
  claimed: boolean;
  hasRecord: boolean;
};

export type ChainState = {
  polledAtMs: number;
  clockTs: number;
  relaunch: RelaunchView;
  poolTokenReserve: bigint;
  poolQuoteReserve: bigint;
  escrowBalance: bigint;
  quoteVaultBalance: bigint;
  usdcVaultBalance: bigint;
  solUsd: number;
  depositorCount: number;
  user: UserView | null;
};

type StateContextValue = {
  chain: ChainState | null;
  refresh: () => Promise<void>;
};

const StateContext = createContext<StateContextValue | null>(null);

export function useChain(): StateContextValue {
  const value = useContext(StateContext);
  if (!value) throw new Error("useChain outside ChainStateProvider");
  return value;
}

// The on-chain clock, extrapolated between polls (surfpool's clock advances
// in real time) and re-rendered every second.
export function useChainNow(): number {
  const { chain } = useChain();
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  if (!chain) return 0;
  return chain.clockTs + Math.floor((Date.now() - chain.polledAtMs) / 1000);
}

function tokenAmount(data: Buffer | undefined | null): bigint {
  if (!data) return 0n;
  return AccountLayout.decode(data).amount;
}

async function pollOnce(
  demo: Demo,
  walletPk: PublicKey | null,
): Promise<ChainState> {
  const keys = [
    demo.relaunch,
    SYSVAR_CLOCK_PUBKEY,
    demo.poolTokenVault,
    demo.poolQuoteVault,
    demo.oldTokenVault,
    demo.sourceQuoteVault,
    demo.usdcVault,
    USDC_SWAP_POOL,
  ];
  const oldAta = walletPk
    ? getAssociatedTokenAddressSync(demo.oldMint, walletPk)
    : null;
  const newAta = walletPk
    ? getAssociatedTokenAddressSync(demo.newMint, walletPk)
    : null;
  if (walletPk && oldAta && newAta) keys.push(walletPk, oldAta, newAta);

  const [infos, records] = await Promise.all([
    demo.connection.getMultipleAccountsInfo(keys),
    demo.client.relaunchProgram.account.depositRecord.all([
      { memcmp: { offset: 8, bytes: demo.relaunch.toBase58() } },
    ]),
  ]);

  const relaunchInfo = infos[0];
  if (!relaunchInfo) throw new Error("relaunch account not found");
  const decoded = demo.client.relaunchProgram.coder.accounts.decode(
    "relaunch",
    relaunchInfo.data,
  );

  const stateName = Object.keys(decoded.state)[0] as RelaunchStateName;
  const oldSupplySnapshot = BigInt(decoded.oldSupplySnapshot.toString());
  const relaunch: RelaunchView = {
    stateName,
    admin: decoded.admin,
    totalDeposited: BigInt(decoded.totalDeposited.toString()),
    oldSupplySnapshot,
    threshold: (BigInt(decoded.thresholdBps) * oldSupplySnapshot) / 10_000n,
    thresholdBps: decoded.thresholdBps,
    secondsForDeposits: decoded.secondsForDeposits,
    gracePeriodSeconds: decoded.gracePeriodSeconds,
    startedTs: decoded.unixTimestampStarted
      ? Number(decoded.unixTimestampStarted.toString())
      : null,
    closedTs: decoded.unixTimestampClosed
      ? Number(decoded.unixTimestampClosed.toString())
      : null,
    completedTs: decoded.unixTimestampCompleted
      ? Number(decoded.unixTimestampCompleted.toString())
      : null,
    quoteRecovered: BigInt(decoded.quoteRecovered.toString()),
    usdcRecovered: BigInt(decoded.usdcRecovered.toString()),
    dao: decoded.dao ?? null,
    daoVault: decoded.daoVault ?? null,
  };

  const clockTs = Number(infos[1]!.data.readBigInt64LE(32));

  // USD per SOL from the whirlpool's sqrtPrice: raw USDC per raw WSOL is
  // (sqrtPrice / 2^64)^2, and the decimal shift (1e9 / 1e6) is ×1000.
  let solUsd = 0;
  if (infos[7]) {
    const { sqrtPrice } = parseWhirlpool(infos[7].data);
    solUsd = (Number((sqrtPrice * sqrtPrice * 1_000_000n) >> 128n) / 1e6) * 1e3;
  }

  let user: UserView | null = null;
  if (walletPk) {
    const record = records.find((r) =>
      r.account.depositor.equals(walletPk),
    )?.account;
    user = {
      wallet: walletPk,
      sol: BigInt(infos[8]?.lamports ?? 0),
      oldBalance: tokenAmount(infos[9]?.data),
      newBalance: tokenAmount(infos[10]?.data),
      deposited: record ? BigInt(record.amountDeposited.toString()) : 0n,
      claimed: record?.claimed ?? false,
      hasRecord: record !== undefined,
    };
  }

  return {
    polledAtMs: Date.now(),
    clockTs,
    relaunch,
    poolTokenReserve: tokenAmount(infos[2]?.data),
    poolQuoteReserve: tokenAmount(infos[3]?.data),
    escrowBalance: tokenAmount(infos[4]?.data),
    quoteVaultBalance: tokenAmount(infos[5]?.data),
    usdcVaultBalance: tokenAmount(infos[6]?.data),
    solUsd,
    depositorCount: records.length,
    user,
  };
}

export function ChainStateProvider({ children }: { children: ReactNode }) {
  const demo = useDemo();
  const { publicKey } = useWallet();
  const [chain, setChain] = useState<ChainState | null>(null);
  const inFlight = useRef(false);

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setChain(await pollOnce(demo, publicKey ?? null));
    } catch (e) {
      console.error("[poll]", e);
    } finally {
      inFlight.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, publicKey?.toBase58()]);

  return (
    <StateContext.Provider value={{ chain, refresh }}>
      {children}
    </StateContext.Provider>
  );
}
