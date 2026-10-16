# Frontend delivery

Local → dev → production, no staging. Independent frontend projects/aliases, server-only example credentials, API origins and deployment credentials per hosted environment. Production is Devnet-only. CI includes disabled-by-default delivery jobs; this local source change does not provision resources, configure secrets or establish hosted acceptance.

Vercel functions in `api/demo` reuse the server-only merchant adapter. Configure `DEMO_ENABLED`, `DEMO_FRONTEND_ORIGIN`, `GATEWAY_ORIGIN`, `DEMO_MERCHANT_API_KEY` and optional `DEMO_WEBHOOK_SECRET` as server runtime values. Never expose them through VITE. The example receiver verifies raw-body HMAC/timestamps but its deduplication is in memory and demonstrates acknowledgment only; real fulfillment needs durable event deduplication.

Before hosted acceptance, verify that the runtime provides the raw request stream without pre-parsing; never verify webhook signatures against reserialized JSON. Add native/edge abuse controls to public amount entry. The backend accepts only configured webhook HTTPS destinations; local HTTP receivers require fixtures or an explicitly approved public tunnel, not disabling webhook security.

Protect main with required quality/browser checks and maintainer diff review; block force push/deletion including administrator bypass. Configure dev/production native environments restricted to main, production explicit approval and no bypass. Disable provider Git auto-deploy. If enforceable approval is unavailable, leave production disabled pending a separately approved alternative.

Select an explicit compatible backend SHA and generated schema hash. Deploy backward-compatible backend first, then frontend. Record exact frontend/backend source revisions, versions, CI results, provider identities, migrations and prior recoverable pair. No cross-repository coordinator or latest-main fallback. Serialize target operations, preserve exact accepted source/lockfile identity, and repeat affected acceptance after dev drift.

Before production: manual localhost acceptance, live controlled dev wallet/verification/webhook acceptance, dependency advisory review, environment readback, monitoring and rollback/isolated restore rehearsal. Production smoke checks are read-only. Restore recorded compatible artifacts, never reverse payment data automatically.

## Shared manually approved production flow

- Merge → existing quality/browser checks on the exact merged source → isolated dev.
  Manual dev redeployment and production dispatch run from main with an exact full
  `sha`. Source ancestry is checked before candidate code executes. Manual source
  selection never silently substitutes latest main. Deployment serializes per target;
  superseded automatic dev runs fail before mutation. Active operations are not cancelled.
- Each GitHub environment has `DEPLOY_ENABLED` (unset/false until authorized),
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `OTHER_VERCEL_PROJECT_ID`, `TARGET_ORIGIN`
  and `VITE_API_ORIGIN` variables, plus its own project-scoped `VERCEL_TOKEN` secret.
  Password-manager label: `crypto-gateway-production-vercel-deploy` (or dev).
  Disable provider Git auto-deploy and competing writers. Production has no
  dev-verification token or additional GitHub PAT. Runtime demo/merchant credentials
  remain separately configured server-only provider secrets; never pass them as VITE values.
- `contract-source.json` must identify the exact published compatible backend SHA,
  not `local`. Delivery compares its canonical OpenAPI hash with that exact backend
  source. Updating provenance is an explicit compatible-source action, not implicit
  pinning or proof that the backend was deployed. Local provenance blocks hosted
  delivery; the committed pin must identify a deliberately selected published source.
- Use Vercel CLI 64.2.0 to deploy the selected checked source with environment-specific
  public build values. Each project's Vercel production slot serves its corresponding
  logical dev/production target, not an extra environment. Retain the
  previous immutable deployment and compatible Worker version before dispatch;
  workflow summaries are supporting records, not a promotion manifest service.
- Accept the exact deployed dev pair and applicable rollback/isolated restore evidence.
  Recheck source/version/provider/configuration and migration identities after
  acceptance and immediately before native production approval. Drift requires
  affected acceptance again. Dispatch both repositories with the same accepted SHAs,
  backend first. Native approval permits self-review, disables admin bypass, and
  restricts execution to main. No custom approval checkbox substitutes for it.
- Production reruns require a new dispatch and approval after diagnosis. The workflow
  does not query dev or prove acceptance. Post-deployment HTTP smoke is read-only and
  not live payment acceptance. An interrupted deployment may already have changed one
  provider; inspect both before retrying. First deployment has no rollback predecessor:
  agree that recovery limitation separately rather than fabricate rehearsal evidence.
- Token revocation, obsolete-secret removal, activation and production provisioning
  remain separate operator actions. Keep existing credentials untouched during alignment.
