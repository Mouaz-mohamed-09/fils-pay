---
description: End-to-end test of the live site (signup, KYC, login, pay, refund)
argument-hint: <admin password>
---
Run `ops/smoke-test.sh https://143-110-242-142.sslip.io https://admin.143-110-242-142.sslip.io admin@filspay.demo '$ARGUMENTS'`.
A failure caused by the simulated acquirer's 502 (about 2% of calls) is not a bug: re-run once.
Report each step's result.
