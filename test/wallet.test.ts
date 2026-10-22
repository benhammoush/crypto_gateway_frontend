import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Connection,
  PublicKey,
  SystemInstruction,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  sendPayment,
  WalletNotSubmitted,
  WalletSubmissionUncertain,
  walletDiagnostic,
  walletFailureDetails,
} from "../src/wallet";
import type { Payment } from "../src/types";

const payer = new PublicKey("11111111111111111111111111111111");
type GenesisHash = Awaited<ReturnType<Connection["getGenesisHash"]>>;
type LatestBlockhash = Awaited<ReturnType<Connection["getLatestBlockhash"]>>;
const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as GenesisHash;
const blockhash =
  "11111111111111111111111111111111" as LatestBlockhash["blockhash"];
const token = "a".repeat(64);
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
  // Exercise message construction in Node and the browser bundle in Playwright.
  vi.stubGlobal("window", {});
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(genesis);
  vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
    blockhash,
    lastValidBlockHeight: 100n,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(["100000000", "9007199254740993"])(
  "builds exactly one transfer of %s lamports and one signer-bound memo",
  async (lamports) => {
    const send = vi.fn(async (transaction: VersionedTransaction) => {
      const wire = transaction.serialize();
      expect(wire).toBeInstanceOf(Uint8Array);
      const decoded = VersionedTransaction.deserialize(wire);
      expect(decoded.version).toBe("legacy");
      const tx = Transaction.from(wire);
      expect(tx.feePayer?.toBase58()).toBe(payer.toBase58());
      expect(tx.recentBlockhash).toBe(blockhash);
      expect(decoded.message.header.numRequiredSignatures).toBe(1);
      expect(tx.instructions).toHaveLength(2);
      expect(tx.instructions[0].programId.toBase58()).toBe(
        "11111111111111111111111111111111",
      );
      const transfer = SystemInstruction.decodeTransfer(tx.instructions[0]);
      expect(transfer.fromPubkey.toBase58()).toBe(payer.toBase58());
      expect(transfer.toPubkey.toBase58()).toBe(payment.recipient);
      expect(transfer.lamports).toBe(BigInt(lamports));
      expect(tx.instructions[1].programId.toBase58()).toBe(
        "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      );
      expect(new TextDecoder().decode(tx.instructions[1].data)).toBe(
        payment.memo,
      );
      expect(tx.instructions[1].keys[0].pubkey.toBase58()).toBe(
        payer.toBase58(),
      );
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
    expect(await sendPayment({ ...payment, lamports }, token)).toBe(
      "1".repeat(64),
    );
    expect(send).toHaveBeenCalledOnce();
  },
);

it("does not submit on the wrong network or after expiry", async () => {
  const send = vi.fn();
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: send,
    },
  };
  vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValue(
    "mainnet" as GenesisHash,
  );
  await expect(sendPayment(payment, token)).rejects.toThrow(
    "not Solana Devnet",
  );
  vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValue(
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as GenesisHash,
  );
  await expect(sendPayment(payment, token)).rejects.toThrow(
    "not Solana Devnet",
  );
  await expect(
    sendPayment({ ...payment, expiresAt: Date.now() - 1 }, token),
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
  await expect(sendPayment(payment, token)).rejects.toThrow("declined");
  send.mockRejectedValue(new Error("transport disconnected"));
  await expect(sendPayment(payment, token)).rejects.toBeInstanceOf(
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
  await expect(sendPayment(payment, token)).rejects.toBeInstanceOf(
    WalletSubmissionUncertain,
  );
  await expect(sendPayment(payment, token)).rejects.toHaveProperty(
    "diagnosticCode",
    "WALLET_RESPONSE_INVALID",
  );
});

it.each([
  [-32603, "WALLET_RPC_-32603"],
  [-32602, "WALLET_RPC_-32602"],
  [-32003, "WALLET_RPC_-32003"],
  [4200, "WALLET_RPC_4200"],
  [999999, "WALLET_REQUEST_FAILED"],
  ["-32603", "WALLET_REQUEST_FAILED"],
  ["secret-provider-payload", "WALLET_REQUEST_FAILED"],
])(
  "exposes only a fixed diagnostic label for wallet code %s",
  async (code, expected) => {
    window.phantom = {
      solana: {
        isPhantom: true,
        connect: async () => ({ publicKey: payer }),
        signAndSendTransaction: vi.fn().mockRejectedValue({
          code,
          message: "secret-provider-payload",
          data: { checkoutToken: token },
        }),
      },
    };
    const error = await sendPayment(payment, token).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(WalletSubmissionUncertain);
    expect(error).toHaveProperty("diagnosticCode", expected);
    expect((error as Error).message).not.toContain("secret-provider-payload");
    expect((error as Error).message).not.toContain(token);
  },
);

it("rejects arbitrary diagnostic strings restored from storage", () => {
  expect(walletDiagnostic("WALLET_RPC_-32603")).toBe("WALLET_RPC_-32603");
  expect(
    walletDiagnostic("WALLET_RPC_-32603 secret-provider-payload"),
  ).toBeUndefined();
  expect(walletDiagnostic(null)).toBeUndefined();
});

it("authenticates only to the configured gateway, ignoring provider URL data", async () => {
  vi.mocked(Connection.prototype.getGenesisHash).mockRestore();
  vi.mocked(Connection.prototype.getLatestBlockhash).mockRestore();
  const methods: string[] = [];
  const fetchMock = vi.fn(async (url, init: RequestInit) => {
    expect(String(url)).toBe("http://localhost:8787/v1/checkout/fixture/rpc");
    expect(new Headers(init.headers).get("authorization")).toBe(
      `Bearer ${token}`,
    );
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    methods.push(body.method);
    if (body.method === "getLatestBlockhash")
      expect(body.params).toEqual([{ commitment: "finalized" }]);
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result:
        body.method === "getGenesisHash"
          ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
          : {
              context: { slot: 1 },
              value: { blockhash: "1".repeat(32), lastValidBlockHeight: 100 },
            },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const send = vi.fn(async () => ({ signature: "1".repeat(64) }));
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: send,
    },
  };
  expect(
    await sendPayment(
      {
        ...payment,
        rpcUrl: "https://attacker.example.org/?api-key=not-public",
      },
      token,
    ),
  ).toBe("1".repeat(64));
  expect(methods).toEqual(["getGenesisHash", "getLatestBlockhash"]);
});

it("does not retry rate-limited RPC preparation or open the wallet", async () => {
  vi.mocked(Connection.prototype.getGenesisHash).mockRestore();
  const fetchMock = vi.fn(async () => new Response("Limited", { status: 429 }));
  vi.stubGlobal("fetch", fetchMock);
  const connect = vi.fn();
  const send = vi.fn();
  window.phantom = {
    solana: { isPhantom: true, connect, signAndSendTransaction: send },
  };
  await expect(sendPayment(payment, token)).rejects.toBeInstanceOf(
    WalletNotSubmitted,
  );
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(connect).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("does not submit if payment expires during wallet connection", async () => {
  const expiring = { ...payment };
  const send = vi.fn();
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => {
        expiring.expiresAt = Date.now() - 1;
        return { publicKey: payer };
      },
      signAndSendTransaction: send,
    },
  };
  await expect(sendPayment(expiring, token)).rejects.toThrow("expired before");
  expect(send).not.toHaveBeenCalled();
});

it.each([
  ["Blockhash not found", "BLOCKHASH_EXPIRED_OR_MISSING"],
  [
    "Transaction expired: block height exceeded",
    "BLOCKHASH_EXPIRED_OR_MISSING",
  ],
  ["insufficient funds for rent", "INSUFFICIENT_FUNDS"],
  ["Not enough SOL", "INSUFFICIENT_FUNDS"],
  ["Transaction simulation failed", "SIMULATION_FAILED"],
  ["Failed to deserialize transaction", "TRANSACTION_ENCODING_FAILED"],
  ["network error", "NETWORK_OR_TIMEOUT"],
  ["Unexpected error", "UNKNOWN"],
])(
  "classifies dev wallet hint %s without exposing its message",
  async (message, reason) => {
    vi.stubEnv("VITE_APP_ENV", "dev");
    const secret = "secret-must-not-leak";
    const request = vi.fn();
    const send = vi.fn().mockRejectedValue({
      code: -32603,
      message: `${message}: https://rpc.example.org/?api-key=${secret}`,
      data: { token },
    });
    window.phantom = {
      solana: {
        isPhantom: true,
        connect: async () => ({ publicKey: payer }),
        signAndSendTransaction: send,
        request,
      },
    };
    const error = await sendPayment(payment, token).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(WalletSubmissionUncertain);
    expect(error).toMatchObject({
      diagnosticCode: "WALLET_RPC_-32603",
      details: { reason, quoteExpired: false },
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(token);
    expect(JSON.stringify(error)).not.toContain("https://");
    expect(send).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  },
);

it("uses nested message hints and records elapsed time without proving blockhash expiry", async () => {
  vi.stubEnv("VITE_APP_ENV", "dev");
  vi.spyOn(performance, "now")
    .mockReturnValueOnce(1000)
    .mockReturnValueOnce(3500)
    .mockReturnValue(128500);
  const send = vi.fn(async () => {
    vi.spyOn(Date, "now").mockReturnValue(payment.expiresAt + 1);
    throw {
      code: -32603,
      message: "Internal error",
      data: { message: "Blockhash not found" },
    };
  });
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: send,
    },
  };
  await expect(sendPayment(payment, token)).rejects.toMatchObject({
    details: {
      reason: "BLOCKHASH_EXPIRED_OR_MISSING",
      walletSeconds: 125,
      blockhashSeconds: 127,
      quoteExpired: true,
    },
  });
  expect(send).toHaveBeenCalledOnce();
});

it.each(["production", "local", "", undefined])(
  "does not inspect error messages or collect details in %s",
  async (environment) => {
    vi.stubEnv("VITE_APP_ENV", environment);
    const message = vi.fn(() => "secret provider message");
    const failure = {
      code: -32603,
      get message() {
        return message();
      },
    };
    window.phantom = {
      solana: {
        isPhantom: true,
        connect: async () => ({ publicKey: payer }),
        signAndSendTransaction: vi.fn().mockRejectedValue(failure),
      },
    };
    await expect(sendPayment(payment, token)).rejects.toHaveProperty(
      "details",
      undefined,
    );
    expect(message).not.toHaveBeenCalled();
  },
);

it("keeps unexpected message access failures uncertain and never retries", async () => {
  vi.stubEnv("VITE_APP_ENV", "dev");
  const send = vi.fn().mockRejectedValue({
    code: -32603,
    get message() {
      throw new Error("secret");
    },
  });
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: send,
    },
  };
  await expect(sendPayment(payment, token)).rejects.toMatchObject({
    details: { reason: "UNKNOWN" },
  });
  expect(send).toHaveBeenCalledOnce();
});

it("classifies an invalid dev wallet response without treating it as not submitted", async () => {
  vi.stubEnv("VITE_APP_ENV", "dev");
  window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: payer }),
      signAndSendTransaction: async () => ({ signature: "" }),
    },
  };
  await expect(sendPayment(payment, token)).rejects.toMatchObject({
    diagnosticCode: "WALLET_RESPONSE_INVALID",
    details: { reason: "INVALID_WALLET_RESPONSE" },
  });
});

const details = {
  reason: "UNKNOWN",
  walletSeconds: 3,
  blockhashSeconds: 4,
  quoteExpired: false,
};

it("rebuilds dev details from fixed fields only", () => {
  expect(
    walletFailureDetails(JSON.stringify({ ...details, rawMessage: "secret" })),
  ).toEqual(details);
});

it.each([
  null,
  "not json",
  { ...details, reason: "UNKNOWN secret" },
  { ...details, walletSeconds: "3" },
  { ...details, walletSeconds: -1 },
  { ...details, walletSeconds: 1.5 },
  { ...details, walletSeconds: Infinity },
  { ...details, blockhashSeconds: 2 },
  { ...details, blockhashSeconds: 86_401 },
  { ...details, quoteExpired: "false" },
])("rejects untrusted stored wallet details %j", (value) => {
  expect(walletFailureDetails(value)).toBeUndefined();
});
