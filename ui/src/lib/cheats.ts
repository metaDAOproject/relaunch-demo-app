// Surfpool cheatcodes, called straight against the fork's RPC. Verified on
// surfpool 1.2.1: setTokenAccount sets an absolute ATA balance (creating the
// account if missing), and timeTravel takes unix MILLISECONDS and only moves
// forward.
import { PublicKey } from "@solana/web3.js";
import type { Demo } from "./demo";

async function surfnetCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: any };
  if (body.error) {
    throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result;
}

export async function airdropSol(
  demo: Demo,
  to: PublicKey,
  sol: number,
): Promise<void> {
  const signature = await demo.connection.requestAirdrop(to, sol * 1e9);
  const blockhash = await demo.connection.getLatestBlockhash();
  await demo.connection.confirmTransaction(
    { signature, ...blockhash },
    "confirmed",
  );
}

// Sets the owner's old-token ATA to an absolute raw amount.
export async function setOldTokenBalance(
  demo: Demo,
  owner: PublicKey,
  amountRaw: bigint,
): Promise<void> {
  await surfnetCall(demo.config.rpcUrl, "surfnet_setTokenAccount", [
    owner.toBase58(),
    demo.oldMint.toBase58(),
    { amount: Number(amountRaw) },
  ]);
}

// Moves the on-chain clock to the target unix timestamp (seconds).
// Forward-only; surfpool errors on travel into the past.
export async function timeTravelTo(
  demo: Demo,
  targetTsSeconds: number,
): Promise<void> {
  await surfnetCall(demo.config.rpcUrl, "surfnet_timeTravel", [
    { absoluteTimestamp: Math.ceil(targetTsSeconds) * 1000 },
  ]);
}
