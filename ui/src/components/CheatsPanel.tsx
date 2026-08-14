// The demo controls: surfpool cheatcodes (airdrops, time travel) plus the
// admin console. Everything signs with the demo admin keypair or ephemeral
// keypairs — the connected wallet never pops for these. Buttons mirror the
// program's own gates: each is enabled exactly when the instruction would
// be accepted.
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDemo } from "../lib/demo";
import { useChain, useChainNow } from "../lib/state";
import { useToasts } from "../lib/toasts";
import { airdropSol, setOldTokenBalance, timeTravelTo } from "../lib/cheats";
import {
  adminCloseDeposits,
  adminComplete,
  adminExecuteSell,
  adminExecuteUsdcSwap,
  adminMarkFailed,
  adminStartDeposits,
  simulateDepositor,
  splitToThreshold,
  waitForRelaunchState,
} from "../lib/actions";
import { fmtCompact, fmtSol, fmtUsdcRaw, shortAddr } from "../lib/format";

type LogLine = { kind: "ok" | "err" | "run"; text: string };

export function CheatsPanel() {
  const demo = useDemo();
  const { chain, refresh } = useChain();
  const now = useChainNow();
  const { publicKey } = useWallet();
  const { pushError } = useToasts();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  const appendLog = (kind: LogLine["kind"], text: string) =>
    setLog((current) => [...current.slice(-24), { kind, text }]);

  // keep the newest log line visible
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  if (!open) {
    return (
      <button className="fab" onClick={() => setOpen(true)}>
        🧪 Demo controls
      </button>
    );
  }
  if (!chain) return null;

  const r = chain.relaunch;
  const symbol = demo.config.tokenSymbol;
  const decimals = demo.config.oldTokenDecimals;
  const windowEnd = r.startedTs !== null ? r.startedTs + r.secondsForDeposits : null;
  const graceEnd = r.closedTs !== null ? r.closedTs + r.gracePeriodSeconds : null;
  const windowElapsed = windowEnd !== null && now >= windowEnd;
  const inGrace = graceEnd !== null && now <= graceEnd;

  const act = async (label: string, action: () => Promise<string | void>) => {
    setBusy(true);
    try {
      const result = await action();
      appendLog("ok", `✓ ${label}${result ? ` · ${shortAddr(result)}` : ""}`);
      await refresh();
    } catch (error) {
      appendLog("err", `✗ ${label} failed`);
      pushError(error);
    } finally {
      setBusy(false);
    }
  };

  const bumpTokens = async (whole: number) => {
    if (!publicKey || !chain.user) return;
    const target = chain.user.oldBalance + BigInt(whole) * 10n ** BigInt(decimals);
    await setOldTokenBalance(demo, publicKey, target);
  };

  const travel = (label: string, target: number) =>
    act(label, async () => {
      await timeTravelTo(demo, target);
    });

  const simulate = (amounts: bigint[], label: string) =>
    act(label, async () => {
      for (const amount of amounts) {
        const { signature } = await simulateDepositor(demo, amount);
        appendLog(
          "ok",
          `✓ depositor +${fmtCompact(amount, decimals)} ${symbol} · ${shortAddr(signature)}`,
        );
      }
    });

  const executeSell = () =>
    act("executeSellRaydium", async () => {
      const { signature, minQuoteOut } = await adminExecuteSell(demo);
      const stored = await demo.client.fetchRelaunch(demo.relaunch);
      const got = stored ? BigInt(stored.quoteRecovered.toString()) : 0n;
      appendLog(
        "ok",
        `✓ sell · min ${fmtSol(minQuoteOut, 1)} ◎ → got ${fmtSol(got, 1)} ◎`,
      );
      return signature;
    });

  const executeSwap = () =>
    act("executeUsdcSwap", async () => {
      const { signature } = await adminExecuteUsdcSwap(demo);
      const stored = await demo.client.fetchRelaunch(demo.relaunch);
      if (stored) {
        appendLog(
          "ok",
          `✓ swapped → ${fmtUsdcRaw(BigInt(stored.usdcRecovered.toString()))}`,
        );
      }
      return signature;
    });

  const runFullExecution = () =>
    act("full execution", async () => {
      let stateName: string = r.stateName;
      if (stateName === "live") {
        appendLog("run", "⏳ closeDeposits…");
        await adminCloseDeposits(demo);
        stateName = await waitForRelaunchState(demo, (s) => s !== "live");
        appendLog("ok", `✓ closeDeposits → ${stateName}`);
      }
      if (stateName === "failed") {
        appendLog("err", "✗ below threshold — refunds open");
        return;
      }
      if (stateName === "sellPending") {
        appendLog("run", "⏳ executeSellRaydium…");
        await executeSellInner();
        stateName = "sold";
      }
      if (stateName === "sold") {
        appendLog("run", "⏳ executeUsdcSwap…");
        await executeSwapInner();
        stateName = "swapped";
      }
      if (stateName === "swapped") {
        appendLog("run", "⏳ completeRelaunch…");
        const signature = await adminComplete(demo);
        await waitForRelaunchState(demo, (s) => s === "complete");
        appendLog("ok", `✓ complete — DAO live 🎉 · ${shortAddr(signature)}`);
      }
    });

  const executeSellInner = async () => {
    const { minQuoteOut } = await adminExecuteSell(demo);
    await waitForRelaunchState(demo, (s) => s === "sold");
    const stored = await demo.client.fetchRelaunch(demo.relaunch);
    const got = stored ? BigInt(stored.quoteRecovered.toString()) : 0n;
    appendLog(
      "ok",
      `✓ sell · min ${fmtSol(minQuoteOut, 1)} ◎ → got ${fmtSol(got, 1)} ◎`,
    );
  };

  const executeSwapInner = async () => {
    await adminExecuteUsdcSwap(demo);
    await waitForRelaunchState(demo, (s) => s === "swapped");
    const stored = await demo.client.fetchRelaunch(demo.relaunch);
    if (stored) {
      appendLog(
        "ok",
        `✓ swapped → ${fmtUsdcRaw(BigInt(stored.usdcRecovered.toString()))}`,
      );
    }
  };

  const remaining = r.threshold - r.totalDeposited;

  return (
    <div className="cheat">
      <h5>
        🧪 Demo controls
        <button className="x" onClick={() => setOpen(false)}>
          ✕
        </button>
      </h5>

      <div className="csec">
        <div className="t">
          Wallet {publicKey ? `· ${shortAddr(publicKey.toBase58())}` : "· not connected"}
        </div>
        <div className="cbtns">
          <button
            className="cb acc"
            disabled={busy || !publicKey}
            onClick={() =>
              act("+10 SOL", async () => {
                await airdropSol(demo, publicKey!, 10);
              })
            }
          >
            + 10 SOL
          </button>
          <button
            className="cb acc"
            disabled={busy || !publicKey}
            onClick={() => act(`+1M ${symbol}`, () => bumpTokens(1_000_000))}
          >
            + 1M {symbol}
          </button>
          <button
            className="cb acc"
            disabled={busy || !publicKey}
            onClick={() => act(`+10M ${symbol}`, () => bumpTokens(10_000_000))}
          >
            + 10M {symbol}
          </button>
        </div>
      </div>

      <div className="csec">
        <div className="t">Community</div>
        <div className="cbtns">
          <button
            className="cb"
            disabled={busy || r.stateName !== "live" || !!windowElapsed}
            onClick={() =>
              simulate(
                Array.from({ length: 3 }, () =>
                  BigInt(1_000_000 + Math.floor(Math.random() * 2_000_000)) *
                  10n ** BigInt(decimals),
                ),
                "simulate 3 depositors",
              )
            }
          >
            Simulate 3 depositors
          </button>
          <button
            className="cb ok"
            disabled={
              busy || r.stateName !== "live" || !!windowElapsed || remaining <= 0n
            }
            onClick={() => simulate(splitToThreshold(remaining), "fill to threshold")}
          >
            Fill to threshold
          </button>
        </div>
      </div>

      <div className="csec">
        <div className="t">Time (on-chain clock · forward only)</div>
        <div className="cbtns">
          <button
            className="cb"
            disabled={busy}
            onClick={() => travel("+1 day", now + 86_400)}
          >
            + 1 day
          </button>
          <button
            className="cb"
            disabled={busy}
            onClick={() => travel("+7 days", now + 7 * 86_400)}
          >
            + 7 days
          </button>
          <button
            className="cb warn"
            disabled={busy || r.stateName !== "live" || windowEnd === null || windowElapsed}
            onClick={() => travel("jump past window end", windowEnd! + 5)}
          >
            Jump past window end
          </button>
          <button
            className="cb warn"
            disabled={busy || r.stateName !== "sellPending" || graceEnd === null || !inGrace}
            onClick={() => travel("+grace period", graceEnd! + 5)}
          >
            + grace period
          </button>
        </div>
      </div>

      <div className="csec">
        <div className="t">Relaunch admin · {shortAddr(demo.admin.publicKey.toBase58())}</div>
        <div className="cbtns">
          <button
            className="cb"
            disabled={busy || r.stateName !== "initialized"}
            onClick={() => act("startDeposits", () => adminStartDeposits(demo))}
          >
            Start deposits
          </button>
          <button
            className="cb"
            disabled={busy || r.stateName !== "live" || !windowElapsed}
            onClick={() => act("closeDeposits", () => adminCloseDeposits(demo))}
          >
            Close deposits
          </button>
          <button
            className="cb ok"
            disabled={busy || r.stateName !== "sellPending" || !inGrace}
            onClick={executeSell}
          >
            Execute sell
          </button>
          <button
            className="cb ok"
            disabled={busy || r.stateName !== "sold"}
            onClick={executeSwap}
          >
            Swap to USDC
          </button>
          <button
            className="cb ok"
            disabled={busy || r.stateName !== "swapped"}
            onClick={() => act("completeRelaunch — DAO live 🎉", () => adminComplete(demo))}
          >
            Complete
          </button>
          <button
            className="cb bad"
            disabled={busy || r.stateName !== "sellPending" || inGrace}
            onClick={() => act("markFailed", () => adminMarkFailed(demo))}
          >
            Mark failed
          </button>
        </div>
        <div className="cbtns" style={{ marginTop: 6 }}>
          <button
            className="cb acc"
            disabled={
              busy ||
              !(
                (r.stateName === "live" && windowElapsed) ||
                ["sellPending", "sold", "swapped"].includes(r.stateName)
              )
            }
            onClick={runFullExecution}
          >
            ▶ Run full execution
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="clog" ref={logRef}>
          {log.map((line, index) => (
            <div key={index} className={line.kind === "run" ? "" : line.kind}>
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
