# AEG-TSK-020 — Hosted demo packaging (PHASE 2, BLOCKED)

| Field | Value |
|---|---|
| Status | BLOCKED until the owner provides a cloud project with billing and a spend alert, and approves hosting |
| Requirements | AEG-REQ-016 (stays pending), AEG-UXD-001 |
| Depends on | TSK-014, TSK-018 |
| Owned paths | `Dockerfile`, `.dockerignore`, `deploy/README-deploy.md`, `tests/integration/cloud-config.test.ts` |

## Spec
Multi-stage Docker build (install, `npm run build:ui`, run with `tsx` or compiled output as decided in the file), non-root user, listens on `PORT`, `AEGIS_ENV=cloud`, `AEGIS_STORAGE_MODE=sqlite-ephemeral-demo`, database file in a writable temp path, seed on first start. Deployment documentation for the OWNER lists the exact commands to run (the programmer does not run cloud commands or hold credentials): single instance (max instances 1), secrets passed as environment variables or a secret manager, spend alert. The hosted UI status strip must show `Ephemeral demo storage` and the real model mode. Test: `loadConfig` with a cloud env builds the expected config and refuses `sqlite-local`.
Honest wording to use in the README and UI: "Hosted demo, synthetic data, ephemeral storage, not an operational system." Never claim durability, scale or real incident support.
