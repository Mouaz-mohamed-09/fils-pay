---
description: Deploy main to the live Dilmune server and verify it end to end
---
1. Confirm `git status -sb` is clean and in sync with origin/main.
2. Ask before deploying, then run on the server:
   `ssh -i ~/.ssh/filspay_dilmune dilmune@143.110.242.142 'cd ~/fils-pay && ops/deploy.sh'`
   (it refuses during the 00:00-01:00 Bahrain settlement close).
3. Verify every container is up and healthy, `https://143-110-242-142.sslip.io/healthz`
   returns 200, and `/smoke` passes. Report the deployed commit ID.
