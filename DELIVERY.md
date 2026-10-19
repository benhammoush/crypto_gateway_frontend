# Frontend delivery

Local → dev → production, no staging. Independent frontend projects/aliases, server-only example credentials, API origins and deployment credentials per hosted environment. Production is Devnet-only. CI includes disabled-by-default delivery jobs; this local source change does not provision resources, configure secrets or establish hosted acceptance.

Vercel functions in `api/demo` reuse the server-only merchant adapter. Configure `DEMO_ENABLED`, `DEMO_FRONTEND_ORIGIN`, `GATEWAY_ORIGIN`, `DEMO_MERCHANT_API_KEY` and optional `DEMO_WEBHOOK_SECRET` as server runtime values. Never expose them through VITE. The example receiver verifies raw-body HMAC/timestamps but its deduplication is in memory and demonstrates acknowledgment only; real fulfillment needs durable event deduplication.

`GET /api/demo/status` is an uncached, read-only UI hint returning only
`data.enabled`, true only when the server's `DEMO_ENABLED` is exactly `true`.
It never returns credentials/configuration values, probes dependencies or creates
payments. The homepage disables Pay and explains disabled mode; while checking or
if the status is inaccessible/malformed, payment entry stays unavailable. This flag
is not a readiness or payment-acceptance attestation. The existing POST payment
endpoint always rechecks server configuration; the UI hint never authorizes it.

Before hosted acceptance, verify that the runtime provides the raw request stream without pre-parsing; never verify webhook signatures against reserialized JSON. Add native/edge abuse controls to public amount entry. The backend accepts only configured webhook HTTPS destinations; local HTTP receivers require fixtures or an explicitly approved public tunnel, not disabling webhook security.

Protect main with required quality/browser checks and maintainer diff review; block force push/deletion including administrator bypass. Configure dev/production native environments restricted to main, production explicit approval and no bypass. Disable provider Git auto-deploy. If enforceable approval is unavailable, leave production disabled pending a separately approved alternative.

Select an explicit compatible backend SHA and generated schema hash. Deploy backward-compatible backend first, then frontend. Record exact frontend/backend source revisions, versions, CI results, provider identities, migrations and any prior recoverable pair. First production uses the approved no-predecessor exception below. No cross-repository coordinator or latest-main fallback. Serialize target operations, preserve exact accepted source/lockfile identity, and repeat affected acceptance after dev drift.

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
  previous immutable deployment and compatible Worker version when available before dispatch;
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
  provider; inspect both before retrying. First production follows the approved
  no-predecessor policy below rather than fabricating recovery evidence.
- Token revocation, obsolete-secret removal, activation and production provisioning
  remain separate operator actions. Keep existing credentials untouched during alignment.

## Read-only dev access verification

After its reviewed source is merged, the separate **Verify dev access (read-only)**
workflow may be manually dispatched from main under separate execution approval.
It uses only the dev environment with deployment tracking disabled and requires
deployment/demo flags to remain unset or false. The existing dev Vercel identities
and `VERCEL_TOKEN` are used for one bounded authenticated GET of that exact project.
No deployment, provider setting change, runtime-secret read, payment, dependency
installation with credentials or automatic retry is performed.

Account/project/name mismatches, competing Git linkage, invalid target identities
and inaccessible provider state fail closed. An absent current target is reported
without claiming empty history or an accepted predecessor. Successful inspection
does not prove least-privilege token scope, absence of other deployment writers,
origin ownership, runtime configuration, deployment capability or hosted-payment
acceptance. Retain the workflow source SHA and sanitized result; subsequent setup,
activation and deployment remain separate approvals. Never enable delivery merely
to run this check.

## Approved first-production policy

Before first production, validate the exact compatible dev pair with controlled
payment/failure acceptance and rehearse dev application rollback. Restore and
revalidate that candidate pair afterward; database recovery rehearsals use only
an isolated non-production copy. Explicitly accept and record that no previous
accepted production pair exists to restore. An initial resource/version or a
successful smoke check is not an accepted rollback baseline.

On failure or uncertain mutation, stop and inspect both providers, D1/schema state
and payment/webhook/Cron effects. Recover only through fresh, separately authorized
exact-SHA dispatches from main with new native production approval for each
affected repository, using an exact dev-accepted compatible pair, backend first
when both change. Repeat affected acceptance after source/configuration/schema
compatibility changes. Never blindly retry, rerun production jobs, bypass approval,
down-migrate/reset D1 or reverse/delete payment data. Webhook replay/data repair
remain separately approved operations.

Retain the first accepted immutable frontend deployment and compatible Worker
version with both source SHAs/versions, configuration/schema identities and
acceptance evidence as the future rollback candidate; reverify compatibility with
current migrations before recovery. The frontend guard permits an absent target
and records `productionBootstrap=true` with `previous=null` before mutation, but
rejects malformed existing target identities or unavailable provider inspection.
This is not proof of empty provider history, dev acceptance or rehearsal; those
remain owner checks before native approval. The backend runbook's
[matching policy](https://github.com/benhammoush/crypto_gateway_backend/blob/main/DELIVERY.md#approved-first-production-policy)
also applies to the pair; each repository retains its own dispatch and approval.

Per-environment `DEPLOY_ENABLED`, native approval, isolation and schema/provenance
guards remain mandatory. This policy does not authorize publication, activation,
provisioning, migrations, deployment, payment execution or data mutation.
Production remains Devnet-only.
