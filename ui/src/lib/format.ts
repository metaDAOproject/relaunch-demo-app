// Number/date/duration formatting. All chain quantities are bigint raw
// units; formatting is the only place they become floats.

export function toUi(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

export function fmtTokens(raw: bigint, decimals: number, maxFrac = 0): string {
  return toUi(raw, decimals).toLocaleString("en-US", {
    maximumFractionDigits: maxFrac,
  });
}

export function fmtCompact(raw: bigint, decimals: number): string {
  const value = toUi(raw, decimals);
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000)
    return `${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtSol(lamports: bigint, maxFrac = 3): string {
  return (Number(lamports) / 1e9).toLocaleString("en-US", {
    maximumFractionDigits: maxFrac,
  });
}

export function fmtUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01)
    return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 3 })}`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
}

export function fmtUsdcRaw(raw: bigint): string {
  return fmtUsd(Number(raw) / 1e6);
}

export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(m)}m ${pad(s)}s`;
}

export function fmtDate(unixTs: number): string {
  return new Date(unixTs * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateTime(unixTs: number): string {
  return new Date(unixTs * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function fmtPct(num: bigint, den: bigint): string {
  if (den === 0n) return "0%";
  return `${(Number((num * 10_000n) / den) / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

// Parses a user-typed token amount ("2,500,000.5") into raw units.
export function parseAmount(text: string, decimals: number): bigint | null {
  const cleaned = text.replace(/[,\s_]/g, "");
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === ".")
    return null;
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded);
  } catch {
    return null;
  }
}
