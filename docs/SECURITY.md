# Frontend security rules

This is a **Devnet demonstration**, not a mainnet or real-funds payment product.

## Keep secrets out of the browser

Merchant API keys, provider credentials and webhook signing secrets belong on the
server. Checkout tokens are bearer secrets: keep them out of analytics and logs,
preserve the no-referrer policy, and do not share checkout URLs when asking for help.

The only public application settings are `VITE_APP_ENV` and `VITE_API_ORIGIN`.
The build guard also tolerates the exact provider-injected
`VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG` metadata key, but does not validate,
trust or expose its value to the browser. Every other unexpected `VITE_*` key is
rejected. Do not broaden that exception to a prefix or put secrets in public inputs.

## Wallet safety

`sendPayment` passes a `VersionedTransaction` containing a legacy message to
Phantom's `signAndSendTransaction`. The wrapper's `serialize()` method must remain
synchronous. Keep the legacy wire format; do not add an asynchronous serializer,
fallback submission or automatic wallet retry.

Tests do not replace real Phantom Devnet acceptance. If submission is uncertain,
do not offer another transfer just because the UI or network reported an error.

Only `VITE_APP_ENV=dev` collects and displays extra wallet-failure hints. They use
fixed categories inferred from bounded top-level or `data.message` fields. Raw
messages, URLs and provider payloads are never displayed, logged or saved to tab
storage. Stored fields are validated and rebuilt from an allowlist. Local and
production do not collect or render these details.

Rounded timing hints measure wallet wait and time since a blockhash response, not
the blockhash's actual chain age or validity. Hints, quote expiry and timing do not
prove submission or its cause. Uncertain-submission guards remain in force.

## Error messages

Payment-creation errors may display a fixed, allowed gateway error code and
validated UUID v4 Request ID. The server adapter does not forward upstream
messages, URLs or arbitrary fields. Unknown/malformed errors use the generic
fallback and never trigger an automatic retry.

Checkout API errors may also show a validated Request ID beside status-refresh or
uncertain-submission warnings. Wallet/network failures may have no gateway
reference. A reference is not a credential, proof of settlement or proof that
creation failed.

## Demo limits and release checks

The demo is not an authenticated merchant dashboard. Origin checks do not stop
bots; configure provider-native abuse controls. In-memory webhook acknowledgement
is not a fulfillment ledger.

Before release, verify wallet behavior, hosted protection/isolation, a strict
browser security policy for selected origins, raw-body webhook handling and
recovery. Run a fresh dependency audit; CI blocks high/critical advisories, but a
pass does not mean there are no advisories.

Dependency versions live in `package.json` and the lockfile. Solana web3.js 3.1.0
replaced the v1 jayson/stream-json/uuid advisory chain without transitive overrides.
Preserve the reviewed synchronous wallet/message behavior when upgrading.

Contract generation temporarily pins `openapi-typescript` 6.7.6 because version 7
pulls in Redocly's vulnerable minimatch dependency. Its undici dependency is scoped
to patched 6.29.1; lint's minimatch 10 consumers are scoped to patched 11.0.3.
The generator accepts self-contained OpenAPI JSON with local references only and
checks operation IDs, reference resolution, provenance and generated-type drift.
This is not a replacement for comprehensive API schema validation. Revisit the
generator pin when upstream removes the vulnerable dependency, then revalidate
the generated types and remove overrides no longer needed by their consumers.
