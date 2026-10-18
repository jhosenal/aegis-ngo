# Contributing

Use Node.js 22 or newer and install the pinned dependencies with `npm ci`. Follow the README to build and start the local prototype. Use synthetic fixtures and provider stubs for ordinary development.

Keep changes small and describe their behaviour, validation and limitations. Run the README checks before opening a pull request. Full release checks run with `npm run ci`; a failed or skipped required check cannot be represented as a production seal.

Do not publish local operational history, credentials, databases, recordings, screenshots or private review evidence. `npm run check:public-files` enforces the permitted records paths; `npm run scan:secrets` scans tracked content. The four cost configuration JSON files are permitted, but `records/costs/ledger.jsonl` is private.

Deployment requires separate owner authorization. A source change or passing CI does not authorize cloud spending, IAM changes or a live traffic switch. See [release QC](docs/03-delivery/AEG-SOP-008_release-qc-and-single-file-updates.md).
