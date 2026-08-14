import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useDemo } from "../lib/demo";
import { useChain, useChainNow } from "../lib/state";
import { fmtDateTime } from "../lib/format";

const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  initialized: { label: "INITIALIZED", cls: "" },
  live: { label: "● DEPOSITS LIVE", cls: "live" },
  sellPending: { label: "SELL PENDING", cls: "warn" },
  sold: { label: "SOLD · AWAITING USDC SWAP", cls: "warn" },
  swapped: { label: "SWAPPED · AWAITING COMPLETION", cls: "warn" },
  complete: { label: "● DAO LIVE", cls: "live" },
  failed: { label: "✕ FAILED · REFUNDS OPEN", cls: "bad" },
};

export function Header() {
  const demo = useDemo();
  const { chain } = useChain();
  const now = useChainNow();
  const chip = chain ? STATE_CHIP[chain.relaunch.stateName] : null;

  return (
    <div className="a-head">
      <span className="a-logo">↻ Relaunch</span>
      <span className="a-chip">
        {demo.config.tokenSymbol} / SOL · RAYDIUM AMM V4
      </span>
      <span className="a-chip">SURFPOOL FORK</span>
      {chip && <span className={`a-chip ${chip.cls}`}>{chip.label}</span>}
      <span className="a-spacer" />
      {now > 0 && (
        <span className="a-chip">⏱ on-chain: {fmtDateTime(now)}</span>
      )}
      <WalletMultiButton />
    </div>
  );
}
