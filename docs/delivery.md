# Frontend delivery

## Versioned CI/CD entry points

Automation 5.0 separates PR verification, dev delivery and production delivery
with distinct job names, retaining flag-free delivery and weekly vulnerability
audits. The published immutable shared revision is pinned in
`.github/ci-cd.json`; source adoption does not change live settings.

The standalone PR `Verify` result preserves the existing required-check context;
the older check-name migration below is historical. No protection change is
needed for this workflow split. Workflow comments are limited to two header lines;
this runbook and the shared contract own the detail.

The `.github/workflows/weekly-vuln-audit.yml` caller uses the same published shared
SHA as release workflows and runs weekly or manually after adoption on main.
It checks vulnerabilities without updating dependencies or deploying. See the
[shared audit contract](https://github.com/benhammoush/ci-cd-workflows/blob/d1143395dc6a078ef284978c1daf039ed06ff7d1/docs/contract.md#weekly-vulnerability-audits).

### Read-only failed-delivery diagnosis

The `diagnose-dev-delivery.yml` workflow entry point is retired. The retained,
tested `scripts/diagnose-dev-delivery.mjs` CLI requires separate execution approval
and reads one recorded dev deployment using its exact deployment ID and full source
SHA. It uses the existing dev-scoped `VERCEL_TOKEN` for two fixed
provider metadata GETs, then checks the provider-bound deployment URL and fixed
stable dev origin without application credentials or redirect following. Responses
are bounded; summaries contain only selected identities, booleans and HTTP status
codes, never response bodies, tokens or redirect locations. Protection-config
presence alone does not prove a URL requires authentication; inspect its HTTP
result. Source/artifact matches are not full configuration or user acceptance.
The CLI performs no mutations, retries, deployments, payment requests or
configuration changes. It neither requires nor validates `SMOKE_BYPASS`.
It does not acquire a GitHub workflow lock; arrange a stable target before an
authorized inspection. Merging this source still triggers ordinary main CI/dev
delivery; removing the diagnostic workflow does not authorize CLI execution.

The [shared contract](https://github.com/benhammoush/ci-cd-workflows/blob/main/docs/contract.md)
is pinned in `.github/ci-cd.json`. `verify-pr.yml` checks PR creation, updates and
reopening without deployment jobs or secrets. `verify-and-deploy-dev.yml` verifies
main pushes and delivers successful exact main commits to dev without a
deployment-enable switch. Manual `verify-and-deploy-prod.yml` selects a full
merged `sha`, requires retained successful dev evidence, verifies the candidate,
then waits for native approval. Dev-workflow dispatch is the exact-SHA recovery path.
These supersede older combined target-selector invocations, not existing
provenance, isolation, payment no-retry or recovery/acceptance safeguards.

All three entry points, the weekly audit and `.github/ci-cd.json` pin published
shared revision `d1143395dc6a078ef284978c1daf039ed06ff7d1` (automation 5.0).
Publication does not authorize a merge, deployment or production approval.

All Ubuntu jobs use `ubuntu-24.04`. Browser tests exercise built output in Chromium,
Firefox and WebKit. Offline packaging preserves all merchant-demo functions and
their native Node handler, not just static assets. Packaged imports/status are
checked with payments disabled and upstream fetches forbidden. Prebuilt delivery
does not rebuild or expose runtime secrets; helpers stay disabled to preserve raw
request streams. Post-deployment verification checks identity and the public status hint, never payment
creation/submission. Missing production configuration remains a setup blocker.
No remote-setting, credential, compatibility pin, resource or payment state changes
are part of this migration. Historical sources lacking versioned hooks fail
closed; immutable artifact recovery remains separately authorized.

Local → dev → production, no staging. Independent frontend projects/aliases, server-only example credentials, API origins and deployment credentials per hosted environment. Production is Devnet-only. Successful main verification automatically starts dev delivery; production requires manual dispatch and native approval, not a boolean enable flag. This local source change does not provision resources, configure secrets or establish hosted acceptance.

Vercel functions in `api/demo` reuse the server-only merchant adapter. Configure `DEMO_ENABLED`, `DEMO_FRONTEND_ORIGIN`, `GATEWAY_ORIGIN`, `DEMO_MERCHANT_API_KEY` and optional `DEMO_WEBHOOK_SECRET` as server runtime values. Never expose them through VITE. The example receiver verifies raw-body HMAC/timestamps but its deduplication is in memory and demonstrates acknowledgment only; real fulfillment needs durable event deduplication.

`GET /api/demo/status` is an uncached, read-only UI hint returning only
`data.enabled`, true only when the server's `DEMO_ENABLED` is exactly `true`.
It never returns credentials/configuration values, probes dependencies or creates
payments. The homepage disables Pay and explains disabled mode; while checking or
if the status is inaccessible/malformed, payment entry stays unavailable. This flag
is not a readiness or payment-acceptance attestation. The existing POST payment
endpoint always rechecks server configuration; the UI hint never authorizes it.

Function entry points use explicit emitted `.js` import extensions for native Node
ESM resolution; TypeScript resolves those specifiers to their `.ts` source files.
The native-Node regression fixture transpiles all three entry points and their
shared handler without a bundler/TS loader, then checks imports and disabled status
over loopback HTTP. This catches resolution failures hidden by Vitest/tsx but is
not a substitute for read-only verification of the deployed Vercel functions.

Before hosted acceptance, verify that the runtime provides the raw request stream without pre-parsing; never verify webhook signatures against reserialized JSON. Add native/edge abuse controls to public amount entry. The backend accepts only configured webhook HTTPS destinations; local HTTP receivers require fixtures or an explicitly approved public tunnel, not disabling webhook security.

Protect main with strict required `Verify` (GitHub Actions) and `CodeRabbit` checks bound to their respective apps, replacing prior aliases through the coordinated migration. Retain at least one approving review, stale-review dismissal, independent last-push approval and resolved conversations; block force push/deletion including administrator bypass. A successful CodeRabbit status alone is not approval: verify that its integration reviews and approves the current head. Configure dev/production native environments restricted to main, production explicit approval and no bypass. Disable provider Git auto-deploy. If enforceable approval is unavailable, leave production disabled pending a separately approved alternative.

Select an explicit compatible backend SHA and generated schema hash. Deploy backward-compatible backend first, then frontend. Record exact frontend/backend source revisions, versions, CI results, provider identities, migrations and any prior recoverable pair. First production uses the approved no-predecessor exception below. No cross-repository coordinator or latest-main fallback. Serialize target operations, preserve exact accepted source/lockfile identity, and repeat affected acceptance after dev drift.

Before production: manual localhost acceptance, live controlled dev wallet/verification/webhook acceptance, dependency advisory review, environment readback, monitoring and rollback/isolated restore rehearsal. Production post-deployment verification is read-only. Restore recorded compatible artifacts, never reverse payment data automatically.

## Shared manually approved production flow

### Assigned task to manual merge

The owner assigns a bounded task and authorizes its endpoint; no backlog pickup is automatic. The assistant owns implementation, affected checks, authorized PR publication and valid CI/review repairs, including resuming a paused CodeRabbit review. `.coderabbit.yaml` enables real approval after review and prevents author-triggered approval/resolve overrides. The owner decides when to merge after current-head checks and approval pass. No automatic merger, merge PAT or separate orchestration service is required.

An authorized human merge triggers the main-push dev pipeline and hosted post-deployment verification after successful verification, without a deployment-enable flag. Verify exact source/provider identities and affected dev behavior, not just PR CI. Private-dev access and provisioning retain their separate prerequisites; this workflow grants no new credentials. Production uses the exact accepted dev source pair, manual dispatch and native approval as described below.

- Merge → existing quality/browser checks on the exact merged source → isolated dev.
  Manual dev redeployment and production dispatch run from main with an exact full
  `sha`. Source ancestry is checked before candidate code executes. Manual source
  selection never silently substitutes latest main. Deployment serializes per target;
  superseded automatic dev runs fail before mutation. Active operations are not cancelled.
- Neither target uses a deployment-enable flag. Hold production by not dispatching it until authorized. Each environment has
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
  does not query dev or prove acceptance. Post-deployment HTTP verification is read-only and
  not live payment acceptance. An interrupted deployment may already have changed one
  provider; inspect both before retrying. First production follows the approved
  no-predecessor policy below rather than fabricating recovery evidence.
- Token revocation, obsolete-secret removal, activation and production provisioning
  remain separate operator actions. Keep existing credentials untouched during alignment.

## Read-only dev access verification

The old `verify-dev.yml` workflow entry point is retired. Its tested
`scripts/verify-dev.mjs` CLI is retained for separately authorized access checks;
it is not a deployment or a replacement for the separate
`scripts/diagnose-dev-delivery.mjs` CLI. The access-verification CLI requires
deployment/demo flags to remain unset or false. The existing dev Vercel identities
and `VERCEL_TOKEN` are used for one bounded authenticated GET of that exact project.
No deployment, provider setting change, runtime-secret read, payment, dependency
installation with credentials or automatic retry is performed.

Account/project/name mismatches, competing Git linkage, invalid target identities
and inaccessible provider state fail closed. An absent current target is reported
without claiming empty history or an accepted predecessor. Successful inspection
does not prove least-privilege token scope, absence of other deployment writers,
origin ownership, runtime configuration, deployment capability or hosted-payment
acceptance. Retain the CLI source SHA and sanitized result; subsequent setup,
activation and deployment remain separate approvals. Never enable delivery merely
to run this check.

## Approved first-production policy

Before first production, validate the exact compatible dev pair with controlled
payment/failure acceptance and rehearse dev application rollback. Restore and
revalidate that candidate pair afterward; database recovery rehearsals use only
an isolated non-production copy. Explicitly accept and record that no previous
accepted production pair exists to restore. An initial resource/version or a
successful post-deployment verification is not an accepted rollback baseline.

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
[matching policy](https://github.com/benhammoush/crypto_gateway_backend/blob/main/docs/delivery.md#approved-first-production-policy)
also applies to the pair; each repository retains its own dispatch and approval.

Production manual dispatch, native approval, isolation and schema/provenance
guards remain mandatory. This policy does not authorize publication, activation,
provisioning, migrations, deployment, payment execution or data mutation.
Production remains Devnet-only.
