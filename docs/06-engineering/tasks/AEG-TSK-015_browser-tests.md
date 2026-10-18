# AEG-TSK-015 — Browser tests and screenshots

| Field | Value |
|---|---|
| Requirements | AEG-REQ-006, 007, AEG-TST-006, 007 |
| Depends on | TSK-014 |
| Owned paths | `playwright.config.ts`, `tests/browser/*.spec.ts`, `records/screenshots/`, `package.json` (add scripts only: `start:test`) |
| Read | ENG-006 section 7 |
| Gate | `npm run gate -- TSK-015` |

## Steps
1. `npm install -D @playwright/test` then `npm run playwright:install` (installs Chromium; if the download is blocked, STOP and report).
2. `playwright.config.ts`: Chromium only; `webServer` runs `npm run start:test` on port 8799 with env `AEGIS_ENV=local`, `PORT=8799`, `AEGIS_DB_PATH=./data/browser-test.db`, `AEGIS_MODELS_ENABLED=true`, `AEGIS_PROVIDER_MODE=stub`; `reuseExistingServer: false`; `outputDir: 'data/test-results'` and reporter `[['list']]` (so nothing is written outside the already-ignored `data/` folder); delete the test DB in a global setup so each run starts fresh. Add the script `"start:test": "tsx src/api/main.ts"`.
3. Write the eight tests of ENG-006 section 7 as specs using only the listed test ids. Use `page.route` to inspect the chat request. Save screenshots with the names in the list.
4. Gate commands: `npm run build:ui`, `npm run test:browser`.

## Done when
All specs pass headless; three screenshots exist; evidence file written. In the build log state plainly that screenshots and these tests are not an accessibility audit.
