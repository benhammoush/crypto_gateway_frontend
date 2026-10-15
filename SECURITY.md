# Security limitations

Devnet demonstration only. Merchant API credentials and webhook signing secrets belong in the server adapter, never browser configuration.

The inherited Solana web3.js v1 dependency currently reports four moderate npm advisories through jayson/stream-json/uuid. No forced major upgrade or transitive override is applied. Compatibility assessment and remediation/explicit risk acceptance are required before public activation. CI blocks high/critical advisories; passing it is not a claim of zero advisories.

The example is not an authenticated merchant dashboard. Origin checks do not prevent bots from calling a public demo. Configure provider-native abuse controls before activation. In-memory webhook acknowledgment is not a fulfillment ledger.

Manual wallet acceptance, hosted environment protections, strict browser security policy for selected origins, webhook raw-body behavior and recovery remain release prerequisites. Checkout capabilities are bearer secrets; exclude them from analytics/logging and keep the no-referrer policy.
