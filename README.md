# Crypto Gateway — checkout

A hosted SOL checkout for merchants using the
[Crypto Gateway API](https://github.com/benhammoush/crypto_gateway_backend).
Customers review a USD-denominated payment and approve the corresponding SOL
transfer in Phantom.

## Tech stack

| Layer                        | Technology                                    |
| ---------------------------- | --------------------------------------------- |
| Interface and build          | React, TypeScript, Vite                       |
| Wallet integration           | Phantom, Solana web3.js                       |
| Server-side merchant example | Node.js locally, Vercel functions when hosted |
| Testing                      | Vitest, Testing Library, Playwright           |

## Features

- Display the locked SOL quote, expiry and merchant recipient.
- Request wallet approval and show submission and verification progress.
- Refresh payment status without automatically sending another transfer.
- Preserve checkout state within the browser tab when session storage is available.
- Provide an amount-entry example illustrating merchant integration.

## Boundaries and integration

Phantom signs and submits the payment directly to Solana. The backend independently
verifies settlement; checkout shows **Payment verified** only after backend
confirmation. An uncertain wallet submission never triggers an automatic second
transfer. Payment submission is blocked when safe session storage is unavailable.

The example's server-side adapter creates payments without exposing merchant
credentials. Real merchants calculate the amount owed from trusted business data;
checkout does not price orders or manage fulfillment. Payment-scoped capabilities
authorize checkout requests, and provider keys remain server-side.

See [the backend API contract](https://github.com/benhammoush/crypto_gateway_backend/blob/main/openapi.json)
for integration details.

The [security limitations](docs/SECURITY.md) describe the checkout's trust boundaries.
