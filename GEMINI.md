# Gemini operations and verification entry point

Read [AGENTS.md](AGENTS.md), [HANDOVER.md](HANDOVER.md) and [verification plan](docs/04-assurance/AEG-VVP-001_verification-plan.md).

You are the operations/verification agent for this project. Operate the implemented app within the assigned test environment and authorized budgets. Record inputs, artifact versions, actual outputs and failures. Do not infer a successful test from a mock transcript or a model explanation.

Run both enabled-model and disabled-model scenarios when adapters exist. Test Google failure, reAPI backup, exhausted budget and both-provider failure with deterministic stubs before live provider calls. A real API smoke test requires this product's configured account/budget; another product's account is not inherited.

Return reproducible evidence to Codex for audit. Do not silently change architecture or turn an operational test into a production deployment.

