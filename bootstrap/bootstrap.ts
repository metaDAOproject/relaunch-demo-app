// Relaunch demo bootstrap. Runs against a fresh surfpool fork started via
// `surfpool start -r relaunch-demo` (see run.sh):
//
//   1. funds the demo admin keypair,
//   2. injects the frozen global ALT fixture at the SDK's pinned address,
//   3. preflights the target pool through the program's canonicality gates,
//   4. initializes the relaunch and opens the deposit window,
//   5. writes the UI's runtime config and prints a state dump.
//
// The target token is configuration: TARGET_MINT / TARGET_POOL default to
// MOBY's mint and its Raydium AMM v4 pool.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { getMint, NATIVE_MINT } from "@solana/spl-token";
import {
  FUTARCHY_V0_6_PROGRAM_ID,
  OPENBOOK_PROGRAM_ID,
  parseRaydiumPool,
  RAYDIUM_AMM_PROGRAM_ID,
  RELAUNCH_V0_1_GLOBAL_ALT,
  RELAUNCH_V0_1_PROGRAM_ID,
  RelaunchClient,
} from "@metadaoproject/programs";

const DEMO_DIR = path.resolve(fileURLToPath(import.meta.url), "../..");

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:8900";

const TARGET_MINT = new PublicKey(
  process.env.TARGET_MINT ?? "Cy1GS2FqefgaMbi45UunrUzin1rfEmTUYnomddzBpump",
);
const TARGET_POOL = new PublicKey(
  process.env.TARGET_POOL ?? "AemYRZmJryzAQ9Z4RLfUBLnPRUY5ecooc94EJvemfti4",
);
const TOKEN_NAME = process.env.TOKEN_NAME ?? "Moby";
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL ?? "MOBY";
const TOKEN_URI =
  process.env.TOKEN_URI ?? "https://metadao.fi/relaunch-demo.json";
const DEPOSIT_WINDOW_SECONDS = Number(
  process.env.DEPOSIT_WINDOW_SECONDS ?? 30 * 24 * 60 * 60,
);
const GRACE_SECONDS = Number(process.env.GRACE_SECONDS ?? 7 * 24 * 60 * 60);
const THRESHOLD_BPS = Number(process.env.THRESHOLD_BPS ?? 200);
const AUTO_START = process.env.AUTO_START !== "0";

// The frozen global ALT, injected byte-exact from the canonical fixture (a
// copy of the programs repo's tests/fixtures/relaunch-global-alt: 56-byte
// meta with last_extended_slot zeroed + 184 addresses).
const ALT_FIXTURE = path.join(DEMO_DIR, "fixtures/relaunch-global-alt");
const ALT_LAMPORTS = 42_261_120;
const ALT_PROGRAM = "AddressLookupTab1e1111111111111111111111111";

const RAYDIUM_MIN_BURNED_LP = 4_000_000_000_000n;

function fail(message: string): never {
  console.error(`\nbootstrap failed: ${message}`);
  process.exit(1);
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: any };
  if (body.error) {
    throw new Error(`${method}: ${body.error.message ?? body.error}`);
  }
  return body.result;
}

function formatTokens(raw: bigint, decimals: number): string {
  const whole = raw / 10n ** BigInt(decimals);
  return whole.toLocaleString("en-US");
}

async function main() {
  const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: WS_URL,
  });

  // Throwaway admin, fresh per run — funded by the airdrop below and handed
  // to the UI via demo-config.json.
  const admin = Keypair.generate();
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const client = RelaunchClient.createClient({ provider });

  console.log(`rpc      ${RPC_URL}`);
  console.log(`admin    ${admin.publicKey.toBase58()}`);

  // -- programs deployed by the runbook -----------------------------------
  for (const [name, programId] of [
    ["relaunch", RELAUNCH_V0_1_PROGRAM_ID],
    ["futarchy", FUTARCHY_V0_6_PROGRAM_ID],
  ] as const) {
    const info = await connection.getAccountInfo(programId);
    if (!info?.executable) {
      fail(
        `${name} program not deployed at ${programId.toBase58()} — start surfpool via run.sh (surfpool start -r relaunch-demo)`,
      );
    }
  }
  console.log("programs relaunch + futarchy deployed ✓");

  // -- fund the admin ------------------------------------------------------
  const airdropSig = await connection.requestAirdrop(
    admin.publicKey,
    100 * LAMPORTS_PER_SOL,
  );
  const blockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: airdropSig, ...blockhash });
  console.log("admin    funded with 100 SOL ✓");

  // -- inject the global ALT at the SDK's pinned address -------------------
  const altBytes = fs.readFileSync(ALT_FIXTURE);
  await rpcCall("surfnet_setAccount", [
    RELAUNCH_V0_1_GLOBAL_ALT.toBase58(),
    {
      lamports: ALT_LAMPORTS,
      data: altBytes.toString("hex"),
      owner: ALT_PROGRAM,
      executable: false,
    },
  ]);
  const alt = await connection.getAddressLookupTable(RELAUNCH_V0_1_GLOBAL_ALT);
  if (!alt.value) {
    fail("injected ALT did not decode via getAddressLookupTable");
  }
  console.log(
    `alt      ${RELAUNCH_V0_1_GLOBAL_ALT.toBase58()} injected (${alt.value.state.addresses.length} addresses) ✓`,
  );

  // -- preflight the target pool through the program's gates ---------------
  const poolInfo = await connection.getAccountInfo(TARGET_POOL);
  if (!poolInfo) fail(`target pool ${TARGET_POOL.toBase58()} does not exist`);
  if (!poolInfo.owner.equals(RAYDIUM_AMM_PROGRAM_ID)) {
    fail(
      `target pool is owned by ${poolInfo.owner.toBase58()}, not Raydium AMM v4 — this demo only supports the Raydium venue`,
    );
  }
  const pool = parseRaydiumPool(poolInfo.data); // throws unless 752 bytes
  if (![1n, 6n, 7n].includes(pool.status)) {
    fail(`pool status ${pool.status} is not swap-enabled (1|6|7)`);
  }
  const poolMints = new Set([
    pool.coinMint.toBase58(),
    pool.pcMint.toBase58(),
  ]);
  if (
    !poolMints.has(TARGET_MINT.toBase58()) ||
    !poolMints.has(NATIVE_MINT.toBase58())
  ) {
    fail(`pool mints {${[...poolMints].join(", ")}} != {target, WSOL}`);
  }
  if (!pool.marketProgram.equals(OPENBOOK_PROGRAM_ID)) {
    fail(
      `pool market program ${pool.marketProgram.toBase58()} is not OpenBook — not an orderbook-era AMM v4 pool`,
    );
  }
  const lpMint = await getMint(connection, pool.lpMint);
  const burnedLp = pool.lpAmount - lpMint.supply;
  if (burnedLp < RAYDIUM_MIN_BURNED_LP) {
    fail(
      `burned LP ${burnedLp} below the ${RAYDIUM_MIN_BURNED_LP} floor — pool liquidity is not locked`,
    );
  }

  const tokenIsCoin = pool.coinMint.equals(TARGET_MINT);
  const tokenVaultAddr = tokenIsCoin ? pool.coinVault : pool.pcVault;
  const quoteVaultAddr = tokenIsCoin ? pool.pcVault : pool.coinVault;
  const oldMint = await getMint(connection, TARGET_MINT);
  const [tokenReserve, quoteReserve] = await Promise.all(
    [tokenVaultAddr, quoteVaultAddr].map(async (address) =>
      BigInt(
        (await connection.getTokenAccountBalance(address)).value.amount,
      ),
    ),
  );
  console.log(
    `pool     ${TARGET_POOL.toBase58()} passes all canonicality gates ✓`,
  );
  console.log(
    `           status ${pool.status} · OpenBook-era · burned LP ${(
      Number(burnedLp) / 1e9
    ).toFixed(2)} ≥ 4,000`,
  );
  console.log(
    `           reserves ${formatTokens(tokenReserve, oldMint.decimals)} ${TOKEN_SYMBOL} / ${(
      Number(quoteReserve) / LAMPORTS_PER_SOL
    ).toFixed(1)} SOL`,
  );

  // -- initialize the relaunch and open deposits ---------------------------
  const { newMint, relaunch } = await client.initializeRelaunch({
    oldMint: TARGET_MINT,
    sourcePool: TARGET_POOL,
    sourceQuoteMint: NATIVE_MINT,
    tokenName: TOKEN_NAME,
    tokenSymbol: TOKEN_SYMBOL,
    tokenUri: TOKEN_URI,
    secondsForDeposits: DEPOSIT_WINDOW_SECONDS,
    gracePeriodSeconds: GRACE_SECONDS,
    thresholdBps: THRESHOLD_BPS,
    teamAddress: admin.publicKey,
    admin: admin.publicKey,
  });
  console.log(`relaunch ${relaunch.toBase58()} initialized ✓`);

  if (AUTO_START) {
    await client.startDepositsIx({ relaunch }).rpc();
    console.log("deposits window opened ✓");
  }

  const stored = await client.fetchRelaunch(relaunch);
  if (!stored) fail("relaunch account missing after initialization");

  // -- write the UI's runtime config ----------------------------------------
  const config = {
    rpcUrl: RPC_URL,
    wsUrl: WS_URL,
    relaunchProgramId: client.getProgramId().toBase58(),
    relaunch: relaunch.toBase58(),
    newMint: newMint.toBase58(),
    oldMint: TARGET_MINT.toBase58(),
    sourcePool: TARGET_POOL.toBase58(),
    poolTokenVault: tokenVaultAddr.toBase58(),
    poolQuoteVault: quoteVaultAddr.toBase58(),
    ammCoinVault: pool.coinVault.toBase58(),
    ammPcVault: pool.pcVault.toBase58(),
    oldTokenVault: stored.oldTokenVault.toBase58(),
    sourceQuoteVault: stored.sourceQuoteVault.toBase58(),
    usdcVault: stored.usdcVault.toBase58(),
    newTokenVault: stored.newTokenVault.toBase58(),
    globalAlt: RELAUNCH_V0_1_GLOBAL_ALT.toBase58(),
    adminSecretKey: Array.from(admin.secretKey),
    tokenName: TOKEN_NAME,
    tokenSymbol: TOKEN_SYMBOL,
    oldTokenDecimals: oldMint.decimals,
    newTokenDecimals: 6,
    thresholdBps: THRESHOLD_BPS,
    secondsForDeposits: DEPOSIT_WINDOW_SECONDS,
    gracePeriodSeconds: GRACE_SECONDS,
  };
  const configPath = path.join(DEMO_DIR, "ui/public/demo-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`config   ${path.relative(DEMO_DIR, configPath)} written ✓`);

  // -- state dump ------------------------------------------------------------
  const threshold =
    (BigInt(THRESHOLD_BPS) * BigInt(stored.oldSupplySnapshot.toString())) /
    10_000n;
  const clockInfo = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  const chainNow = Number(clockInfo!.data.readBigInt64LE(32));
  const started = stored.unixTimestampStarted
    ? Number(stored.unixTimestampStarted.toString())
    : null;
  const spotSol =
    Number(quoteReserve) /
    LAMPORTS_PER_SOL /
    (Number(tokenReserve) / 10 ** oldMint.decimals);

  console.log("\n=== relaunch demo is live ===");
  console.log(`state              ${Object.keys(stored.state)[0]}`);
  console.log(
    `old supply         ${formatTokens(BigInt(stored.oldSupplySnapshot.toString()), oldMint.decimals)} ${TOKEN_SYMBOL}`,
  );
  console.log(
    `threshold          ${formatTokens(threshold, oldMint.decimals)} ${TOKEN_SYMBOL} (${THRESHOLD_BPS} bps of supply)`,
  );
  if (started !== null) {
    const ends = started + DEPOSIT_WINDOW_SECONDS;
    console.log(
      `window             ${DEPOSIT_WINDOW_SECONDS / 86_400} days — ends ${new Date(ends * 1000).toUTCString()} (on-chain now: ${new Date(chainNow * 1000).toUTCString()})`,
    );
  }
  console.log(`spot price         ${spotSol.toExponential(3)} SOL / ${TOKEN_SYMBOL}`);
  console.log(`new mint           ${newMint.toBase58()}`);
  console.log(`escrow vault       ${stored.oldTokenVault.toBase58()}`);
  console.log(`admin              ${admin.publicKey.toBase58()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
