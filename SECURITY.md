# Security limitations

Devnet demonstration only. Merchant API credentials and webhook signing secrets belong in the server adapter, never browser configuration.

The frontend uses pinned Solana web3.js 3.1.0, removing the inherited v1 jayson/stream-json/uuid advisory chain without transitive overrides. Phantom's direct submission API receives a synchronous-serializing `VersionedTransaction` wrapping a legacy message, preserving the legacy wire format without an asynchronous serializer or automatic fallback. Automated message/RPC/browser checks do not replace real Phantom Devnet acceptance. Run a fresh dependency audit before activation; CI blocks high/critical advisories, and passing it is not a claim of zero advisories.

The example is not an authenticated merchant dashboard. Origin checks do not prevent bots from calling a public demo. Configure provider-native abuse controls before activation. In-memory webhook acknowledgment is not a fulfillment ledger.

Manual wallet acceptance, hosted environment protections, strict browser security policy for selected origins, webhook raw-body behavior and recovery remain release prerequisites. Checkout capabilities are bearer secrets; exclude them from analytics/logging and keep the no-referrer policy.
