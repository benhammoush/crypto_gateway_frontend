import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Payment } from "./types";
import { checkoutRpcUrl } from "./api";

export interface PhantomProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(
    transaction: VersionedTransaction,
  ): Promise<{ signature: string }>;
  request?(request: {
    method: "signAndSendTransaction";
    params: { message: string };
  }): Promise<{ signature: string }>;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

const WALLET_DIAGNOSTICS = [
  "WALLET_REQUEST_FAILED",
  "WALLET_RESPONSE_INVALID",
  "WALLET_RPC_-32603",
  "WALLET_RPC_-32600",
  "WALLET_RPC_-32602",
  "WALLET_RPC_-32601",
  "WALLET_RPC_-32002",
  "WALLET_RPC_-32003",
  "WALLET_RPC_-32000",
  "WALLET_RPC_4100",
  "WALLET_RPC_4200",
  "WALLET_RPC_4900",
  "WALLET_RPC_4901",
] as const;
type WalletDiagnostic = (typeof WALLET_DIAGNOSTICS)[number];

/** Accept only fixed diagnostic labels, including when restoring tab storage. */
export function walletDiagnostic(value: unknown): WalletDiagnostic | undefined {
  return WALLET_DIAGNOSTICS.find((code) => code === value);
}

export class WalletSubmissionUncertain extends Error {
  constructor(
    message: string,
    options?: ErrorOptions,
    readonly diagnosticCode: WalletDiagnostic = "WALLET_REQUEST_FAILED",
  ) {
    super(message, options);
  }
}
export class WalletNotSubmitted extends Error {}

/** Build transfer + signer-bound memo; the gateway also validates wallet-added compute settings. */
export async function sendPayment(
  payment: Payment,
  token: string,
): Promise<string> {
  const wallet = window.phantom?.solana;
  let walletTransaction: VersionedTransaction;
  try {
    if (!wallet?.isPhantom)
      throw new Error("Install or open Phantom to pay with Devnet SOL.");
    if (payment.status !== "pending" || Date.now() >= payment.expiresAt)
      throw new Error("This payment is not currently payable.");
    const connection = new Connection(checkoutRpcUrl(payment.id), {
      commitment: "finalized",
      httpHeaders: { authorization: `Bearer ${token}` },
      disableRetryOnRateLimit: true,
      fetch: (url, init) => {
        // Kit elides Solana's finalized default; the gateway contract requires
        // that commitment explicitly, even when it is the network default.
        let body = init?.body;
        if (typeof body === "string") {
          const rpc = JSON.parse(body);
          if (
            rpc.method === "getLatestBlockhash" &&
            Array.isArray(rpc.params) &&
            rpc.params.length === 0
          ) {
            rpc.params = [{ commitment: "finalized" }];
            body = JSON.stringify(rpc);
          }
        }
        return fetch(url, {
          ...init,
          body,
          signal: AbortSignal.timeout(12_000),
          redirect: "error",
          credentials: "omit",
        });
      },
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
    const transaction = new Transaction({
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
        data: new TextEncoder().encode(payment.memo),
      }),
    );
    // This wrapper retains the legacy message/wire format but provides the
    // synchronous serialize() required at the injected wallet boundary.
    walletTransaction = new VersionedTransaction(transaction.compileMessage());
  } catch (error) {
    throw new WalletNotSubmitted(
      error instanceof Error
        ? error.message
        : "Wallet preparation was not completed.",
      { cause: error },
    );
  }
  try {
    const result = await wallet!.signAndSendTransaction(walletTransaction);
    if (
      typeof result?.signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(result.signature)
    ) {
      throw new WalletSubmissionUncertain(
        "The wallet did not return a usable transaction signature.",
        undefined,
        "WALLET_RESPONSE_INVALID",
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
      error instanceof WalletSubmissionUncertain
        ? error.diagnosticCode
        : error &&
            typeof error === "object" &&
            "code" in error &&
            typeof error.code === "number"
          ? walletDiagnostic(`WALLET_RPC_${error.code}`)
          : undefined,
    );
  }
}
