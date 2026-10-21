# Crypto gateway — checkout

A payment demo and hosted SOL checkout for the
[Crypto gateway API](https://github.com/benhammoush/crypto_gateway_backend).
**Solana Devnet only; no real funds.** Customers enter a USD amount and approve
the corresponding native SOL transfer in Phantom.

## Tech stack and system design

| Layer                    | Tools                                         |
| ------------------------ | --------------------------------------------- |
| Interface and build      | React, TypeScript, Vite                       |
| Wallet integration       | Phantom, Solana web3.js                       |
| Server-side demo adapter | Node.js locally, Vercel functions when hosted |
| Testing                  | Vitest, Testing Library, Playwright           |

The browser requests a payment through the server-side demo adapter, which keeps
merchant credentials out of the client. Checkout uses a payment-scoped capability
and generated OpenAPI types to communicate with the gateway. Provider keys remain
server-side; Phantom signs and submits the transaction.

The gateway verifies settlement independently. Checkout reports **Payment verified**
only after backend confirmation; an uncertain wallet submission never triggers an
automatic second transfer. Checkout capabilities use tab-scoped storage when
available; otherwise they remain in the URL fragment for that load, and payment
submission is blocked.
