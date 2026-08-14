// State banners with the permissionless cranks inline — the audience sees
// that closing, failing, and completing need nobody's permission. The demo
// admin keypair signs the crank silently (any wallet could).
import { useState } from "react";
import { useDemo } from "../lib/demo";
import { useChain, useChainNow } from "../lib/state";
import { useToasts } from "../lib/toasts";
import {
  adminCloseDeposits,
  adminComplete,
  adminMarkFailed,
} from "../lib/actions";
import { fmtCountdown, fmtTokens, shortAddr } from "../lib/format";

export function Banners() {
  const demo = useDemo();
  const { chain, refresh } = useChain();
  const now = useChainNow();
  const { push, pushError } = useToasts();
  const [busy, setBusy] = useState(false);

  if (!chain) return null;
  const r = chain.relaunch;
  const { tokenSymbol, oldTokenDecimals } = demo.config;
  const windowEnd = r.startedTs !== null ? r.startedTs + r.secondsForDeposits : null;
  const graceEnd = r.closedTs !== null ? r.closedTs + r.gracePeriodSeconds : null;

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(true);
    try {
      const signature = await action();
      push("ok", label, `permissionless crank · ${shortAddr(signature)}`);
      await refresh();
    } catch (error) {
      pushError(error);
    } finally {
      setBusy(false);
    }
  };

  if (r.stateName === "live" && windowEnd !== null && now >= windowEnd) {
    return (
      <div className="banner warn">
        Deposit window ended. Anyone can now close deposits —{" "}
        {r.totalDeposited >= r.threshold
          ? "the threshold was met, so closing locks the escrow for the sell."
          : "the threshold was missed, so closing opens full refunds."}
        <button
          className="act"
          disabled={busy}
          onClick={() => run("Deposits closed", () => adminCloseDeposits(demo))}
        >
          Close deposits
        </button>
      </div>
    );
  }

  if (
    r.stateName === "live" &&
    r.totalDeposited >= r.threshold &&
    windowEnd !== null
  ) {
    return (
      <div className="banner ok">
        ✓ {fmtTokens(r.totalDeposited, oldTokenDecimals)} {tokenSymbol}{" "}
        deposited — threshold met. Deposits stay open another{" "}
        {fmtCountdown(windowEnd - now)}.
      </div>
    );
  }

  if (r.stateName === "sellPending" && graceEnd !== null && now > graceEnd) {
    return (
      <div className="banner bad">
        The admin's grace period elapsed without a sell. Anyone can now mark
        the relaunch failed and open refunds.
        <button
          className="act"
          disabled={busy}
          onClick={() => run("Marked failed", () => adminMarkFailed(demo))}
        >
          Mark failed
        </button>
      </div>
    );
  }

  if (r.stateName === "sellPending") {
    return (
      <div className="banner warn">
        Threshold met — the escrow is ready. The admin must execute the sell
        within the grace period ({graceEnd !== null ? fmtCountdown(graceEnd - now) : "…"}{" "}
        left) or anyone can fail the relaunch. Drive it from the demo controls.
      </div>
    );
  }

  if (r.stateName === "swapped") {
    return (
      <div className="banner warn">
        USDC secured. Completing the relaunch is permissionless — anyone can
        create the DAO and seed its market.
        <button
          className="act"
          disabled={busy}
          onClick={() => run("Relaunch completed — DAO live", () => adminComplete(demo))}
        >
          Complete relaunch
        </button>
      </div>
    );
  }

  if (r.stateName === "complete") {
    return (
      <div className="banner ok">
        🎉 The DAO is live. Depositors claim their new tokens below; the market
        opened with 12.5M tokens + every recovered dollar.
      </div>
    );
  }

  if (r.stateName === "failed") {
    return (
      <div className="banner bad">
        Relaunch failed
        {r.totalDeposited < r.threshold ? " — the threshold was not met" : ""}.
        Every deposit is refundable in full.
      </div>
    );
  }

  return null;
}
