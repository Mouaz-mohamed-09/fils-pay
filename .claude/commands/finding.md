---
description: Investigate a suspected bug and record it as a finding in docs/AUDIT.md
argument-hint: <symptom>
---
Symptom: $ARGUMENTS

1. Map before touching: the code path, the data it reads, and any ADR in docs/adr/.
   Treat code comments that claim a fact (an index exists, a column is 64-bit) as
   unverified until the schema or a run confirms it.
2. Reproduce it with a test, a query or a request, and show the output.
3. Make the smallest fix. Do not modify packages/money or existing tests.
4. Add a `*.new.test.ts` / `*_new_test.go` that fails before and passes after; run `/test-all`.
5. Append to docs/AUDIT.md: symptom, how found and reproduced, root cause, fix,
   verification, effect on existing data.
