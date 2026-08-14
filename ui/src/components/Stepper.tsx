import { useChain } from "../lib/state";

const STEPS = ["Initialized", "Deposits", "Sell", "→ USDC", "DAO live", "Claims"];

// The step index that is "current" for each state.
const NOW_INDEX: Record<string, number> = {
  initialized: 0,
  live: 1,
  sellPending: 2,
  sold: 3,
  swapped: 4,
  complete: 5,
};

export function Stepper() {
  const { chain } = useChain();
  if (!chain) return null;
  const { stateName, threshold, totalDeposited } = chain.relaunch;

  // On failure, mark the step where the relaunch died: the deposit window
  // (below threshold) or the sell (admin stalled past the grace period).
  const failed = stateName === "failed";
  const badIndex = failed ? (totalDeposited >= threshold ? 2 : 1) : -1;
  const nowIndex = failed ? badIndex : NOW_INDEX[stateName];

  return (
    <div className="stepper">
      {STEPS.map((label, index) => {
        let cls = "";
        if (failed && index === badIndex) cls = "bad";
        else if (index < nowIndex) cls = "done";
        else if (index === nowIndex && !failed) cls = "now";
        else if (stateName === "complete") cls = "done";
        return (
          <div key={label} className={`step ${cls}`}>
            <div className="bar" />
            {failed && index === badIndex ? "Failed" : label}
          </div>
        );
      })}
    </div>
  );
}
