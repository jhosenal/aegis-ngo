# Aegis hosted demo on Google Cloud Run

> Hosted demo, synthetic data, ephemeral storage, not an operational system.

This is a runbook for the OWNER. The engineer prepared the files only: nothing here has been run, the image has not been built on the build machine (no Docker or gcloud there), and no cloud command has been executed or credentials held. Replace `PROJECT_ID`, `REGION` and `TAG`. Pick one region and keep it for every command (for example one close to your users).

## What you get

| Item | Setting | Why |
|---|---|---|
| Platform | Cloud Run (fully managed), one container | Standard Google Cloud choice for a small stateless web service; scales to zero. |
| Instances | min 0, **max 1** | Storage is a SQLite file in `/tmp`, so a second instance would have a separate, split database and audit chain. |
| Storage | `sqlite-ephemeral-demo`, `/tmp/aegis.db`, seeded at start | Data and the audit chain are lost on every restart or redeploy. Say so; never claim durability. |
| Identity | dedicated service account, no roles except Secret Manager access when secrets are used | Least privilege. |
| Providers | `stub`, models off | Safe default. Live mode is opt-in below. |
| Secrets | Secret Manager, never in the image, the repository or command lines | |
| Image | tagged with the git commit, never `latest` | Reproducible deploys and rollbacks. |

`AEGIS_STORAGE_MODE=sqlite-local` is refused when `AEGIS_ENV=cloud`. REQ-016 (durable cloud persistence) stays **pending**; this demo does not satisfy it. A durable design (for example Cloud SQL) needs its own decision and card.

## 1. One-time project setup

```
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com billingbudgets.googleapis.com
gcloud artifacts repositories create aegis --repository-format=docker --location=REGION
gcloud iam service-accounts create aegis-demo-run --display-name "Aegis demo runtime"
```

## 2. Spend alert (do this before deploying)

Create a budget with alerts at 50, 90 and 100 percent in the Billing console (Billing, Budgets and alerts), or with `gcloud billing budgets create`. Cloud Run, Artifact Registry and Cloud Build are small for this demo, but a budget alert is mandatory before any public URL. If live models are enabled later, also keep the in-app budgets (`AEGIS_BUDGET_*`) small.

A budget alert only notifies: "Setting an alerts-only budget doesn't automatically cap Google Cloud or Google Maps Platform usage or spending" (Google, checked 2026-10-14, see S0014). Where available, also create **spend cap budgets** (Billing, Budgets and caps): they are scoped to one project and one service, and the eligible services are the Gemini API, Gemini Enterprise Agent Platform, Cloud Run and Cloud Run functions. A cap pauses new usage of that service when enforced, is not instant, and does not stop storage or builds (Artifact Registry, Cloud Build and Logging are not eligible). Set one for Cloud Run and one for the Gemini API.

## 3. Build and push the image

```
gcloud builds submit --region REGION --tag REGION-docker.pkg.dev/PROJECT_ID/aegis/aegis-demo:TAG .
```

Use the short git commit as `TAG`. Vulnerability scanning is **billed** (Google lists $0.26 per scan, checked 2026-10-14, see S0014), so every pushed image costs that much while the Container Scanning API is enabled. Check the API status first; enable scanning deliberately before the public release, not for every test push, and read the report before sharing the URL.

## 4. Deploy (stub mode, no secrets)

Edit `deploy/service.yaml` (project, region, tag, service account), then:

```
gcloud run services replace deploy/service.yaml --region REGION
```

By default the service is **private**: callers need an identity token. Check it:

```
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" https://SERVICE_URL/api/health
```

Expect `{"status":"ok","storage":"ephemeral-demo","providerMode":"stub","modelsEnabled":false}`. The UI strip then shows "Ephemeral demo storage" and "Models: disabled".

### 4. Assist is a private preview, not a release

The service file enables the public Assist module as a **private preview** (`AEGIS_ASSIST_ENABLED=true`, `AEGIS_ASSIST_PREVIEW=true`). Every Assist response then says `released: false` and the page shows "Under review. This guidance has not been approved for release. Do not rely on it." The image contains `content/` (the validated card files) and `records/releases/assist-release.json`. While that record is `HELD`, a cloud build **without** preview answers 503 and shows nothing. Do not add `allUsers` (section 5) while the record is `HELD`. Public release needs a recorded review decision (see AEG-PLN-003 section 13 and the review dossier S0013), and any content change cancels the approval.

### 4a. Smoke test the deployed service

```
node tools/smoke-hosted.mjs --url https://SERVICE_URL --id-token "$(gcloud auth print-identity-token)"
```

It signs in as the synthetic demo users and checks health, refusal of missing and forged tokens, tenant isolation, the role rule on the audit endpoint, audit-chain verification, one stub chat, and refusal of the premium mode for an unregistered user. It prints PASS/FAIL per check and never prints a token. Exit code 0 means every check passed. Run it before making the service public (section 5) and again after every redeploy.

On a private service the Google identity token goes in the `X-Serverless-Authorization` header (the script does this), because the app itself uses `Authorization: Bearer <session token>`. A browser cannot send the identity token, so to use the UI while the service is private run `gcloud run services proxy aegis-demo --region REGION` and open the local address it prints.

## 5. Make it public (only after approval)

ENG-005 section 3 requires the audit result and the owner's approval before the public URL is shared. When both exist:

```
gcloud run services add-iam-policy-binding aegis-demo --region REGION --member=allUsers --role=roles/run.invoker
```

To withdraw it, remove the same binding. Public access is open to anyone, so keep max instances at 1 and the budget alert on.

## 6. Optional: live models

Free-tier note: Google may use free-tier content to improve its products, so do not send real tenant data. The demo data is synthetic. Create the secrets without putting the value on a command line or in shell history (paste it into the prompt and finish with Ctrl-D, or use a file outside the repository):

```
gcloud secrets create aegis-google-api-key --replication-policy=automatic
gcloud secrets versions add aegis-google-api-key --data-file=-
gcloud secrets add-iam-policy-binding aegis-google-api-key --member=serviceAccount:aegis-demo-run@PROJECT_ID.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
```

Repeat for `aegis-reapi-api-key` if the backup is used. In `deploy/service.yaml` add, under `env`:

```
- name: AEGIS_GOOGLE_API_KEY
  valueFrom:
    secretKeyRef:
      name: aegis-google-api-key
      key: latest
- name: AEGIS_PROVIDER_MODE
  value: live
- name: AEGIS_MODELS_ENABLED
  value: "true"
```

and set the plain values `AEGIS_GOOGLE_MODEL`, `AEGIS_PRICE_SNAPSHOT_ID`, `AEGIS_PRICE_INPUT_MICRO_PER_MTOK`, `AEGIS_PRICE_OUTPUT_MICRO_PER_MTOK`, `AEGIS_PRICE_CAPTURED_AT`, `AEGIS_PRICE_SOURCE` and the three `AEGIS_BUDGET_*_MICRO` limits (see `docs/06-engineering/AEG-ENG-007_google-adapter-spec.md` for a dated price snapshot). Live mode refuses to start without them. The UI strip then shows "Models: live". The status stays **implemented** until a live call with recorded evidence exists.

## 7. Operate

- Logs: Cloud Logging, filter on the service `aegis-demo`. The app never logs keys or prompts.
- Roll back: redeploy the previous image tag.
- Remove everything: `gcloud run services delete aegis-demo --region REGION`, delete the repository and the secrets.
- What a restart does: the database is recreated and reseeded; pins, assessments and the audit chain from the previous run are gone.

## Honest wording for any page that shows this URL

"Hosted demo, synthetic data, ephemeral storage, not an operational system." Do not claim durability, scale, real incident support, third-party endorsement or a Merkle proof.

## Owner-confirmed model policy and production follow-up, 2026-10-17

- Gemini 3.8 Flash (`gemini-3.8-flash`) is the DEFAULT for all users.
- Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) and Gemini 4 Argon (`gemini-4-argon`) are restricted to Pro OR Admin users. This resolves the earlier Lite access question.
- Apply the same policy to local and live production. SNET owns exact model routing and server-side authorization; Dsol must wire the production runtime configuration and verify it during a later gated deployment.
- Auto routing must respect these permissions: Normal/Public users cannot reach Lite or Argon through Auto, escalation, fallback or direct API requests.
- Production acceptance: Flash is the real default; Normal/Public cannot invoke Lite or Argon; verified Pro and Admin can select either; UI availability agrees with the server; verify actual routed model IDs with secret-free evidence and applicable cost gates.
- Status: REMINDER / PENDING IMPLEMENTATION AND PRODUCTION VERIFICATION. This note does not activate models, call providers or deploy anything.
