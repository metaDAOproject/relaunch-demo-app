// The cards that swap with the on-chain state: your position, the execution
// checklist, claim/refund, and the DAO summary.
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDemo } from "../lib/demo";
import { useChain } from "../lib/state";
import { useToasts } from "../lib/toasts";
import { buildClaimIxs, buildRefundIxs } from "../lib/actions";
import { sendV0 } from "../lib/tx";
import { claimAmount, TOKENS_TO_FUTARCHY_LIQUIDITY } from "../lib/quote";
import {
  fmtCompact,
  fmtPct,
  fmtSol,
  fmtTokens,
  fmtUsd,
  fmtUsdcRaw,
  shortAddr,
  toUi,
} from "../lib/format";

export function PositionCard() {
  const demo = useDemo();
  const { chain } = useChain();
  if (!chain?.user) return null;
  const { tokenSymbol, oldTokenDecimals } = demo.config;
  const r = chain.relaunch;
  const user = chain.user;
  if (user.deposited === 0n && !user.hasRecord) return null;

  let status = <b className="ok">escrowed ✓</b>;
  if (user.claimed) {
    status =
      r.stateName === "failed" ? (
        <b className="ok">refunded ✓</b>
      ) : (
        <b className="ok">claimed ✓</b>
      );
  }

  return (
    <div className="a-card">
      <h4>Your position</h4>
      <div className="kv">
        <span className="mut">Deposited</span>
        <b>
          {fmtTokens(user.deposited, oldTokenDecimals)} {tokenSymbol}
        </b>
      </div>
      <div className="kv">
        <span className="mut">Share of all deposits</span>
        <b>{fmtPct(user.deposited, r.totalDeposited)}</b>
      </div>
      {r.stateName !== "failed" && (
        <div className="kv">
          <span className="mut">
            Claim at {r.stateName === "complete" ? "final" : "current"}{" "}
            participation
          </span>
          <b>{fmtTokens(claimAmount(user.deposited, r.totalDeposited), 6)} new tokens</b>
        </div>
      )}
      <div className="kv">
        <span className="mut">Status</span>
        {status}
      </div>
    </div>
  );
}

export function ExecutionCard() {
  const demo = useDemo();
  const { chain } = useChain();
  if (!chain) return null;
  const r = chain.relaunch;
  if (!["sellPending", "sold", "swapped", "complete"].includes(r.stateName))
    return null;
  const { tokenSymbol, oldTokenDecimals } = demo.config;
  const soldDone = r.quoteRecovered > 0n;
  const swapDone = r.usdcRecovered > 0n;

  return (
    <div className="a-card">
      <h4>Execution</h4>
      <div className="kv">
        <span className="mut">
          Sell {fmtCompact(r.totalDeposited, oldTokenDecimals)} {tokenSymbol}{" "}
          into the pool (admin)
        </span>
        {soldDone ? (
          <b className="ok">{fmtSol(r.quoteRecovered, 1)} SOL ✓</b>
        ) : (
          <b className="warn">pending…</b>
        )}
      </div>
      <div className="kv">
        <span className="mut">Swap SOL → USDC via Orca (admin)</span>
        {swapDone ? (
          <b className="ok">{fmtUsdcRaw(r.usdcRecovered)} ✓</b>
        ) : (
          <b className="warn">{soldDone ? "pending…" : "—"}</b>
        )}
      </div>
      <div className="kv">
        <span className="mut">Complete relaunch (anyone)</span>
        {r.stateName === "complete" ? (
          <b className="ok">DAO live ✓</b>
        ) : (
          <b className="warn">{swapDone ? "pending…" : "—"}</b>
        )}
      </div>
      {r.stateName === "complete" && r.usdcRecovered > 0n && (
        <div className="kv">
          <span className="mut">New token launch price</span>
          <b>
            {fmtUsd(toUi(r.usdcRecovered, 6) / toUi(TOKENS_TO_FUTARCHY_LIQUIDITY, 6))}
          </b>
        </div>
      )}
    </div>
  );
}

export function ClaimCard() {
  const demo = useDemo();
  const { chain, refresh } = useChain();
  const { publicKey, signTransaction } = useWallet();
  const { push, pushError } = useToasts();
  const [busy, setBusy] = useState(false);

  if (!chain || chain.relaunch.stateName !== "complete") return null;
  const user = chain.user;
  if (!user || user.deposited === 0n) return null;
  const amount = claimAmount(user.deposited, chain.relaunch.totalDeposited);

  const claim = async () => {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    try {
      const signature = await sendV0(demo, {
        payer: publicKey,
        instructions: await buildClaimIxs(demo, publicKey),
        sign: signTransaction,
      });
      push("ok", `Claimed ${fmtTokens(amount, 6)} new tokens`, shortAddr(signature));
      await refresh();
    } catch (error) {
      pushError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="a-card">
      <h4>Claim</h4>
      <div className="kv">
        <span className="mut">
          Your share ({fmtCompact(user.deposited, demo.config.oldTokenDecimals)}{" "}
          / {fmtCompact(chain.relaunch.totalDeposited, demo.config.oldTokenDecimals)})
        </span>
        <b>{fmtTokens(amount, 6)} new tokens</b>
      </div>
      {user.claimed ? (
        <div className="kv">
          <span className="mut">Status</span>
          <b className="ok">
            claimed ✓ — wallet holds {fmtTokens(user.newBalance, 6)}
          </b>
        </div>
      ) : (
        <button className="cta" disabled={busy || !signTransaction} onClick={claim}>
          {busy ? "Sending…" : `Claim ${fmtTokens(amount, 6)} new tokens`}
        </button>
      )}
    </div>
  );
}

export function RefundCard() {
  const demo = useDemo();
  const { chain, refresh } = useChain();
  const { publicKey, signTransaction } = useWallet();
  const { push, pushError } = useToasts();
  const [busy, setBusy] = useState(false);

  if (!chain || chain.relaunch.stateName !== "failed") return null;
  const user = chain.user;
  if (!user || user.deposited === 0n) return null;
  const { tokenSymbol, oldTokenDecimals } = demo.config;

  const refund = async () => {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    try {
      const signature = await sendV0(demo, {
        payer: publicKey,
        instructions: await buildRefundIxs(demo, publicKey),
        sign: signTransaction,
      });
      push(
        "ok",
        `Refunded ${fmtTokens(user.deposited, oldTokenDecimals)} ${tokenSymbol}`,
        shortAddr(signature),
      );
      await refresh();
    } catch (error) {
      pushError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="a-card">
      <h4>Relaunch failed</h4>
      <div className="kv">
        <span className="mut">Deposited at close</span>
        <b>
          {fmtCompact(chain.relaunch.totalDeposited, oldTokenDecimals)} /{" "}
          {fmtCompact(chain.relaunch.threshold, oldTokenDecimals)} {tokenSymbol}
        </b>
      </div>
      <div className="kv">
        <span className="mut">Your refund</span>
        <b>
          {fmtTokens(user.deposited, oldTokenDecimals)} {tokenSymbol} (100%)
        </b>
      </div>
      {user.claimed ? (
        <div className="kv">
          <span className="mut">Status</span>
          <b className="ok">refunded ✓</b>
        </div>
      ) : (
        <button className="cta sub" disabled={busy || !signTransaction} onClick={refund}>
          {busy ? "Sending…" : "Claim refund"}
        </button>
      )}
    </div>
  );
}

export function DaoCard() {
  const { chain } = useChain();
  if (!chain || chain.relaunch.stateName !== "complete") return null;
  const r = chain.relaunch;

  return (
    <div className="a-card">
      <div className="dao-big">DAO is live 🎉</div>
      <div className="kv">
        <span className="mut">Futarchy DAO</span>
        <b className="addr">{r.dao ? shortAddr(r.dao.toBase58()) : "—"}</b>
      </div>
      <div className="kv">
        <span className="mut">DAO market</span>
        <b>
          {fmtTokens(TOKENS_TO_FUTARCHY_LIQUIDITY, 6)} tokens +{" "}
          {fmtUsdcRaw(r.usdcRecovered)}
        </b>
      </div>
      <div className="kv">
        <span className="mut">Mint + metadata authority</span>
        <b className="addr">
          {r.daoVault ? `Squads vault ${shortAddr(r.daoVault.toBase58())}` : "—"}
        </b>
      </div>
      <div className="kv">
        <span className="mut">Treasury USDC</span>
        <b>$0 (100% seeds the market)</b>
      </div>
    </div>
  );
}
