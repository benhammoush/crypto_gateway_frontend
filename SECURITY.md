# Security limitations

Devnet demonstration only. Merchant API credentials and webhook signing secrets belong in the server adapter, never browser configuration.

Browser environment exposure is explicitly limited to `VITE_APP_ENV` and
`VITE_API_ORIGIN`, not the entire `VITE_` prefix. The build guard tolerates only the
exact provider-injected `VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG` metadata key in
addition to those application inputs; its value is not validated, trusted or exposed
to the browser. All other unexpected `VITE_*` keys still fail the build. Do not add
merchant/provider secrets to public inputs or broaden this exception to a prefix.

The frontend uses pinned Solana web3.js 3.1.0, removing the inherited v1 jayson/stream-json/uuid advisory chain without transitive overrides. Phantom's direct submission API receives a synchronous-serializing `VersionedTransaction` wrapping a legacy message, preserving the legacy wire format without an asynchronous serializer or automatic fallback. Automated message/RPC/browser checks do not replace real Phantom Devnet acceptance. Run a fresh dependency audit before activation; CI blocks high/critical advisories, and passing it is not a claim of zero advisories.

The example is not an authenticated merchant dashboard. Origin checks do not prevent bots from calling a public demo. Configure provider-native abuse controls before activation. In-memory webhook acknowledgment is not a fulfillment ledger.

Payment-creation failures may display a fixed, allowlisted gateway error code and
a validated UUID v4 request ID for support correlation. The adapter never forwards
upstream messages, URLs or arbitrary response fields. Unknown/malformed errors
keep the generic fallback; diagnostics do not prove whether a payment was created
and do not trigger an automatic retry.

Manual wallet acceptance, hosted environment protections, strict browser security policy for selected origins, webhook raw-body behavior and recovery remain release prerequisites. Checkout capabilities are bearer secrets; exclude them from analytics/logging and keep the no-referrer policy.
