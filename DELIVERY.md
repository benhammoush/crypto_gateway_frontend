# Frontend delivery

Local → dev → production, no staging. Independent frontend projects/aliases, server-only example credentials, API origins and deployment credentials per hosted environment. Production is Devnet-only. No deployment workflow or remote resources are provisioned by this local foundation.

Vercel functions in `api/demo` reuse the server-only merchant adapter. Configure `DEMO_ENABLED`, `DEMO_FRONTEND_ORIGIN`, `GATEWAY_ORIGIN`, `DEMO_MERCHANT_API_KEY` and optional `DEMO_WEBHOOK_SECRET` as server runtime values. Never expose them through VITE. The example receiver verifies raw-body HMAC/timestamps but its deduplication is in memory and demonstrates acknowledgment only; real fulfillment needs durable event deduplication.

Before hosted acceptance, verify that the runtime provides the raw request stream without pre-parsing; never verify webhook signatures against reserialized JSON. Add native/edge abuse controls to public amount entry. The backend accepts only configured webhook HTTPS destinations; local HTTP receivers require fixtures or an explicitly approved public tunnel, not disabling webhook security.

Protect main with required quality/browser checks and maintainer diff review; block force push/deletion including administrator bypass. Configure dev/production native environments restricted to main, production explicit approval and no bypass. Disable provider Git auto-deploy. If enforceable approval is unavailable, leave production disabled pending a separately approved alternative.

Select an explicit compatible backend SHA and generated schema hash. Deploy backward-compatible backend first, then frontend. Record exact frontend/backend source revisions, versions, CI results, provider identities, migrations and prior recoverable pair. No cross-repository coordinator or latest-main fallback. Serialize target operations, preserve exact accepted source/lockfile identity, and repeat affected acceptance after dev drift.

Before production: manual localhost acceptance, live controlled dev wallet/verification/webhook acceptance, dependency advisory review, environment readback, monitoring and rollback/isolated restore rehearsal. Production smoke checks are read-only. Restore recorded compatible artifacts, never reverse payment data automatically.
