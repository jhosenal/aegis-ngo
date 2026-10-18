# Security policy

AEGIS is a contest prototype. Only the current development branch is maintained; it is not an operational emergency service.

Report a suspected vulnerability privately using [GitHub private vulnerability reporting](https://github.com/jhosenal/aegis-ngo/security/advisories/new). Include the affected commit, reproduction steps and impact. Do not put credentials, personal information or exploitable details in public issues. Response times are not guaranteed.

Never commit `.env`, OAuth client secrets, service-account keys, judge passwords, databases, runtime logs or the private cost ledger. Use GitHub repository secrets or the operator's secret manager. The browser Maps key is a public client identifier and must have API and HTTP-referrer restrictions; server keys must never reach browser bundles.

Before contributing, run `npm run scan:secrets` and `npm run check:public-files`. These checks reduce exposure risk but do not establish that every vulnerability has been found. If a credential is exposed, revoke or rotate it first; deleting its current file does not remove it from Git history.
