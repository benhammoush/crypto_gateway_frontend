import { expect, test } from "@playwright/test";
import {
  SystemInstruction,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

test("wallet failure hints stay dev-only and cannot trigger a second submission", async ({
  page,
}) => {
  const id = "33333333-3333-4333-8333-333333333333";
  const secret = "fixture-secret-must-not-render";
  const headers = {
    "access-control-allow-origin": test.info().project.use.baseURL!,
    "access-control-allow-headers":
      "authorization, content-type, solana-client",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  await page.addInitScript((secret) => {
    Object.assign(window, {
      fixtureSendCount: 0,
      phantom: {
        solana: {
          isPhantom: true,
          connect: async () => ({
            publicKey: { toBase58: () => "1".repeat(32) },
          }),
          signAndSendTransaction: async () => {
            const state = window as unknown as { fixtureSendCount: number };
            state.fixtureSendCount++;
            throw {
              code: -32603,
              message: `Blockhash not found; https://rpc.invalid/?api-key=${secret}`,
            };
          },
        },
      },
    });
  }, secret);
  await page.route("**/v1/checkout/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers, body: "" });
    } else if (route.request().url().endsWith("/rpc")) {
      const body = route.request().postDataJSON();
      await route.fulfill({
        headers,
        json: {
          jsonrpc: "2.0",
          id: body.id,
          result:
            body.method === "getGenesisHash"
              ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
              : {
                  context: { slot: 1 },
                  value: {
                    blockhash: "1".repeat(32),
                    lastValidBlockHeight: 100,
                  },
                },
        },
      });
    } else {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({
        headers,
        json: {
          data: {
            id,
            usdCents: 1,
            displaySol: "0.000095794",
            lamports: "95794",
            status: "pending",
            recipient: "So11111111111111111111111111111111111111112",
            expiresAt: Date.now() + 900_000,
            memo: `crypto_gateway:${id}`,
            network: "solana-devnet",
            attempts: [],
            signature: null,
          },
        },
      });
    }
  });
  await page.goto(`/checkout/${id}#${"a".repeat(64)}`);
  await page.getByRole("button", { name: "Pay with Phantom" }).click();
  await expect(page.getByRole("status")).toContainText("WALLET_RPC_-32603");
  if (process.env.VITE_APP_ENV === "dev") {
    await expect(page.getByRole("status")).toContainText(
      "Dev wallet hint: BLOCKHASH_EXPIRED_OR_MISSING",
    );
    await expect(page.getByRole("status")).toContainText(
      "Time since blockhash fetched:",
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect(page.getByRole("status")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("dev-wallet-diagnostic.png"),
      fullPage: true,
    });
  } else {
    await expect(
      page.getByText("Dev wallet hint:", { exact: false }),
    ).toHaveCount(0);
  }
  await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    page.getByRole("button", { name: "Pay with Phantom" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fixtureSendCount: number }).fixtureSendCount,
    ),
  ).toBe(1);
  const stored = await page.evaluate(
    (id) =>
      sessionStorage.getItem(`crypto_gateway:signature:${id}:walletFailure`),
    id,
  );
  expect(stored ?? "").not.toContain(secret);
  if (process.env.VITE_APP_ENV !== "dev") expect(stored).toBeNull();
});

test("browser wallet flow verifies only after authoritative settlement", async ({
  page,
}) => {
  const id = "22222222-2222-4222-8222-222222222222";
  let submitted = false;
  let settled = false;
  const rpcMethods: string[] = [];
  await page.exposeFunction("validateFixtureMessage", (wire: number[]) => {
    const bytes = new Uint8Array(wire);
    const decoded = VersionedTransaction.deserialize(bytes);
    expect(decoded.version).toBe("legacy");
    const transaction = Transaction.from(bytes);
    expect(transaction.instructions).toHaveLength(2);
    const transfer = SystemInstruction.decodeTransfer(
      transaction.instructions[0],
    );
    expect(transfer.lamports).toBe(100000000n);
    expect(transfer.fromPubkey.toBase58()).toBe("1".repeat(32));
    expect(transfer.toPubkey.toBase58()).toBe(
      "So11111111111111111111111111111111111111112",
    );
    expect(transaction.feePayer?.toBase58()).toBe("1".repeat(32));
    expect(decoded.message.header.numRequiredSignatures).toBe(1);
    const memo = transaction.instructions[1];
    expect(memo.programId.toBase58()).toBe(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    expect(new TextDecoder().decode(memo.data)).toBe(`crypto_gateway:${id}`);
    expect(memo.keys[0].pubkey.toBase58()).toBe("1".repeat(32));
    expect(memo.keys[0].isSigner).toBe(true);
  });
  await page.addInitScript(() => {
    Object.assign(window, {
      phantom: {
        solana: {
          isPhantom: true,
          connect: () =>
            new Promise((resolve) =>
              Object.assign(window, {
                approveFixtureWallet: () =>
                  resolve({
                    publicKey: {
                      toBase58: () => "11111111111111111111111111111111",
                    },
                  }),
              }),
            ),
          signAndSendTransaction: async (transaction: {
            serialize(): Uint8Array;
          }) => {
            const bytes = transaction.serialize();
            if (!(bytes instanceof Uint8Array))
              throw new Error("Wallet serialization must be synchronous.");
            await (
              window as unknown as {
                validateFixtureMessage(wire: number[]): Promise<void>;
              }
            ).validateFixtureMessage(Array.from(bytes));
            return { signature: "1".repeat(64) };
          },
        },
      },
    });
  });
  const headers = {
    "access-control-allow-origin": test.info().project.use.baseURL!,
    "access-control-allow-headers":
      "authorization, content-type, solana-client",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  await page.route("**/v1/checkout/**/rpc", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers, body: "" });
      return;
    }
    const method = route.request().postDataJSON().method;
    if (method === "getLatestBlockhash")
      expect(route.request().postDataJSON().params).toEqual([
        { commitment: "finalized" },
      ]);
    expect(route.request().headers().authorization).toBe(
      `Bearer ${"a".repeat(64)}`,
    );
    rpcMethods.push(method);
    await route.fulfill({
      headers,
      json: {
        jsonrpc: "2.0",
        id: route.request().postDataJSON().id,
        result:
          method === "getGenesisHash"
            ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
            : {
                context: { slot: 123 },
                value: {
                  blockhash: "11111111111111111111111111111111",
                  lastValidBlockHeight: 100,
                },
              },
      },
    });
  });
  await page.route("**/v1/checkout/**", async (route) => {
    if (route.request().url().endsWith("/rpc")) return route.fallback();
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers, body: "" });
      return;
    }
    if (route.request().method() === "POST") submitted = true;
    await route.fulfill({
      headers,
      json: {
        data: {
          id,
          usdCents: 1000,
          displaySol: "0.100000000",
          lamports: "100000000",
          status: settled ? "settled" : submitted ? "verifying" : "pending",
          recipient: "So11111111111111111111111111111111111111112",
          expiresAt: Date.now() + 900_000,
          rpcUrl: "https://api.devnet.solana.com",
          memo: `crypto_gateway:${id}`,
          network: "solana-devnet",
          attempts: submitted
            ? [{ signature: "1".repeat(64), state: "pending" }]
            : [],
          signature: settled ? "1".repeat(64) : null,
        },
      },
    });
  });
  await page.goto(`/checkout/${id}#${"a".repeat(64)}`);
  await page.getByRole("button", { name: "Pay with Phantom" }).click();
  await expect(page.locator('[aria-current="step"]')).toHaveText(
    "1Awaiting wallet approval",
  );
  await page.waitForFunction(() => "approveFixtureWallet" in window);
  await page.evaluate(() =>
    (
      window as unknown as { approveFixtureWallet(): void }
    ).approveFixtureWallet(),
  );
  await expect(page.locator('[aria-current="step"]')).toHaveText(
    "3Verifying on-chain",
  );
  await expect(
    page.getByText("Verified testnet transfer. No real funds were used."),
  ).toHaveCount(0);
  settled = true;
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.locator('[aria-current="step"]')).toHaveText(
    "4Payment verified",
  );
  expect(rpcMethods).toEqual(["getGenesisHash", "getLatestBlockhash"]);
});

test("disabled demo explains availability and blocks payment creation", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/demo/status", (route) =>
    route.fulfill({ json: { data: { enabled: false } } }),
  );
  await page.route("**/api/demo/payments", (route) => {
    posts++;
    return route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText(
    "Demo payments are disabled.",
  );
  await expect(
    page.getByRole("button", { name: "Pay", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Amount in USD")).toBeDisabled();
  expect(posts).toBe(0);
});

test("USD form creates a payment and opens checkout with four progress steps", async ({
  page,
}) => {
  const id = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/demo/status", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: { data: { enabled: true } } });
  });
  await page.route("**/api/demo/payments", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ usdCents: 1234 });
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      json: {
        data: {
          checkoutUrl: `${test.info().project.use.baseURL}/checkout/${id}#${"a".repeat(64)}`,
        },
      },
    });
  });
  await page.route("**/v1/checkout/**", async (route) => {
    await route.fulfill({
      headers: {
        "access-control-allow-origin": test.info().project.use.baseURL!,
        "access-control-allow-headers": "authorization",
      },
      json: {
        data: {
          id,
          usdCents: 1234,
          displaySol: "0.082266667",
          lamports: "82266667",
          status: "pending",
          recipient: "So11111111111111111111111111111111111111112",
          expiresAt: Date.now() + 900_000,
          network: "solana-devnet",
          attempts: [],
          signature: null,
        },
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("Amount in USD").fill("12.34");
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByText("$12.34")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Payment progress" }).getByRole("listitem"),
  ).toHaveCount(4);
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(page.getByText("$12.34")).toBeVisible();
});
