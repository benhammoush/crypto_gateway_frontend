# crypto_gateway_frontend

USD input + Pay button, followed by hosted SOL checkout. **Solana Devnet only. No real funds.** No shop, carts or orders.

## Local setup

1. Use Node 24 and `npm ci`.
2. Copy `.env.example` to `.env.local` (public configuration).
3. Copy `.env.server.example` to `.env.server.local` (ignored server-only secrets). Set the configured backend merchant credential and `DEMO_ENABLED=true` only when the backend is ready. Origins must match the backend configuration.
4. Start the backend, apply its local migrations, and run its `npm run dev:scheduler` driver so pending verification continues without the browser.
5. In one terminal, `npm run dev:merchant` starts the server-only example adapter on loopback port 3001.
6. In another, `npm run dev` serves `http://localhost:5173` and proxies `/api/demo` to that adapter.
7. Enter USD, click Pay, connect Phantom with a funded Devnet wallet, and approve. Never use real funds or wallet private keys in configuration.

The merchant credential never enters the browser. The adapter supplies the authoritative USD amount to the gateway; choosing it in the UI is intentional for this example, not an appropriate shop pricing model.

## Customer progress

Exactly four progress notifications:

1. Awaiting wallet approval
2. Transaction submitted
3. Verifying on-chain
4. Payment verified

Wallet submission is not settlement. The gateway alone confirms the final step. Wallet rejection, expired quotes and connectivity problems are separate actionable messages. Checkout polls sequentially every five seconds for up to fifteen minutes, with a manual refresh option. Candidate signatures persist in session storage for retry after refresh. The gateway retries independently after receipt.

Before opening the wallet, checkout persists an in-flight guard. Reloading before a signature is returned cannot offer another transfer; the customer must check wallet activity/contact the merchant if submission is uncertain. Definite preparation failures or explicit wallet rejection clear the guard. Browser session storage must be available before submission. API requests combine cancellation with a twelve-second deadline so stalled requests cannot freeze polling indefinitely.

Checkout tokens arrive in a URL fragment, move into tab-scoped session storage and are removed from the address bar. They cannot perform merchant operations. Do not copy them to logs or analytics. Reopen the original checkout link to resume in another tab.

## Public contract

Wallet preparation sends authenticated JSON-RPC calls to the configured gateway's `/v1/checkout/:id/rpc` route. Provider keys/URLs stay server-side. The client ignores the deprecated payment `rpcUrl` field, bounds RPC calls to twelve seconds, never follows redirects, and does not automatically retry rate-limited preparation. Only Phantom can approve and submit the transaction. New clients require a backend that supplies this route; select that compatible pair explicitly. Use `PLAYWRIGHT_PORT=5175` (PowerShell: `$env:PLAYWRIGHT_PORT='5175'`) for browser tests when port 5173 is occupied; tests always start their own server instead of reusing another project's app.

`src/generated-api.ts` is generated from an explicitly selected backend `openapi.json`. `contract-source.json` records source version, revision and hash. Update with:

`npm run contract:generate -- <explicit-openapi-path> <full-backend-sha|local>`

Never infer latest main. `local` supports initial development only and blocks release acceptance until replaced with an exact reviewed backend SHA. The example calls only HTTP endpoints, not private backend modules.

## Checks

- `npm run check`
- `npm run test:e2e` (requires an installed Playwright Chromium)
- `npm audit --audit-level=high`

Builds require explicit `VITE_APP_ENV` and `VITE_API_ORIGIN`; only those public variables are permitted. Do not put secrets in VITE variables. See [delivery](DELIVERY.md) and [security](SECURITY.md).
