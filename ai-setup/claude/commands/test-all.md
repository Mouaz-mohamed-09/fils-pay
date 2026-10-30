---
description: Run every test suite, each on its own fresh database, and report results
---
Run `ops/test-all.sh` and report passed/failed counts per suite.

Known: 5 locked API tests assert bugs finance reported (docs/AUDIT.md, "Test status").
Any other failure is a regression: show the failing test, expected and actual values,
and the change that caused it. Never edit an existing `*.test.ts` or `*_test.go`;
add a `*.new.test.ts` / `*_new_test.go` instead.
