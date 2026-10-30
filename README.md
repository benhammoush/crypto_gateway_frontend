# Crypto Gateway — checkout

A hosted SOL checkout for merchants using the
[Crypto Gateway API](https://github.com/benhammoush/crypto_gateway_backend).
Customers review a USD-denominated payment, connect Phantom and separately approve
the corresponding SOL transfer.

## Tech stack

| Layer                        | Technology                                    |
| ---------------------------- | --------------------------------------------- |
| Interface and build          | React, TypeScript, Vite                       |
| UI components                | Ant Design, Ant Design Web3                   |
| Wallet integration           | Phantom, Solana web3.js                       |
| Server-side merchant example | Node.js locally, Vercel functions when hosted |
| Testing                      | Vitest, Testing Library, Playwright           |

## Features

- Display the locked SOL quote, expiry and merchant recipient.
- Show a refreshing SOL/USD reference before creation and the saved locked rate afterward.
- Request wallet approval and show submission and verification progress.
- Refresh payment status without automatically sending another transfer.
- Preserve checkout state within the browser tab when session storage is available.
- Illustrate both roles in one demo: the business creates a link, then the customer
  reviews and pays; shared progress tracks creation through verification.
- Show a dismissible transaction receipt with an Explorer link, without allowing a
  second payment when the receipt is closed.

## Boundaries and integration

Shared visual values and reusable presentation live in the
[checkout design system](src/design-system/README.md).

Phantom signs and submits the payment directly to Solana. The backend independently
verifies settlement; checkout shows **Payment verified** only after backend
confirmation. An uncertain wallet submission never triggers an automatic second
transfer. Payment submission is blocked when safe session storage is unavailable.

The example's server-side adapter creates payments without exposing merchant
credentials. Real merchants calculate the amount owed from trusted business data;
checkout does not price orders or manage fulfillment. Payment-scoped capabilities
authorize checkout requests, and provider keys remain server-side.

Shared links and checkout reloads show only the customer checkout, not the business
form. The network selector is locked after creation; Mainnet is unavailable because
the backend and wallet sender support Devnet only. Connecting a wallet never sends
funds. If the connected account changes before approval, reload and reconnect.

See [the backend API contract](https://github.com/benhammoush/crypto_gateway_backend/blob/main/openapi.json)
for integration details.

The [security limitations](docs/SECURITY.md) describe the checkout's trust boundaries.
