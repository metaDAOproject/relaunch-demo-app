// Instruction bundles and admin/cheat flows. User-facing bundles return
// instruction lists for the wallet to sign; admin flows sign with the demo
// admin keypair and send immediately. Everything rides sendV0 + the global
// ALT.
import { BN } from "bn.js";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { AccountLayout } from "@solana/spl-token";
import {
  fetchWhirlpool,
  getWhirlpoolSwapTickArrayAddrs,
  USDC_SWAP_POOL,
} from "@metadaoproject/programs";
import type { Demo } from "./demo";
import { sendV0, signWithKeypairs } from "./tx";
import { sellQuote, usdcSwapQuote } from "./quote";
import { airdropSol, setOldTokenBalance } from "./cheats";

// The demo's Raydium venue implies a classic-SPL old mint (the program's
// Raydium instructions derive vaults under the classic token program).
const OLD_TOKEN_PROGRAM = TOKEN_PROGRAM_ID;

const SLIPPAGE_BPS = 100n;

// ---------------------------------------------------------------- user ixs

export async function buildDepositIxs(
  demo: Demo,
  depositor: PublicKey,
  amount: bigint,
): Promise<TransactionInstruction[]> {
  return [
    await demo.client
      .depositIx({
        relaunch: demo.relaunch,
        oldMint: demo.oldMint,
        oldTokenProgram: OLD_TOKEN_PROGRAM,
        amount: new BN(amount.toString()),
        depositor,
        payer: depositor,
      })
      .instruction(),
  ];
}

// Wrap, exact-out buy off the pool, escrow, unwrap the unspent remainder —
// one atomic transaction (the altTransactions test pattern).
export async function buildBuyDepositIxs(
  demo: Demo,
  depositor: PublicKey,
  baseOut: bigint,
  maxQuoteIn: bigint,
): Promise<TransactionInstruction[]> {
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, depositor);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      depositor,
      wsolAta,
      depositor,
      NATIVE_MINT,
    ),
    SystemProgram.transfer({
      fromPubkey: depositor,
      toPubkey: wsolAta,
      lamports: Number(maxQuoteIn),
    }),
    createSyncNativeInstruction(wsolAta),
    await demo.client
      .depositViaBuyRaydiumIx({
        relaunch: demo.relaunch,
        oldMint: demo.oldMint,
        sourceQuoteMint: NATIVE_MINT,
        sourcePool: demo.sourcePool,
        ammCoinVault: demo.ammCoinVault,
        ammPcVault: demo.ammPcVault,
        baseOut: new BN(baseOut.toString()),
        maxQuoteIn: new BN(maxQuoteIn.toString()),
        depositor,
        payer: depositor,
      })
      .instruction(),
    createCloseAccountInstruction(wsolAta, depositor, depositor),
  ];
}

export async function buildClaimIxs(
  demo: Demo,
  depositor: PublicKey,
): Promise<TransactionInstruction[]> {
  const newAta = getAssociatedTokenAddressSync(demo.newMint, depositor);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      depositor,
      newAta,
      depositor,
      demo.newMint,
    ),
    await demo.client
      .claimIx({
        relaunch: demo.relaunch,
        newMint: demo.newMint,
        depositor,
        payer: depositor,
      })
      .instruction(),
  ];
}

export async function buildRefundIxs(
  demo: Demo,
  depositor: PublicKey,
): Promise<TransactionInstruction[]> {
  return [
    await demo.client
      .claimRefundIx({
        relaunch: demo.relaunch,
        oldMint: demo.oldMint,
        oldTokenProgram: OLD_TOKEN_PROGRAM,
        depositor,
      })
      .instruction(),
  ];
}

// ---------------------------------------------------------------- admin ops

async function sendAsAdmin(
  demo: Demo,
  instructions: TransactionInstruction[],
): Promise<string> {
  return sendV0(demo, {
    payer: demo.admin.publicKey,
    instructions,
    sign: signWithKeypairs(demo.admin),
  });
}

export async function adminStartDeposits(demo: Demo): Promise<string> {
  return sendAsAdmin(demo, [
    await demo.client
      .startDepositsIx({ relaunch: demo.relaunch, admin: demo.admin.publicKey })
      .instruction(),
  ]);
}

export async function adminCloseDeposits(demo: Demo): Promise<string> {
  return sendAsAdmin(demo, [
    await demo.client.closeDepositsIx({ relaunch: demo.relaunch }).instruction(),
  ]);
}

async function fetchTokenBalance(
  demo: Demo,
  address: PublicKey,
): Promise<bigint> {
  const info = await demo.connection.getAccountInfo(address);
  if (!info) return 0n;
  return AccountLayout.decode(info.data).amount;
}

// Sells the whole escrow into the pool, flooring at 1% slippage off fresh
// reserves (the SDK's exact integer math).
export async function adminExecuteSell(
  demo: Demo,
): Promise<{ signature: string; minQuoteOut: bigint }> {
  const [escrow, tokenReserve, quoteReserve] = await Promise.all([
    fetchTokenBalance(demo, demo.oldTokenVault),
    fetchTokenBalance(demo, demo.poolTokenVault),
    fetchTokenBalance(demo, demo.poolQuoteVault),
  ]);
  const quote = sellQuote(escrow, tokenReserve, quoteReserve, SLIPPAGE_BPS);
  if (!quote) throw new Error("escrow is empty — nothing to sell");
  const signature = await sendAsAdmin(demo, [
    await demo.client
      .executeSellRaydiumIx({
        relaunch: demo.relaunch,
        oldMint: demo.oldMint,
        sourceQuoteMint: NATIVE_MINT,
        sourcePool: demo.sourcePool,
        ammCoinVault: demo.ammCoinVault,
        ammPcVault: demo.ammPcVault,
        minQuoteOut: new BN(quote.minQuoteOut.toString()),
        admin: demo.admin.publicKey,
      })
      .instruction(),
  ]);
  return { signature, minQuoteOut: quote.minQuoteOut };
}

// Swaps the whole WSOL vault to USDC through the pinned whirlpool, deriving
// the tick arrays from its live state.
export async function adminExecuteUsdcSwap(
  demo: Demo,
): Promise<{ signature: string; minUsdcOut: bigint }> {
  const [whirlpool, wsolIn] = await Promise.all([
    fetchWhirlpool(demo.connection),
    fetchTokenBalance(demo, demo.sourceQuoteVault),
  ]);
  if (wsolIn === 0n) throw new Error("quote vault is empty — sell first");
  const { minUsdcOut } = usdcSwapQuote(
    wsolIn,
    whirlpool.sqrtPrice,
    SLIPPAGE_BPS,
  );
  const signature = await sendAsAdmin(demo, [
    await demo.client
      .executeUsdcSwapIx({
        relaunch: demo.relaunch,
        whirlpoolWsolVault: whirlpool.tokenVaultA,
        whirlpoolUsdcVault: whirlpool.tokenVaultB,
        tickArrays: getWhirlpoolSwapTickArrayAddrs(
          USDC_SWAP_POOL,
          whirlpool.tickCurrentIndex,
          whirlpool.tickSpacing,
          true,
        ),
        minUsdcOut: new BN(minUsdcOut.toString()),
        admin: demo.admin.publicKey,
      })
      .instruction(),
  ]);
  return { signature, minUsdcOut };
}

export async function adminComplete(demo: Demo): Promise<string> {
  return sendAsAdmin(demo, [
    // complete_relaunch CPIs futarchy's initialize_dao + provide_liquidity
    // and Squads multisig creation — it genuinely needs the raised limit.
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    await demo.client
      .completeRelaunchIx({
        relaunch: demo.relaunch,
        newMint: demo.newMint,
        payer: demo.admin.publicKey,
      })
      .instruction(),
  ]);
}

export async function adminMarkFailed(demo: Demo): Promise<string> {
  return sendAsAdmin(demo, [
    await demo.client.markFailedIx({ relaunch: demo.relaunch }).instruction(),
  ]);
}

// -------------------------------------------------------------- simulation

// Funds an ephemeral wallet with SOL + old tokens via cheatcodes, then
// deposits the whole balance like any normal depositor would.
export async function simulateDepositor(
  demo: Demo,
  amount: bigint,
): Promise<{ wallet: PublicKey; signature: string }> {
  const wallet = Keypair.generate();
  await airdropSol(demo, wallet.publicKey, 0.2);
  await setOldTokenBalance(demo, wallet.publicKey, amount);
  const signature = await sendV0(demo, {
    payer: wallet.publicKey,
    instructions: await buildDepositIxs(demo, wallet.publicKey, amount),
    sign: signWithKeypairs(wallet),
  });
  return { wallet: wallet.publicKey, signature };
}

// Splits the remaining distance to the threshold across three simulated
// depositors so progress lands at exactly 100%.
export function splitToThreshold(remaining: bigint): bigint[] {
  if (remaining <= 0n) return [];
  const first = (remaining * 35n) / 100n;
  const second = (remaining * 40n) / 100n;
  const third = remaining - first - second;
  return [first, second, third].filter((amount) => amount > 0n);
}

// ------------------------------------------------------------------ helpers

export async function waitForRelaunchState(
  demo: Demo,
  predicate: (stateName: string) => boolean,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stored = await demo.client.fetchRelaunch(demo.relaunch);
    if (stored) {
      const stateName = Object.keys(stored.state)[0];
      if (predicate(stateName)) return stateName;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("timed out waiting for the relaunch state to change");
}
