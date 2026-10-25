/**
 * Wallet submission, bounded diagnostics and uncertain-submission protection.
 * @packageDocumentation
 */

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

/** Serialized-message request supported by the optional wallet capability. */
interface WalletRequest {
  method: "signAndSendTransaction";
  params: { message: string };
}

/** Injected wallet capabilities accepted at the browser boundary. */
export interface PhantomProvider {
  isPhantom?: boolean;
  /** Ask the user to connect and expose the approved public key.
   * @returns The wallet-approved public key.
   */
  connect(): Promise<{ publicKey: PublicKey }>;
  /** Approve and submit the transaction; a returned signature is not settlement evidence.
   * @param transaction - Locally prepared Devnet transfer and signer-bound memo.
   * @returns The wallet's candidate transaction signature.
   */
  signAndSendTransaction(
    transaction: VersionedTransaction,
  ): Promise<{ signature: string }>;
  /** Optional serialized-message submission capability exposed by the injected wallet.
   * @param request - Serialized transaction request understood by the wallet.
   * @returns The wallet's candidate transaction signature.
   */
  request?(request: WalletRequest): Promise<{ signature: string }>;
}

declare global {
  /** Browser extension for the optional injected Phantom provider. */
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
/** Allowlisted diagnostic code safe to retain in checkout recovery state. */
type WalletDiagnostic = (typeof WALLET_DIAGNOSTICS)[number];

/** Accept only fixed diagnostic labels, including when restoring tab storage.
 * @param value - Untrusted diagnostic value.
 * @returns An allowlisted label, or undefined for unknown values.
 */
export function walletDiagnostic(value: unknown): WalletDiagnostic | undefined {
  return WALLET_DIAGNOSTICS.find((code) => code === value);
}

const WALLET_FAILURE_REASONS = [
  "BLOCKHASH_EXPIRED_OR_MISSING",
  "INSUFFICIENT_FUNDS",
  "SIMULATION_FAILED",
  "TRANSACTION_ENCODING_FAILED",
  "NETWORK_OR_TIMEOUT",
  "INVALID_WALLET_RESPONSE",
  "UNKNOWN",
] as const;

/** Bounded timing and reason fields; never raw wallet error text. */
interface WalletFailureDetails {
  reason: (typeof WALLET_FAILURE_REASONS)[number];
  walletSeconds: number;
  blockhashSeconds: number;
  quoteExpired: boolean;
}

/** Rebuild only fixed fields, including when restoring untrusted tab storage.
 * @param value - Untrusted object or serialized recovery state.
 * @returns Validated, bounded fields, or undefined when validation fails.
 */
export function walletFailureDetails(
  value: unknown,
): WalletFailureDetails | undefined {
  try {
    const parsed: unknown =
      typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return;
    const details = parsed as Record<string, unknown>;
    const reason = WALLET_FAILURE_REASONS.find(
      (item) => item === details.reason,
    );
    if (
      !reason ||
      typeof details.walletSeconds !== "number" ||
      !Number.isInteger(details.walletSeconds) ||
      details.walletSeconds < 0 ||
      details.walletSeconds > 86_400 ||
      typeof details.blockhashSeconds !== "number" ||
      !Number.isInteger(details.blockhashSeconds) ||
      details.blockhashSeconds < details.walletSeconds ||
      details.blockhashSeconds > 86_400 ||
      typeof details.quoteExpired !== "boolean"
    )
      return;
    return {
      reason,
      walletSeconds: details.walletSeconds,
      blockhashSeconds: details.blockhashSeconds,
      quoteExpired: details.quoteExpired,
    };
  } catch {
    return;
  }
}

/** Message text is inspected locally for hints, never retained or displayed.
 * @param error - Untrusted wallet failure, possibly with inaccessible properties.
 * @returns An allowlisted reason without raw wallet text.
 */
function walletFailureReason(error: unknown): WalletFailureDetails["reason"] {
  if (
    error instanceof WalletSubmissionUncertain &&
    error.diagnosticCode === "WALLET_RESPONSE_INVALID"
  )
    return "INVALID_WALLET_RESPONSE";
  try {
    if (!error || typeof error !== "object") return "UNKNOWN";
    const messages: string[] = [];
    if ("message" in error && typeof error.message === "string")
      messages.push(error.message.slice(0, 1024));
    if (
      "data" in error &&
      error.data &&
      typeof error.data === "object" &&
      "message" in error.data &&
      typeof error.data.message === "string"
    )
      messages.push(error.data.message.slice(0, 1024));
    const text = messages.join(" ");
    if (
      /blockhash (?:not found|expired)|block height exceeded|transaction expired/i.test(
        text,
      )
    )
      return "BLOCKHASH_EXPIRED_OR_MISSING";
    if (
      /insufficient (?:funds|lamports|balance)|not enough (?:sol|funds|lamports)/i.test(
        text,
      )
    )
      return "INSUFFICIENT_FUNDS";
    if (/simulation failed|transaction simulation/i.test(text))
      return "SIMULATION_FAILED";
    if (
      /serializ|deserializ|invalid transaction|malformed transaction/i.test(
        text,
      )
    )
      return "TRANSACTION_ENCODING_FAILED";
    if (
      /disconnected|network error|failed to fetch|fetch failed|timed out|timeout/i.test(
        text,
      )
    )
      return "NETWORK_OR_TIMEOUT";
  } catch {
    // Diagnostics must never replace the uncertain-submission guard with an error.
  }
  return "UNKNOWN";
}

/** Wallet submission may have occurred; callers must not assume a second payment is safe. */
export class WalletSubmissionUncertain extends Error {
  /** Retain the uncertainty classification and optional safe diagnostics.
   * @param message - Public explanation of the uncertain submission.
   * @param options - Original cause for local error handling.
   * @param diagnosticCode - Allowlisted wallet diagnostic label.
   * @param details - Optional bounded timing and reason fields.
   */
  constructor(
    message: string,
    options?: ErrorOptions,
    readonly diagnosticCode: WalletDiagnostic = "WALLET_REQUEST_FAILED",
    readonly details?: WalletFailureDetails,
  ) {
    super(message, options);
  }
}
/** Failure classified as occurring without a submitted payment from this request. */
export class WalletNotSubmitted extends Error {}

/** Build transfer + signer-bound memo; the gateway also validates wallet-added compute settings.
 * @param payment - Backend-issued payment quote with integer lamports.
 * @param token - Checkout capability authorizing the scoped gateway RPC.
 * @returns The wallet's candidate signature, never proof of settlement.
 */
export async function sendPayment(
  payment: Payment,
  token: string,
): Promise<string> {
  const wallet = window.phantom?.solana;
  let walletTransaction: VersionedTransaction;
  let blockhashFetchedAt: number;
  try {
    if (!wallet?.isPhantom)
      throw new Error("Install or open Phantom to pay with Devnet SOL.");
    if (payment.status !== "pending" || Date.now() >= payment.expiresAt)
      throw new Error("This payment is not currently payable.");
    const connection = new Connection(checkoutRpcUrl(payment.id), {
      commitment: "finalized",
      httpHeaders: { authorization: `Bearer ${token}` },
      disableRetryOnRateLimit: true,
      /** Preserve the explicit-finality gateway contract and bound each browser RPC request.
       * @param url - Gateway RPC URL selected by the connection.
       * @param init - SDK request options before commitment normalization.
       * @returns The bounded RPC response without redirects or browser credentials.
       */
      fetch: (url, init) => {
        // Kit elides Solana's finalized default; the gateway contract requires
        // that commitment explicitly, even when it is the network default.
        let body = init?.body;
        if (typeof body === "string") {
          const rpc: unknown = JSON.parse(body);
          if (
            rpc !== null &&
            typeof rpc === "object" &&
            "method" in rpc &&
            rpc.method === "getLatestBlockhash" &&
            "params" in rpc &&
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
    blockhashFetchedAt = performance.now();
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
  const walletStartedAt = performance.now();
  try {
    const result = await wallet.signAndSendTransaction(walletTransaction);
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
    const stoppedAt = performance.now();
    const details =
      import.meta.env.VITE_APP_ENV === "dev"
        ? walletFailureDetails({
            reason: walletFailureReason(error),
            walletSeconds: Math.floor((stoppedAt - walletStartedAt) / 1000),
            blockhashSeconds: Math.floor(
              (stoppedAt - blockhashFetchedAt) / 1000,
            ),
            quoteExpired: Date.now() >= payment.expiresAt,
          })
        : undefined;
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
      details,
    );
  }
}
