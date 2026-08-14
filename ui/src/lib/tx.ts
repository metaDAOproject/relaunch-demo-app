// Every send in the demo is a v0 transaction resolving accounts through the
// injected global ALT — the exact shape integrators use on mainnet. Wallets
// sign via signTransaction and the raw bytes go straight to the fork's RPC
// (never the wallet's own endpoint, where none of this exists).
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Demo } from "./demo";

export type Signer = (
  tx: VersionedTransaction,
) => Promise<VersionedTransaction>;

export function signWithKeypairs(...keypairs: Keypair[]): Signer {
  return async (tx) => {
    tx.sign(keypairs);
    return tx;
  };
}

export async function sendV0(
  demo: Demo,
  {
    payer,
    instructions,
    sign,
  }: {
    payer: PublicKey;
    instructions: TransactionInstruction[];
    sign: Signer;
  },
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await demo.connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([demo.alt]);
  const tx = await sign(new VersionedTransaction(message));
  const signature = await demo.connection.sendRawTransaction(tx.serialize());
  await demo.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}
