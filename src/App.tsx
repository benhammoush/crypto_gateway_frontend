/**
 * Merchant example and checkout lifecycle with guarded wallet submission.
 * @packageDocumentation
 */

import { FormEvent, useEffect, useRef, useState } from "react";
import { parseUsd, paymentStatus, request, submitSignature } from "./api";
import { Payment, PROGRESS, Progress } from "./types";
import {
  sendPayment,
  walletDiagnostic,
  walletFailureDetails,
  WalletNotSubmitted,
  WalletSubmissionUncertain,
} from "./wallet";
import { readSession, removeSession, saveSession } from "./storage";

const MAX_POLLS = 180;

/** Render the merchant example and create a checkout through the server-side adapter. */
function Demo() {
  const [amount, setAmount] = useState("10.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{ cents: number; key: string }>();
  const [availability, setAvailability] = useState<
    "checking" | "enabled" | "disabled" | "unavailable"
  >("checking");

  useEffect(() => {
    const controller = new AbortController();
    void request<{ enabled: boolean }>("/api/demo/status", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((status) => {
        if (controller.signal.aborted) return;
        setAvailability(
          typeof status.enabled === "boolean"
            ? status.enabled
              ? "enabled"
              : "disabled"
            : "unavailable",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability("unavailable");
      });
    return () => controller.abort();
  }, []);

  /** Create the payment from validated form input and navigate to its checkout. */
  async function pay(event: FormEvent) {
    event.preventDefault();
    if (busy || availability !== "enabled") return;
    setError("");
    setBusy(true);
    try {
      const cents = parseUsd(amount);
      const key = retry?.cents === cents ? retry.key : crypto.randomUUID();
      setRetry({ cents, key });
      const result = await request<{ checkoutUrl: string }>(
        "/api/demo/payments",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": key,
          },
          body: JSON.stringify({ usdCents: cents }),
        },
      );
      const destination = new URL(result.checkoutUrl);
      if (
        destination.origin !== location.origin ||
        !/^\/checkout\/[a-f0-9-]{36}$/.test(destination.pathname)
      )
        throw new Error(
          "The demo returned an unexpected checkout destination.",
        );
      location.assign(destination.href);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to create payment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <p className="eyebrow">INTEGRATION EXAMPLE</p>
      <h1>
        One amount.
        <br />
        <span>One payment.</span>
      </h1>
      <p className="description">
        Enter a USD amount. The gateway locks a SOL quote and verifies your
        transfer on-chain.
      </p>
      <form onSubmit={pay}>
        <label htmlFor="amount">Amount in USD</label>
        <div className="amount">
          <span>$</span>
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={busy || availability !== "enabled"}
            autoComplete="off"
            required
          />
          <span className="currency">USD</span>
        </div>
        <button type="submit" disabled={busy || availability !== "enabled"}>
          {busy ? "Opening checkout…" : "Pay"}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
      {availability !== "enabled" && (
        <p className="notice" role="status">
          {availability === "checking"
            ? "Checking demo availability…"
            : availability === "disabled"
              ? "Demo payments are disabled."
              : "Demo availability could not be checked. Payments remain unavailable; reload to try again."}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <p className="footnote">
        This demo lets you choose the amount. Real applications calculate what
        is owed on their own backend.
      </p>
    </section>
  );
}

/** Checkout state is server-authoritative; wallet messages never imply settlement. */
export function Checkout({ id, token }: { id: string; token: string }) {
  const [payment, setPayment] = useState<Payment>();
  const [progress, setProgress] = useState<Progress>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const [now, setNow] = useState(Date.now());
  const savedKey = `crypto_gateway:signature:${id}`;
  const candidate = useRef(readSession(savedKey));
  const terminal = useRef(false);
  const [uncertain, setUncertain] = useState(
    readSession(`${savedKey}:uncertain`) === "true",
  );
  const [diagnostic, setDiagnostic] = useState(() =>
    walletDiagnostic(readSession(`${savedKey}:walletDiagnostic`)),
  );
  const [walletFailure, setWalletFailure] = useState(() =>
    import.meta.env.VITE_APP_ENV === "dev"
      ? walletFailureDetails(readSession(`${savedKey}:walletFailure`))
      : undefined,
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    /** Refresh payment state while this checkout remains active. */
    async function poll() {
      try {
        const current = await paymentStatus(id, token, controller.signal);
        if (controller.signal.aborted || terminal.current) return;
        setPayment(current);
        if (current.status === "settled") {
          terminal.current = true;
          setProgress("Payment verified");
          setMessage("");
          removeSession(savedKey);
          removeSession(`${savedKey}:uncertain`);
          removeSession(`${savedKey}:walletDiagnostic`);
          removeSession(`${savedKey}:walletFailure`);
          return;
        }
        const signature = candidate.current;
        const attempt = current.attempts.find(
          (entry) => entry.signature === signature,
        );
        if (signature && !attempt) {
          setProgress("Transaction submitted");
          await submitSignature(id, token, signature);
        } else if (current.status === "verifying") {
          setProgress("Verifying on-chain");
          setMessage("");
        } else if (attempt?.state === "rejected") {
          setProgress(undefined);
          setMessage(
            "This transfer could not be verified. Contact the merchant before sending another payment.",
          );
          return;
        } else if (current.status === "expired") {
          setProgress(undefined);
          setMessage(
            "This quote has expired. Do not send a new transfer. If you already paid, contact the merchant.",
          );
          return;
        }
      } catch {
        if (controller.signal.aborted || terminal.current) return;
        setMessage(
          "Unable to refresh payment status. Your payment has not been marked failed.",
        );
      }
      if (!controller.signal.aborted && ++polls < MAX_POLLS)
        timer = setTimeout(() => void poll(), 5000);
      else if (!controller.signal.aborted)
        setMessage(
          "Automatic updates paused. Refresh status to continue tracking.",
        );
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, token, savedKey, round]);

  /**
   * Guard wallet submission with uncertainty until the returned signature is saved.
   * The candidate signature then continues preventing duplicate payment during verification.
   */
  async function pay() {
    if (!payment || busy || candidate.current || uncertain) return;
    setBusy(true);
    setMessage("");
    setProgress("Awaiting wallet approval");
    let submitted = false;
    try {
      // Guard BEFORE opening the wallet: it may broadcast before its promise
      // resolves, and a reload in that window must not offer another transfer.
      if (!saveSession(`${savedKey}:uncertain`, "true")) {
        throw new WalletNotSubmitted(
          "Enable session storage before submitting a payment safely.",
        );
      }
      setUncertain(true);
      const signature = await sendPayment(payment, token);
      submitted = true;
      candidate.current = signature;
      if (saveSession(savedKey, signature)) {
        removeSession(`${savedKey}:uncertain`);
        setUncertain(false);
      }
      setProgress("Transaction submitted");
      const current = await submitSignature(id, token, signature);
      if (!terminal.current) {
        setPayment(current);
        if (current.status === "settled") {
          terminal.current = true;
          setProgress("Payment verified");
        } else if (current.status === "verifying")
          setProgress("Verifying on-chain");
        else {
          setProgress(undefined);
          setMessage(
            "This transfer could not be verified. Contact the merchant before sending another payment.",
          );
        }
      }
      setRound((value) => value + 1);
    } catch (error) {
      if (error instanceof WalletSubmissionUncertain) {
        const code = walletDiagnostic(error.diagnosticCode);
        setDiagnostic(code);
        if (code) saveSession(`${savedKey}:walletDiagnostic`, code);
        if (import.meta.env.VITE_APP_ENV === "dev") {
          const details = walletFailureDetails(error.details);
          setWalletFailure(details);
          if (details)
            saveSession(`${savedKey}:walletFailure`, JSON.stringify(details));
        }
      }
      if (error instanceof WalletNotSubmitted) {
        removeSession(`${savedKey}:uncertain`);
        setUncertain(false);
      }
      if (!submitted) setProgress(undefined);
      setMessage(
        submitted
          ? "Your transaction was submitted. Refresh status; do not pay again."
          : error instanceof Error
            ? error.message
            : "Wallet approval was not completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const remaining = payment
    ? Math.max(0, Math.ceil((payment.expiresAt - now) / 1000))
    : 0;
  const canPay =
    payment?.status === "pending" &&
    remaining > 0 &&
    !candidate.current &&
    !uncertain;
  return (
    <section className="card">
      <p className="eyebrow">HOSTED CHECKOUT</p>
      <h1>
        Pay with <span>SOL.</span>
      </h1>
      {payment ? (
        <>
          <div className="total">
            ${(payment.usdCents / 100).toFixed(2)} <small>USD</small>
          </div>
          <div className="quote">
            {payment.displaySol} SOL{" "}
            <span>
              Quote locked · {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, "0")}
            </span>
          </div>
          <dl>
            <dt>Network</dt>
            <dd>Solana Devnet</dd>
            <dt>Recipient</dt>
            <dd className="address">{payment.recipient}</dd>
          </dl>
          {canPay && (
            <button onClick={() => void pay()} disabled={busy}>
              {busy ? "Check your wallet…" : "Pay with Phantom"}
              <span aria-hidden="true">↗</span>
            </button>
          )}
        </>
      ) : (
        <p className="description">Loading payment…</p>
      )}
      <ol className="progress" aria-label="Payment progress" aria-live="polite">
        {PROGRESS.map((label, index) => (
          <li
            key={label}
            className={
              progress && index <= PROGRESS.indexOf(progress) ? "active" : ""
            }
            aria-current={label === progress ? "step" : undefined}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {progress === "Payment verified" && (
        <p className="notice success">
          Verified testnet transfer. No real funds were used.
        </p>
      )}
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      {uncertain && !busy && !message && progress !== "Payment verified" && (
        <p className="notice" role="alert">
          Wallet submission is uncertain. Check wallet activity and contact the
          merchant before paying again.
        </p>
      )}
      {uncertain && !busy && progress !== "Payment verified" && (
        <p className="notice" role="status">
          Wallet diagnostic: <code>{diagnostic ?? "UNAVAILABLE"}</code>. This
          does not confirm whether a transfer was submitted.
          <br />
          Wallet API check: request{" "}
          {typeof window.phantom?.solana?.request === "function"
            ? "available"
            : "unavailable"}
          ; direct sender{" "}
          {window.phantom?.solana &&
          "signAndSendTransaction" in window.phantom.solana &&
          typeof window.phantom.solana.signAndSendTransaction === "function"
            ? "available"
            : "unavailable"}
          .
          {import.meta.env.VITE_APP_ENV === "dev" && walletFailure && (
            <>
              <br />
              Dev wallet hint: <code>{walletFailure.reason}</code>.
              <br />
              Wallet wait: {walletFailure.walletSeconds}s. Time since blockhash
              fetched: {walletFailure.blockhashSeconds}s.
              <br />
              Quote expired at error:{" "}
              {walletFailure.quoteExpired ? "yes" : "no"}. These details do not
              prove submission or the cause.
            </>
          )}
        </p>
      )}
      {!busy && progress !== "Payment verified" && (
        <button
          className="secondary"
          onClick={() => {
            setMessage("");
            setRound((value) => value + 1);
          }}
        >
          Refresh status
        </button>
      )}
      <p className="footnote">
        Payment reference <span className="address">{id}</span>
      </p>
    </section>
  );
}

/** Select the merchant example or the capability-bearing checkout route. */
export default function App() {
  const match = /^\/checkout\/([a-f0-9-]{36})$/.exec(location.pathname);
  let token = "";
  if (match) {
    const key = `crypto_gateway:session:${match[1]}`;
    const fragment = location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(fragment)) {
      if (saveSession(key, fragment))
        history.replaceState(null, "", location.pathname);
      token = fragment;
    }
    token ||= readSession(key) ?? "";
  }
  return (
    <div className="shell">
      <header>
        <a href="/" className="brand">
          crypto<span>_</span>gateway
        </a>
        <span className="badge">DEVNET · NO REAL FUNDS</span>
      </header>
      <main>
        {match ? (
          token ? (
            <Checkout id={match[1]} token={token} />
          ) : (
            <section className="card">
              <h1>Session unavailable.</h1>
              <p>Reopen the original checkout link from your application.</p>
            </section>
          )
        ) : (
          <Demo />
        )}
      </main>
      <footer>
        <span>USD → SOL</span>
        <span>NON-CUSTODIAL / VERIFIED ON-CHAIN</span>
      </footer>
    </div>
  );
}
