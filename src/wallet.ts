import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { Payment } from "./types";
import { checkoutRpcUrl } from "./api";

export interface PhantomProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(
    transaction: Transaction,
  ): Promise<{ signature: string }>;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

export class WalletSubmissionUncertain extends Error {}
export class WalletNotSubmitted extends Error {}

/** Build transfer + signer-bound memo; the gateway also validates wallet-added compute settings. */
export async function sendPayment(
  payment: Payment,
  token: string,
): Promise<string> {
  const wallet = window.phantom?.solana;
  let transaction: Transaction;
  try {
    if (!wallet?.isPhantom)
      throw new Error("Install or open Phantom to pay with Devnet SOL.");
    if (payment.status !== "pending" || Date.now() >= payment.expiresAt)
      throw new Error("This payment is not currently payable.");
    const connection = new Connection(checkoutRpcUrl(payment.id), {
      commitment: "finalized",
      httpHeaders: { authorization: `Bearer ${token}` },
      disableRetryOnRateLimit: true,
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.timeout(12_000),
          redirect: "error",
          credentials: "omit",
        }),
    });
    if (
      (await connection.getGenesisHash()) !==
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    )
      throw new Error("The configured network is not Solana Devnet.");
    const connected = await wallet.connect();
    const publicKey = new PublicKey(connected.publicKey.toBase58());
    const latest = await connection.getLatestBlockhash("finalized");
    if (Date.now() >= payment.expiresAt)
      throw new Error("Payment expired before submission.");
    transaction = new Transaction({
      feePayer: publicKey,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    });
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new PublicKey(payment.recipient),
        lamports: BigInt(payment.lamports),
      }),
      new TransactionInstruction({
        programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
        data: Buffer.from(payment.memo, "utf8"),
      }),
    );
  } catch (error) {
    throw new WalletNotSubmitted(
      error instanceof Error
        ? error.message
        : "Wallet preparation was not completed.",
      { cause: error },
    );
  }
  try {
    const result = await wallet!.signAndSendTransaction(transaction);
    if (
      typeof result?.signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(result.signature)
    ) {
      throw new WalletSubmissionUncertain(
        "The wallet did not return a usable transaction signature.",
      );
    }
    return result.signature;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 4001
    ) {
      throw new WalletNotSubmitted(
        "Wallet approval was declined. No payment was submitted by this request.",
        { cause: error },
      );
    }
    throw new WalletSubmissionUncertain(
      "Wallet submission could not be confirmed. Check wallet activity and contact the merchant before paying again.",
      { cause: error },
    );
  }
}
