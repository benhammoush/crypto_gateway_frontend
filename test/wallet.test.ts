import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { sendPayment, WalletSubmissionUncertain } from "../src/wallet";
import type { Payment } from "../src/types";

const payer = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
const payment: Payment = {
  id: "fixture",
  merchantReference: "ref",
  usdCents: 1000,
  lamports: "100000000",
  displaySol: "0.100000000",
  network: "solana-devnet",
  asset: "SOL",
  recipient: "So11111111111111111111111111111111111111112",
  memo: "crypto_gateway:fixture",
  rpcUrl: "https://api.devnet.solana.com",
  createdAt: Date.now(),
  expiresAt: Date.now() + 900_000,
  quote: { usdPrice: "100", blockId: 123 },
  status: "pending",
  signature: null,
  settledAt: null,
  attempts: [],
};

beforeEach(() => {
  // SDK Buffer layout checks require a single Uint8Array realm. Test transaction
  // construction in Node, and exercise the browser bundle separately in Playwright.
  vi.stubGlobal("window", {});
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  );
  vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 100,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("builds exactly one transfer and one signer-bound payment memo", async () => {
  const send = vi.fn(async (tx) => {
    expect(tx.instructions).toHaveLength(2);
    expect(tx.instructions[0].programId.toBase58()).toBe(
      "11111111111111111111111111111111",
    );
    expect(tx.instructions[1].data.toString("utf8")).toBe(payment.memo);
    expect(tx.instructions[1].keys[0].isSigner).toBe(true);
    return { signature: "1".repeat(64) };
  });
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: send,
    },
  };
  expect(await sendPayment(payment)).toBe("1".repeat(64));
  expect(send).toHaveBeenCalledOnce();
});

it("does not submit on the wrong network or after expiry", async () => {
  const send = vi.fn();
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: send,
    },
  };
  vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValue("mainnet");
  await expect(sendPayment(payment)).rejects.toThrow("not Solana Devnet");
  await expect(
    sendPayment({ ...payment, expiresAt: Date.now() - 1 }),
  ).rejects.toThrow("not currently payable");
  expect(send).not.toHaveBeenCalled();
});

it("distinguishes explicit rejection from uncertain submission", async () => {
  const send = vi.fn().mockRejectedValue({ code: 4001 });
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: send,
    },
  };
  await expect(sendPayment(payment)).rejects.toThrow("declined");
  send.mockRejectedValue(new Error("transport disconnected"));
  await expect(sendPayment(payment)).rejects.toBeInstanceOf(
    WalletSubmissionUncertain,
  );
});

it("keeps submission uncertain if the wallet returns no usable signature", async () => {
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: async () => ({ signature: "" }),
    },
  };
  await expect(sendPayment(payment)).rejects.toBeInstanceOf(
    WalletSubmissionUncertain,
  );
});
