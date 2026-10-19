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

Private dev requires provider-enforced Vercel Authentication on **all** dev project
deployments and Cloudflare Access Service Auth on the dev Worker; source alone does
not enable either. The dev-only proxy allows only checkout status, signature and
bounded read-only preparation RPC routes. It preserves checkout bearer authorization
and never exposes Access service credentials. Runtime secrets and the independent
dev CI bypass/token belong only in their selected provider/GitHub secret stores.
Automation credentials are not end-user authorization and may have wider access than
the smoke paths: scope, expiry and rotation remain operator responsibilities. No
public webhook exception or browser-visible machine token is included. See DELIVERY.md
for fail-closed cutover and the unchanged production boundary.

Manual wallet acceptance, hosted environment protections, strict browser security policy for selected origins, webhook raw-body behavior and recovery remain release prerequisites. Checkout capabilities are bearer secrets; exclude them from analytics/logging and keep the no-referrer policy.
