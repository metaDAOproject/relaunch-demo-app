import { useDemo } from "../lib/demo";
import { useChain, useChainNow } from "../lib/state";
import {
  fmtCompact,
  fmtCountdown,
  fmtDate,
  fmtSol,
  fmtTokens,
  fmtUsd,
  toUi,
} from "../lib/format";
import { sellQuote } from "../lib/quote";

export function StatusCard() {
  const demo = useDemo();
  const { chain } = useChain();
  const now = useChainNow();
  if (!chain) return null;

  const { tokenSymbol, oldTokenDecimals } = demo.config;
  const r = chain.relaunch;
  const pct =
    r.threshold > 0n ? Number((r.totalDeposited * 10_000n) / r.threshold) / 100 : 0;

  // Spot price of the old token in USD, from live pool reserves.
  const spotSol =
    chain.poolTokenReserve > 0n
      ? toUi(chain.poolQuoteReserve, 9) / toUi(chain.poolTokenReserve, oldTokenDecimals)
      : 0;
  const spotUsd = spotSol * chain.solUsd;

  // Estimated realized value per deposited token: what selling the whole
  // escrow would recover right now (actual USDC once the sell happened).
  let perDeposited: string = "—";
  if (r.usdcRecovered > 0n && r.totalDeposited > 0n) {
    perDeposited = fmtUsd(
      toUi(r.usdcRecovered, 6) / toUi(r.totalDeposited, oldTokenDecimals),
    );
  } else if (r.totalDeposited > 0n && chain.poolTokenReserve > 0n) {
    const quote = sellQuote(
      r.totalDeposited,
      chain.poolTokenReserve,
      chain.poolQuoteReserve,
    );
    if (quote) {
      perDeposited = fmtUsd(
        (toUi(quote.grossOut, 9) * chain.solUsd) /
          toUi(r.totalDeposited, oldTokenDecimals),
      );
    }
  }

  const windowEnd =
    r.startedTs !== null ? r.startedTs + r.secondsForDeposits : null;
  const graceEnd = r.closedTs !== null ? r.closedTs + r.gracePeriodSeconds : null;

  return (
    <div className="a-card">
      <h4>Progress to threshold</h4>
      <div className="prog-top">
        <span className="prog-big">
          {fmtTokens(r.totalDeposited, oldTokenDecimals)}{" "}
          <small>
            / {fmtTokens(r.threshold, oldTokenDecimals)} {tokenSymbol}
          </small>
        </span>
        <span className="prog-pct">
          {pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%
        </span>
      </div>
      <div className="pbar">
        <div
          className={`fill ${pct >= 100 ? "full" : ""}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        <div className="thr" />
      </div>
      <div className="pbar-cap">
        <span>0</span>
        <span>
          threshold = {r.thresholdBps / 100}% of total supply (
          {fmtCompact(r.oldSupplySnapshot, oldTokenDecimals)} {tokenSymbol})
        </span>
      </div>

      {r.stateName === "live" && windowEnd !== null && now < windowEnd && (
        <div className="cd">
          <span className="t">{fmtCountdown(windowEnd - now)}</span>
          <small>
            left in the deposit window · ends {fmtDate(windowEnd)} (on-chain
            time)
          </small>
        </div>
      )}
      {r.stateName === "live" && windowEnd !== null && now >= windowEnd && (
        <div className="cd">
          <span className="t">0m</span>
          <small>deposit window ended — awaiting the close crank</small>
        </div>
      )}
      {r.stateName === "sellPending" && graceEnd !== null && now <= graceEnd && (
        <div className="cd">
          <span className="t">{fmtCountdown(graceEnd - now)}</span>
          <small>left in the admin's grace period to execute the sell</small>
        </div>
      )}

      <div className="tiles">
        <div className="tile">
          <b>{chain.depositorCount}</b>
          <span>depositors</span>
        </div>
        <div className="tile">
          <b>{spotUsd > 0 ? fmtUsd(spotUsd) : "—"}</b>
          <span>spot price</span>
        </div>
        <div className="tile">
          <b>
            {fmtCompact(chain.poolTokenReserve, oldTokenDecimals)} /{" "}
            {fmtSol(chain.poolQuoteReserve, 0)}◎
          </b>
          <span>pool depth</span>
        </div>
        <div className="tile">
          <b>{perDeposited}</b>
          <span>est. value / deposited</span>
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  const demo = useDemo();
  const { chain } = useChain();
  if (!chain) return null;
  const { tokenSymbol } = demo.config;
  const days = Math.round(chain.relaunch.secondsForDeposits / 86_400);
  const pct = chain.relaunch.thresholdBps / 100;

  return (
    <div className="a-card">
      <h4>How it works</h4>
      <div className="kv">
        <span className="mut">
          1 · Deposit {tokenSymbol} (or buy in) during the {days}-day window
        </span>
      </div>
      <div className="kv">
        <span className="mut">
          2 · If ≥ {pct}% of supply deposits, the escrow is sold into the pool
          for SOL → USDC
        </span>
      </div>
      <div className="kv">
        <span className="mut">
          3 · A new token launches: 12.5M to depositors, 12.5M + all the USDC
          seed the DAO's market
        </span>
      </div>
      <div className="kv">
        <span className="mut">
          4 · Below threshold? Every deposit is refunded in full
        </span>
      </div>
    </div>
  );
}
