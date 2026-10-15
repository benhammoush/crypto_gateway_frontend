import { expect, test } from "@playwright/test";

test("browser wallet flow verifies only after authoritative settlement", async ({
  page,
}) => {
  const id = "22222222-2222-4222-8222-222222222222";
  let submitted = false;
  let settled = false;
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
            instructions: { data: { toString(encoding: string): string } }[];
          }) => {
            if (
              transaction.instructions.length !== 2 ||
              !transaction.instructions[1].data
                .toString("utf8")
                .startsWith("crypto_gateway:")
            )
              throw new Error("Unexpected transaction format.");
            return { signature: "1".repeat(64) };
          },
        },
      },
    });
  });
  const headers = {
    "access-control-allow-origin": "http://localhost:5173",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers, body: "" });
      return;
    }
    const method = route.request().postDataJSON().method;
    await route.fulfill({
      headers,
      json: {
        jsonrpc: "2.0",
        id: route.request().postDataJSON().id,
        result:
          method === "getGenesisHash"
            ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
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
});

test("USD form creates a payment and opens checkout with four progress steps", async ({
  page,
}) => {
  const id = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/demo/payments", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ usdCents: 1234 });
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      json: {
        data: {
          checkoutUrl: `http://localhost:5173/checkout/${id}#${"a".repeat(64)}`,
        },
      },
    });
  });
  await page.route("**/v1/checkout/**", async (route) => {
    await route.fulfill({
      headers: {
        "access-control-allow-origin": "http://localhost:5173",
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
