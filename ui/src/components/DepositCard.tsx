// The deposit card, both paths. "Deposit" escrows tokens the wallet already
// holds; "Buy & deposit" is the program's exact-output Raydium swap — the
// primary input is the token amount to credit, the SOL cost is derived with
// the SDK's integer math, and wrap → buy → escrow → unwrap ride one
// signature. Both send as v0 transactions through the global ALT.
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDemo } from "../lib/demo";
import { useChain, useChainNow } from "../lib/state";
import { useToasts } from "../lib/toasts";
import { buildBuyDepositIxs, buildDepositIxs } from "../lib/actions";
import { sendV0 } from "../lib/tx";
import { buyQuote, claimAmount } from "../lib/quote";
import {
  fmtPct,
  fmtSol,
  fmtTokens,
  parseAmount,
  shortAddr,
  toUi,
} from "../lib/format";

// Keep ~0.005 SOL aside for the transaction fee and rent flux.
const FEE_BUFFER_LAMPORTS = 5_000_000n;

export function DepositCard() {
  const demo = useDemo();
  const { chain, refresh } = useChain();
  const now = useChainNow();
  const { publicKey, signTransaction } = useWallet();
  const { push, pushError } = useToasts();

  const [tab, setTab] = useState<"deposit" | "buy">("deposit");
  const tabTouched = useRef(false);
  const [depositText, setDepositText] = useState("");
  const [buyText, setBuyText] = useState("100,000");
  const [busy, setBusy] = useState(false);

  const balance = chain?.user?.oldBalance ?? 0n;

  // Default to whichever tab fits the wallet, until the user picks one.
  useEffect(() => {
    if (!tabTouched.current && chain?.user) {
      setTab(chain.user.oldBalance > 0n ? "deposit" : "buy");
    }
  }, [chain?.user?.oldBalance === 0n, chain?.user != null]);

  if (!chain) return null;
  const r = chain.relaunch;
  if (r.stateName !== "live") return null;

  const { tokenSymbol, oldTokenDecimals } = demo.config;
  const windowEnd = r.startedTs !== null ? r.startedTs + r.secondsForDeposits : null;
  const windowOpen = windowEnd !== null && now < windowEnd;

  const pickTab = (next: "deposit" | "buy") => {
    tabTouched.current = true;
    setTab(next);
  };

  const submit = async (
    label: string,
    build: () => Promise<Parameters<typeof sendV0>[1]["instructions"]>,
  ) => {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    try {
      const signature = await sendV0(demo, {
        payer: publicKey,
        instructions: await build(),
        sign: signTransaction,
      });
      push("ok", label, `one transaction · ${shortAddr(signature)}`);
      setDepositText("");
      await refresh();
    } catch (error) {
      pushError(error);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------- deposit tab
  const depositAmount = parseAmount(depositText, oldTokenDecimals);
  const depositValid =
    depositAmount !== null && depositAmount > 0n && depositAmount <= balance;
  const depositProblem =
    depositAmount !== null && depositAmount > balance
      ? `you only hold ${fmtTokens(balance, oldTokenDecimals)} ${tokenSymbol}`
      : null;

  // ----------------------------------------------------------------- buy tab
  const buyAmount = parseAmount(buyText, oldTokenDecimals);
  const quote =
    buyAmount !== null && buyAmount > 0n
      ? buyQuote(buyAmount, chain.poolTokenReserve, chain.poolQuoteReserve)
      : null;
  const solBalance = chain.user?.sol ?? 0n;
  const buyProblem =
    buyAmount !== null && buyAmount > 0n && !quote
      ? "amount exceeds the pool's token reserve"
      : quote && quote.maxQuoteIn + FEE_BUFFER_LAMPORTS > solBalance
        ? `needs ${fmtSol(quote.maxQuoteIn)} SOL — wallet holds ${fmtSol(solBalance)}`
        : null;
  const buyValid = quote !== null && !buyProblem;

  const projection = (added: bigint) => {
    const mine = (chain.user?.deposited ?? 0n) + added;
    const total = r.totalDeposited + added;
    const denominator = total > r.threshold ? total : r.threshold;
    return { share: fmtPct(mine, total), claim: claimAmount(mine, denominator) };
  };

  return (
    <div className="a-card">
      <h4>Deposit</h4>
      <div className="tabs">
        <button
          className={`tab ${tab === "deposit" ? "on" : ""}`}
          onClick={() => pickTab("deposit")}
        >
          Deposit {tokenSymbol}
        </button>
        <button
          className={`tab ${tab === "buy" ? "on" : ""}`}
          onClick={() => pickTab("buy")}
        >
          Buy &amp; deposit
        </button>
      </div>

      {!publicKey && (
        <div className="hint">
          Connect a wallet (top right) to deposit. Airdrop yourself SOL and{" "}
          {tokenSymbol} from the demo controls.
        </div>
      )}

      {tab === "deposit" && (
        <>
          <div className="fld">
            <div className="lab">
              <span>AMOUNT</span>
              <span>
                balance: {fmtTokens(balance, oldTokenDecimals)} {tokenSymbol}
                <button
                  className="maxb"
                  onClick={() =>
                    setDepositText(
                      toUi(balance, oldTokenDecimals).toLocaleString("en-US", {
                        maximumFractionDigits: oldTokenDecimals,
                        useGrouping: false,
                      }),
                    )
                  }
                >
                  MAX
                </button>
              </span>
            </div>
            <div className="val">
              <input
                inputMode="decimal"
                placeholder="0"
                value={depositText}
                onChange={(e) => setDepositText(e.target.value)}
              />
              <span className="unit">{tokenSymbol}</span>
            </div>
          </div>
          {depositValid && (
            <div className="quote">
              <div className="row">
                <span>Share of deposits after</span>
                <b>{projection(depositAmount!).share}</b>
              </div>
              <div className="row">
                <span>
                  Projected claim if the window ended{" "}
                  {r.totalDeposited + depositAmount! >= r.threshold
                    ? "now"
                    : "at threshold"}
                </span>
                <b>
                  ≈ {fmtTokens(projection(depositAmount!).claim, 6)} new tokens
                </b>
              </div>
              <div className="row">
                <span>Refund if threshold missed</span>
                <b>
                  {fmtTokens(depositAmount!, oldTokenDecimals)} {tokenSymbol}{" "}
                  (full)
                </b>
              </div>
            </div>
          )}
          {depositProblem && <div className="hint bad">{depositProblem}</div>}
          <button
            className="cta"
            disabled={!publicKey || !signTransaction || !depositValid || !windowOpen || busy}
            onClick={() =>
              submit(`Deposited ${fmtTokens(depositAmount!, oldTokenDecimals)} ${tokenSymbol}`, () =>
                buildDepositIxs(demo, publicKey!, depositAmount!),
              )
            }
          >
            {busy
              ? "Sending…"
              : depositValid
                ? `Deposit ${fmtTokens(depositAmount!, oldTokenDecimals)} ${tokenSymbol}`
                : `Deposit ${tokenSymbol}`}
          </button>
        </>
      )}

      {tab === "buy" && (
        <>
          <div className="fld">
            <div className="lab">
              <span>
                {tokenSymbol} TO BUY &amp; ESCROW
              </span>
              <span>
                you have: {fmtTokens(balance, oldTokenDecimals)} {tokenSymbol}
              </span>
            </div>
            <div className="val">
              <input
                inputMode="decimal"
                placeholder="0"
                value={buyText}
                onChange={(e) => setBuyText(e.target.value)}
              />
              <span className="unit">{tokenSymbol}</span>
            </div>
          </div>
          <div className="fld">
            <div className="lab">
              <span>ESTIMATED COST</span>
              <span>balance: {fmtSol(solBalance, 2)} SOL</span>
            </div>
            <div className="val">
              <span className="est">
                {quote ? `≈ ${fmtSol(quote.grossIn)}` : "—"}
              </span>
              <span className="unit">SOL</span>
            </div>
          </div>
          {quote && (
            <div className="quote">
              <div className="row">
                <span>Route</span>
                <b>
                  Raydium AMM v4 · {tokenSymbol}/SOL
                </b>
              </div>
              <div className="row">
                <span>Pool fee (0.25%) included</span>
                <b>{fmtSol(quote.fee, 4)} SOL</b>
              </div>
              <div className="row">
                <span>Max cost (1% slippage)</span>
                <b>{fmtSol(quote.maxQuoteIn)} SOL</b>
              </div>
              <div className="row">
                <span>Unspent SOL</span>
                <b>auto-refunded &amp; unwrapped</b>
              </div>
            </div>
          )}
          {buyProblem && <div className="hint bad">{buyProblem}</div>}
          <button
            className="cta"
            disabled={!publicKey || !signTransaction || !buyValid || !windowOpen || busy}
            onClick={() =>
              submit(
                `Bought & deposited ${fmtTokens(buyAmount!, oldTokenDecimals)} ${tokenSymbol}`,
                () =>
                  buildBuyDepositIxs(
                    demo,
                    publicKey!,
                    buyAmount!,
                    quote!.maxQuoteIn,
                  ),
              )
            }
          >
            {busy
              ? "Sending…"
              : buyValid
                ? `Buy & deposit ${fmtTokens(buyAmount!, oldTokenDecimals)} ${tokenSymbol}`
                : `Buy & deposit ${tokenSymbol}`}
          </button>
        </>
      )}

      <div className="center">
        <span className="onetx">
          ⚡ single transaction
          {tab === "buy" ? " — wrap · buy · escrow · unwrap" : ""}
        </span>
      </div>
    </div>
  );
}
