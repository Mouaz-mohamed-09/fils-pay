"""Builds submission.html and slides.html from team.json + findings.py.
Render to PDF with render.py (Playwright/Chromium)."""
import html, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from findings import F, GROUPS  # noqa: E402

T = json.load(open(os.path.join(HERE, "team.json")))
e = html.escape
BY_ID = {f[0]: f for f in F}
SEV = {"Critical": "crit", "High": "high", "Medium": "med", "Low": "low"}

CSS = """
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; font-size: 9.6pt; line-height: 1.45; color: #1f2430; margin: 0; }
h1 { font-family: "Archivo", Arial, sans-serif; font-size: 26pt; margin: 0 0 4pt; letter-spacing: -0.02em; color: #12151d; }
h2 { font-family: "Archivo", Arial, sans-serif; font-size: 15pt; margin: 0 0 6pt; color: #12151d; border-bottom: 2px solid #12151d; padding-bottom: 3pt; }
h3 { font-size: 11pt; margin: 10pt 0 4pt; color: #12151d; }
p { margin: 0 0 6pt; }
.page { page-break-after: always; }
.eyebrow { color: #a00c24; font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; font-size: 8.4pt; }
th { text-align: left; background: #f2f3f6; font-size: 7.4pt; text-transform: uppercase; letter-spacing: 0.05em; color: #555c6b; }
th, td { border: 1px solid #dcdfe6; padding: 3pt 4.5pt; vertical-align: top; }
td.id { font-family: "IBM Plex Mono", Menlo, monospace; font-weight: 600; color: #a00c24; white-space: nowrap; }
code, .mono { font-family: "IBM Plex Mono", Menlo, monospace; font-size: 0.9em; }
code { background: #f2f3f6; padding: 0 2pt; border-radius: 2pt; }
pre { background: #f6f7f9; border: 1px solid #dcdfe6; padding: 5pt 7pt; font-family: "IBM Plex Mono", Menlo, monospace; font-size: 7.6pt; white-space: pre-wrap; margin: 4pt 0 8pt; }
.pill { font-size: 7pt; font-weight: 700; padding: 0 4pt; border-radius: 6pt; white-space: nowrap; }
.crit { background: #fbe4e2; color: #b3261e; } .high { background: #fdf0db; color: #a35a06; }
.med { background: #e3ebfb; color: #1f4fbf; } .low { background: #eef0f3; color: #646b7a; }
.shots { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt; margin: 4pt 0 10pt; }
.shots figure { margin: 0; } .shots img { width: 100%; border: 1px solid #dcdfe6; max-height: 95mm; object-fit: cover; object-position: top; }
figcaption { font-size: 7.5pt; color: #646b7a; }
.box { border: 1px solid #dcdfe6; border-left: 3px solid #c8102e; padding: 5pt 8pt; margin: 4pt 0 8pt; background: #fbfbfc; }
.arch { font-family: "IBM Plex Mono", Menlo, monospace; font-size: 7.8pt; white-space: pre; background: #f6f7f9; border: 1px solid #dcdfe6; padding: 7pt; }
.cover-meta td:first-child { width: 34%; font-weight: 600; }
.excerpt { border: 1px solid #dcdfe6; padding: 6pt 8pt; margin: 0 0 9pt; }
.excerpt dt { font-weight: 700; font-size: 8pt; color: #555c6b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 3pt; }
.excerpt dd { margin: 0 0 2pt; }
.ai { background: #f3f6fb; border-left: 3px solid #1f4fbf; padding: 3pt 6pt; font-size: 8.4pt; }
.user { background: #fbf3f4; border-left: 3px solid #c8102e; padding: 3pt 6pt; font-size: 8.4pt; }
"""
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap">'


def img(name, cap):
    return f'<figure><img src="img/{name}.jpg"><figcaption>{e(cap)}</figcaption></figure>'


def sev(s):
    return f'<span class="pill {SEV[s]}">{s}</span>'


members = "".join(f"<tr><td>{e(m['name'])}</td><td>{e(m['owned'])}</td></tr>" for m in T["members"])

ARCH = f"""Internet ──HTTPS 443 / HTTP 80 (→308 to HTTPS)──►  gateway  (Caddy, Let's Encrypt)    PUBLIC
                                                    │  serves checkout + dashboard + admin (static)
                                                    │  proxies /v1/* and /healthz
                         private Docker network ────┼───────────────────────────────────────────
                                                    ▼
   api :3000  (Fastify; webhook dispatcher; 0.5 vCPU / 512 MB)   ──►  acquirer simulator (in-process)
     │  └─HTTP :8091 bearer token──►  settlement :8091 (Go daemon, nightly close 00:15 Bahrain)
     ▼                                     │
   postgres :5432 ◄──────────────────────┴──── reporting (outbox consumer)
   (named volume filspay_pgdata; not published)
SSH :22 (key only) for deploys.  Firewall (ufw): only 22, 80, 443 open."""


def findings_table():
    rows = []
    for f in F:
        fid, title, s, sym, found, cause, fix, ver, data = f
        rows.append(f"<tr><td class='id'>{fid}</td><td><b>{e(title)}</b> {sev(s)}<br>{e(sym)}</td>"
                    f"<td>{e(found)}</td><td>{e(cause)}</td><td>{e(fix)}</td><td>{e(ver)}</td><td>{e(data)}</td></tr>")
    return ("<table><thead><tr><th>ID</th><th>Finding / symptom</th><th>Found &amp; reproduced</th><th>Root cause</th>"
            "<th>Fix</th><th>Verified</th><th>Existing data</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


def groups_html():
    out = []
    for name, why, ids in GROUPS:
        out.append(f"<h3>{e(name)}</h3><p>{e(why)} <span class='mono'>{', '.join(ids)}</span></p>")
    return "".join(out)


EXCERPTS = [
 dict(title="1 · The setup file itself was wrong", finding="M9 (CSV 0.475), S7 (guessable tokens), O1 (UTC close)",
  prompt="“read @docs/ARCHITECTURE.md and @docs/HANDOVER.md and give me the steps that need to be applied”",
  context="Claude Code in the repo, with CLAUDE.md auto-loaded (it said money is cents, settlement is UTC, Math.random is fine for link slugs), plus file read and shell tools.",
  answer="“CLAUDE.md is wrong: ADR-0001 says 1 BD = 1000 fils; window.go uses Asia/Bahrain; payment-link tokens are bearer secrets. Correct CLAUDE.md first, or every AI-assisted change will start from wrong rules.”",
  verify="Read ADR-0001, window.go and paymentLinks/create.ts; reproduced the CSV parser turning “4.75” into 475 fils.",
  changed="Corrected CLAUDE.md/AGENTS.md; fixed M9, S7, O1 with new tests."),
 dict(title="2 · Earlier AI answers left in comments were false", finding="M10 (counter overflow), O3 (duplicate payout notices)",
  prompt="“continue with FP-300 and read this and make sure it applies to everything” (with the judging criteria)",
  context="Code comments recorded earlier AI answers: “INTEGER in PostgreSQL is 64-bit on 64-bit builds”, “outbox_events has a unique index on (event_type, aggregate_id)”.",
  answer="Claude flagged both as unverified and checked the schema rather than trusting them.",
  verify="Migration 0049 declares INTEGER (max 2,147,483,647 vs a 2,000,000,000 threshold); no migration creates that unique index.",
  changed="Migrations 0073 (BIGINT) and 0077 (partial unique index) + ON CONFLICT; Go int64."),
 dict(title="3 · The AI was wrong, and tests caught it", finding="R2 (crash mid-payment) and S6",
  prompt="“make sure it applies to everything” → crash test under load; Claude proposed marking a link paid when a capture already committed.",
  context="Full repo, Docker, the locked test suite, and the k6 crash test.",
  answer="Claude's first fix made every retry return 409 already_paid.",
  verify="The test run failed: <code>not ok 304 – idempotent replay after a reservation-timeout retry … expected 200, actual 409</code>. The locked test showed the intended behaviour: the same buyer's same-key retry must get its original payment back.",
  changed="Fix revised to replay 200 for the original key and refuse everyone else; 16/16 payment-link tests pass; re-run crash test: 0 double charges. Other AI mistakes caught the same way: a SQL comment outside a template string, a Docker image that couldn't build, and a document claiming “443 tests” (actually 441)."),
]


def excerpt_html(x):
    return (f"<div class='excerpt'><h3 style='margin-top:0'>{e(x['title'])}</h3><dl>"
            f"<dt>Finding</dt><dd>{e(x['finding'])}</dd>"
            f"<dt>Our prompt</dt><dd class='user'>{e(x['prompt'])}</dd>"
            f"<dt>Context and tools</dt><dd>{e(x['context'])}</dd>"
            f"<dt>AI answer (relevant part)</dt><dd class='ai'>{e(x['answer'])}</dd>"
            f"<dt>How we verified</dt><dd>{x['verify']}</dd>"
            f"<dt>What we changed</dt><dd>{e(x['changed'])}</dd></dl></div>")


SUB = f"""<!doctype html><html><head><meta charset="utf-8"><title>{e(T['team'])}_FilsPay_Submission</title>{FONTS}<style>{CSS}</style></head><body>

<section class="page">
  <p class="eyebrow">The Handover · FilsPay · Submission</p>
  <h1>Team {e(T['team'])}</h1>
  <h3>Team members</h3>
  <table><thead><tr><th>Member</th><th>Owned</th></tr></thead><tbody>{members}</tbody></table>
  <h3>Live URLs</h3>
  <table class="cover-meta"><tbody>
    <tr><td>Checkout</td><td class="mono">{T['site']}/pay/&lt;token&gt; (e.g. {T['site']}/pay/plink_n_vpRxAOJDZ60c5btzyT8M)</td></tr>
    <tr><td>Merchant dashboard</td><td class="mono">{T['site']}/dashboard</td></tr>
    <tr><td>Admin console</td><td class="mono">{T['admin']}</td></tr>
    <tr><td>Public API</td><td class="mono">{T['site']}/v1 · health {T['site']}/healthz</td></tr>
    <tr><td>Server</td><td>Dilmune Cloud, {e(T['server'])}, 1 vCPU / 2 GB</td></tr>
  </tbody></table>
  <h3>Repository</h3>
  <table class="cover-meta"><tbody>
    <tr><td>Public fork</td><td class="mono">{T['fork']}</td></tr>
    <tr><td>Last commit before deadline</td><td class="mono">{e(T['commit'])}</td></tr>
  </tbody></table>
  <p style="color:#646b7a;font-size:8.4pt">Logins for judging (admin, demo merchant) are given separately, not in this public document. Test card 4242 4242 4242 4242, any future date, CVV 123. The one-time code is shown on the login screen (no email/SMS gateway exists; see R8).</p>
</section>

<section class="page">
  <h2>1. Summary</h2>
  <p><b>What we found.</b> 52 defects across money, security, settlement, reporting and UI. Seven were critical: money lost or another merchant reachable (refunding anyone's payment, logging in without the OTP or into another merchant, a payment link charged twice, payouts computed in float32, the balance button wiping a merchant to 7K, and refunded sales still paid out in full).</p>
  <p><b>What we fixed.</b> All 52, each with the smallest change and a new test or reproduction (none of the existing locked tests edited, the audited <code>packages/money</code> untouched). We finished FP-300 (refunds) end to end: API, ledger, cumulative fee reversal, settlement netting, signed webhook, timeline, reports and reconciliation. We deployed on Dilmune Cloud within the 1 vCPU / 2 GB budget, with load shedding, restart on crash and a one-command git deploy.</p>
  <p><b>What we left alone.</b> Five locked tests that assert the bugs finance reported (CSV 0.475, the 245 bps display): fixes kept, tests not edited. The March sweep postings already in production (need finance sign-off to reverse). Real OTP delivery (needs an email/SMS provider).</p>
  <p><b>Main root cause.</b> <i>Safeguards that existed only on paper.</i> ADRs, comments and CLAUDE.md asserted protections the code didn't have: a unique index, a dedupe table, a read-only role, integer money, a safe seed. Several of those claims were earlier AI answers nobody checked. Each one hid a bug that we found by reading the schema, running the system, or load-testing it.</p>
</section>

<section class="page">
  <h2>2. Architecture and deployment</h2>
  <div class="arch">{e(ARCH)}</div>
  <h3>Redeploy: one command</h3>
  <pre>ssh dilmune@143.110.242.142 'cd ~/bhash && ops/deploy.sh'</pre>
  <p><code>ops/deploy.sh</code> does a fast-forward <code>git pull</code> of the public fork, runs migrations (compose <code>migrate</code> service), rebuilds only what changed and restarts it. Infrastructure as code: <code>ops/docker-compose.prod.yml</code>, <code>ops/Dockerfile.*</code>, <code>ops/Caddyfile</code>.</p>
  <h3>Secrets</h3>
  <p><code>ops/.env.prod</code> exists only on the server (mode 600, git-ignored), generated there with <code>openssl rand</code>: Postgres password, webhook encryption key, acquirer callback secret, settlement internal token. The repo holds only <code>ops/.env.prod.example</code>.</p>
  <h3>Health, restarts and settlement safety</h3>
  <table><thead><tr><th>Service</th><th>Health check</th><th>Restart</th><th>Limits</th></tr></thead><tbody>
  <tr><td>gateway</td><td>serves /healthz via api</td><td>unless-stopped</td><td>0.05 vCPU / 96 MB</td></tr>
  <tr><td>api</td><td>GET /readyz every 10 s</td><td>unless-stopped</td><td>0.50 vCPU / 512 MB</td></tr>
  <tr><td>postgres</td><td>pg_isready every 5 s</td><td>unless-stopped</td><td>0.35 vCPU / 640 MB</td></tr>
  <tr><td>settlement</td><td>process supervised</td><td>unless-stopped, 2 min stop grace</td><td>0.05 vCPU / 96 MB</td></tr>
  <tr><td>reporting</td><td>process supervised</td><td>unless-stopped</td><td>0.05 vCPU / 256 MB</td></tr>
  </tbody></table>
  <div class="box"><b>Not interrupting a settlement run.</b> (1) <code>deploy.sh</code> refuses between 00:00 and 01:00 Bahrain time, the close window (override <code>FORCE=1</code>). (2) Settlement gets a 2-minute stop grace period: on SIGTERM the daemon cancels its context and the in-flight batch transaction commits or rolls back. (3) Every batch is one transaction and CloseBatch/PayoutBatch are idempotent, so a cut-short batch is redone on the next tick, never half-applied. (4) Compose recreates only changed services; Postgres is not restarted by a code deploy.</div>
</section>

<section class="page">
  <h2>3. Capacity</h2>
  <div class="box"><b>Estimate: about 10 checkouts/s sustained (≈30 requests/s) with every response correct; ceiling about 16 checkouts/s.</b> Beyond it, excess requests get an immediate 503 and accepted payments stay correct.</div>
  <h3>Our load test</h3>
  <p><b>Tool:</b> k6 0.54 (<code>ops/load/checkout.js</code>). <b>Method:</b> ramping arrival rate, 15 s ramp then 45 s hold; one iteration = merchant creates a payment link → buyer opens it → buyer pays (authorize + capture), run over the internet against the live server. The simulated acquirer keeps its defaults (100–400 ms per call, ~2% failures); its 402/502 answers are counted as correct, not as server errors.</p>
  <table><thead><tr><th>Offered checkouts/s</th><th>Completed/s</th><th>Pay p95</th><th>Correct</th><th>Shed (503)</th></tr></thead><tbody>
  <tr><td>10</td><td>8.7</td><td>1.76 s</td><td>100%</td><td>0</td></tr>
  <tr><td>14</td><td>12.0</td><td>2.86 s</td><td>100%</td><td>0</td></tr>
  <tr><td>20</td><td>16.3</td><td>3.3 s</td><td>100%</td><td>60</td></tr></tbody></table>
  <h3>Bottleneck</h3>
  <p>First the ledger: every checkout did full-table scans (balance trigger on an unindexed column: 27,430 sequential scans, 376 M rows). Indexes (R1) cut pay p95 at 30/s on the tuning machine from 3.35 s to 780 ms. Now: Postgres CPU (it reaches its 0.35 vCPU cap at ~20/s; the API uses ~0.2 of its 0.5) and the connection pool, which each pay holds through two acquirer calls (25 connections / ~0.55 s ≈ 45 pays/s upper bound).</p>
  <h3>Turning away excess and recovering</h3>
  <p>Admission control (<code>plugins/loadShedding.ts</code>): past 64 requests in flight the API answers <code>503 Retry-After: 1</code> at once. Caddy fails fast (2 s) while the API restarts. Crash test: at 60/s we ran <code>kill -9</code> on the API; Docker restarted it within seconds and the audit afterwards found 0 unbalanced ledger groups, 0 paid links without a capture, 0 stuck idempotency keys and 0 double charges (after fixing R2, which the first crash test exposed).</p>
</section>

<section>
  <h2>4. Findings report</h2>
  <p>Severity: Critical = money lost or another merchant reachable; High = wrong money or a control that doesn't hold; Medium = wrong figures or weaker safety; Low = hygiene. Full narrative per finding: <code>docs/AUDIT.md</code>.</p>
  {findings_table()}
  <h3 style="margin-top:10pt">Root causes</h3>
  {groups_html()}
  <h3>Decisions and open risks</h3>
  <table><thead><tr><th>Decision / risk</th><th>Why</th><th>Safeguard we'd propose</th><th>Status</th></tr></thead><tbody>
  <tr><td>Five locked tests assert reported bugs (M8, M9)</td><td>Tests are locked; editing them is not ours to do</td><td>Test owner updates them to the corrected behaviour</td><td>Open</td></tr>
  <tr><td>Did not reverse the March sweep in production (M3)</td><td>Posted to merchant_payable at the wrong date; reversal moves real balances</td><td>Finance sign-off in writing, then a reviewed correcting entry</td><td>Open</td></tr>
  <tr><td>Did not run the destructive seed in production (S15)</td><td>It truncates every table</td><td>Now refuses under NODE_ENV=production</td><td>Done</td></tr>
  <tr><td>OTP shown on screen in the demo (R8)</td><td>No email/SMS gateway exists; otherwise nobody can log in</td><td>Integrate an email/SMS provider; set OTP_DEV_EXPOSE=false</td><td>Open</td></tr>
  <tr><td>Inbound callback freshness window not added (S12)</td><td>A locked test signs with a 2025 timestamp</td><td>Freshness window + raw-body verification; S11 dedupe makes replays harmless meanwhile</td><td>Open</td></tr>
  <tr><td>Did not fix historic data (M1, M4, M5, M9, O2)</td><td>Correcting posted money needs finance review</td><td>Reconciliation queries per finding, then reviewed adjustments</td><td>Open</td></tr>
  <tr><td>Balance rebuild runs synchronously (M6)</td><td>ADR-0004's 30 s timeout on very large ledgers</td><td>Run the ledger walk as a background job</td><td>Open</td></tr>
  </tbody></table>
</section>

<section class="page" style="page-break-before:always">
  <h2>5. UI and UX changes</h2>
  <table><thead><tr><th>Change</th><th>Why it mattered</th></tr></thead><tbody>
  <tr><td>Transaction page no longer crashes on refunds (R9); branded error page</td><td>Every refunded payment showed a developer stack trace: FP-300 was invisible in the UI</td></tr>
  <tr><td>Dashboards can log in from a browser (R3)</td><td>Login was impossible (no CORS); now same-origin</td></tr>
  <tr><td>Refund drawer shipped; one key per attempt (F9)</td><td>Refunds had no UI; a double click would refund twice</td></tr>
  <tr><td>Bare domain goes to sign-in (R10)</td><td>The live link showed “Page not found” on phones</td></tr>
  <tr><td>One design system: status pills, card tables, primary actions, focus rings; dark “OPS” admin header</td><td>Faster scanning; operators always know they are in the admin plane</td></tr>
  <tr><td>Checkout: amount first, autofill hints, designed success/expired/paid states, mobile layout</td><td>Buyers pay on phones; readable receipts instead of raw ISO timestamps</td></tr>
  </tbody></table>
  <div class="shots">
    {img('before-desktop-04-transaction-detail', 'Before: transaction page crashed on a refunded payment')}
    {img('after-desktop-04-transaction-detail', 'After: refunded amount, refund timeline, Refund button')}
    {img('before-desktop-01-checkout', 'Before: checkout')}
    {img('after-desktop-01-checkout', 'After: checkout')}
    {img('before-desktop-03-transactions', 'Before: transactions')}
    {img('after-desktop-03-transactions', 'After: transactions with status pills')}
    {img('before-desktop-10-admin-merchants', 'Before: admin console')}
    {img('after-desktop-10-admin-merchants', 'After: admin console')}
    {img('after-mobile-01-checkout', 'After: phone checkout')}
    {img('live-phone', 'Live site on a phone: bare domain → sign-in (R10)')}
  </div>
  <p>All 24 before/after screenshots: <code>ops/ui/shots/</code>; reproducible with <code>ops/ui/screenshots.py</code>.</p>
</section>

<section class="page">
  <h2>6. AI usage</h2>
  <h3>Setup</h3>
  <table><tbody>
  <tr><td><b>Agent instructions</b></td><td><code>CLAUDE.md</code>, <code>AGENTS.md</code> (corrected: fils not cents, Bahrain not UTC, crypto tokens)</td></tr>
  <tr><td><b>Permission rules</b></td><td><code>ai-setup/claude/settings.json</code>: money package and locked tests not editable, production secrets not readable, force-push denied, push/SSH/deploy always ask</td></tr>
  <tr><td><b>Custom commands</b></td><td><code>ai-setup/claude/commands/</code>: /test-all, /deploy, /smoke, /finding</td></tr>
  <tr><td><b>Helper scripts</b></td><td><code>ops/test-all.sh</code>, <code>ops/smoke-test.sh</code>, <code>ops/deploy.sh</code>, <code>ops/load/</code>, <code>ops/ui/screenshots.py</code>, <code>ops/create-admin.ts</code></td></tr>
  <tr><td><b>Tooling</b></td><td>Claude Code (Opus) with file, shell and Docker access; k6 and Playwright in containers; every claim checked by a test, query or run</td></tr>
  </tbody></table>
  {''.join(excerpt_html(x) for x in EXCERPTS)}
</section>

<section>
  <h2>Appendix</h2>
  <h3>Test output (<code>ops/test-all.sh</code>, each suite on its own database)</h3>
  <pre>apps/api           # pass 374 # fail 5   (the 5 locked tests that assert M8/M9)
apps/reporting     # pass 11  # fail 0
apps/web           # pass 8   # fail 0
packages/money     # pass 40  # fail 0
packages/events    # pass 4   # fail 0
apps/settlement    go vet clean; ok config, internalapi, ledger, money, scheduler, settlement, splits</pre>
  <h3>Live refund netted into settlement (batch 2026-10-29)</h3>
  <pre>capture 4,750 fils at 2.50%  → fee 107
refund  1,000 fils           → fee reversed 107 × 1000/4750 = 22.5 → 23
batch:  gross 3,750   fee 84   net paid 3,666
reconciliation 2026-10-29..30: ledger 3,666 = settled 3,666 + pending 0 → gap 0</pre>
  <h3>Full refund on the live server (10.000 BD in two parts)</h3>
  <pre>capture: gross           card_scheme_clearing debit 10,000 / merchant_payable credit 10,000
capture: MDR fee         merchant_payable debit 250 / platform_fee_revenue credit 250
refund 3,333 + 6,667     merchant_payable debit / card_scheme_clearing credit
fee reversal 83 + 167    platform_fee_revenue debit / merchant_payable credit
merchant payable net after full refund: 0      unbalanced groups: 0</pre>
  <h3>Crash-under-load audit queries (all returned 0)</h3>
  <pre>unbalanced ledger groups · paid links without a captured txn · captured txns missing ledger legs
captured_fils != sum(capture events) · captured txns missing outbox event · links double-charged
idempotency keys stuck in_progress</pre>
  <h3>Ledger scan evidence (R1)</h3>
  <pre>before:  ledger_entries  seq_scan 27,430  seq_tup_read 376,047,484  idx_scan 0
after:   ledger_entries  seq_scan 0       idx_scan 10,068</pre>
</section>
</body></html>"""

open(os.path.join(HERE, "submission.html"), "w").write(SUB)

# ---------------- slides ----------------
SCSS = """
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "IBM Plex Sans", Arial, sans-serif; color: #1f2430; }
.s { width: 1280px; height: 720px; padding: 56px 72px; page-break-after: always; position: relative; overflow: hidden; background: #fff; }
.s.dark { background: #12151d; color: #e7e9ef; }
.k { color: #c8102e; font-size: 15px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; margin: 0 0 10px; }
h1 { font-family: "Archivo", Arial, sans-serif; font-size: 58px; line-height: 1.02; letter-spacing: -0.02em; margin: 0 0 22px; color: #12151d; }
.dark h1 { color: #fff; }
h2 { font-family: "Archivo", Arial, sans-serif; font-size: 40px; margin: 0 0 22px; letter-spacing: -0.015em; color: #12151d; }
.dark h2 { color: #fff; }
p, li { font-size: 21px; line-height: 1.4; }
ul { padding-left: 24px; margin: 0; } li { margin-bottom: 9px; }
table { border-collapse: collapse; width: 100%; font-size: 17px; }
th, td { border-bottom: 1px solid #dcdfe6; padding: 8px 10px; text-align: left; vertical-align: top; }
th { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #646b7a; }
.mono { font-family: "IBM Plex Mono", Menlo, monospace; }
.mark { position: absolute; top: 56px; right: 72px; font-family: "Archivo", Arial; font-weight: 800; font-size: 20px; display: flex; gap: 8px; align-items: center; }
.mark i { width: 20px; height: 20px; background: #c8102e; display: inline-block; border-radius: 3px; }
.dark .mark { color: #fff; }
.big { font-family: "Archivo", Arial; font-size: 30px; line-height: 1.25; color: #12151d; margin: 0 0 20px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.card { border: 1px solid #dcdfe6; border-radius: 10px; padding: 16px 20px; }
.card b { color: #a00c24; }
.shot img { width: 100%; border: 1px solid #dcdfe6; border-radius: 6px; max-height: 470px; object-fit: cover; object-position: top; }
.cap { font-size: 14px; color: #646b7a; }
.foot { position: absolute; bottom: 30px; left: 72px; right: 72px; font-size: 14px; color: #8a90a0; }
.app pre { font-family: "IBM Plex Mono", Menlo, monospace; font-size: 13px; background: #f6f7f9; border: 1px solid #dcdfe6; padding: 12px; white-space: pre-wrap; margin: 0 0 12px; }
"""
mk = '<div class="mark"><i></i>FilsPay</div>'
members_s = "".join(f"<tr><td>{e(m['name'])}</td><td>{e(m['owned'])}</td></tr>" for m in T["members"])
SL = f"""<!doctype html><html><head><meta charset="utf-8"><title>{e(T['team'])}_FilsPay_Slides</title>{FONTS}<style>{SCSS}</style></head><body>
<div class="s dark">{mk}<p class="k">The Handover · FilsPay</p><h1>Team {e(T['team'])}</h1>
<table style="color:#e7e9ef"><tbody>{members_s}</tbody></table>
<p style="margin-top:28px;color:#b7bcc8">52 bugs fixed · refunds shipped end to end · live on Dilmune Cloud</p>
<div class="foot mono">{T['site']} · {T['fork']}</div></div>

<div class="s">{mk}<p class="k">1 · Root cause</p><h2>Safeguards that existed only on paper</h2>
<p class="big">ADRs, comments and CLAUDE.md promised protections the code never had. Several were earlier AI answers nobody checked.</p>
<table><thead><tr><th>Promised</th><th>Reality</th><th>Symptom it explains</th></tr></thead><tbody>
<tr><td>“unique index on outbox events”</td><td>no index</td><td>duplicate payout notices (08-21)</td></tr>
<tr><td>“processed_events dedupes callbacks”</td><td>table doesn't exist</td><td>duplicate notes (FP-201)</td></tr>
<tr><td>“INTEGER is 64-bit”</td><td>32-bit</td><td>volume counter overflow</td></tr>
<tr><td>“impersonation is read-only”</td><td>super_admin = owner</td><td>admins writing as merchants</td></tr>
<tr><td>“money is cents” (CLAUDE.md)</td><td>BD has 3 decimals</td><td>CSV 4.75 BD → 0.475</td></tr></tbody></table></div>

<div class="s">{mk}<p class="k">2 · Key findings, by impact</p><h2>What could lose money</h2>
<div class="row">
<div class="card"><b>Refund anyone's payment, and more than captured</b><br>Lookup by ID only; limit = authorized. Test: other merchant → 404, nothing refunded.</div>
<div class="card"><b>Refunded sales still paid out in full</b><br>Settlement ignored refunds. Now netted: batch 3,750 / 84 / 3,666.</div>
<div class="card"><b>Login without OTP, or into another merchant</b><br>View had no “verified” filter; session by email. Reproduced, fixed, tested.</div>
<div class="card"><b>Link charged twice; crash mid-payment</b><br>Reservations had no owner. kill -9 under load: 0 double charges after the fix.</div>
</div></div>

<div class="s">{mk}<p class="k">3 · Fixes and proof</p><h2>Each fix is structural, and proven</h2>
<table><thead><tr><th>Fix</th><th>Proof</th></tr></thead><tbody>
<tr><td>Row lock across the refund</td><td>3 simultaneous refunds → exactly 1 succeeds</td></tr>
<tr><td>Cumulative fee reversal</td><td>Live: 83 + 167 = 250 = fee charged</td></tr>
<tr><td>Integer fils, single rounding</td><td>4,755 fils → “4.75” in the scheme file (was 4.76)</td></tr>
<tr><td>Indexes on the ledger trigger</td><td>Seq scans 27,430 → 0; p95 3.35 s → 780 ms</td></tr>
<tr><td>Same fee formula as settlement</td><td>Live reconciliation gap: 0 fils</td></tr>
<tr><td>Signed bytes = sent bytes</td><td>Webhook verified against a real receiver</td></tr>
</tbody></table>
<p class="cap" style="margin-top:14px">441 TypeScript tests + 7 Go packages pass; the only 5 failures are locked tests that assert reported bugs.</p></div>

<div class="s">{mk}<p class="k">4 · Live demo: full and partial refund</p><h2>Refunds end to end</h2>
<div class="row"><div class="shot">{'<img src="img/after-desktop-04-transaction-detail.jpg">'}<p class="cap">Partial refunds: refunded amount and timeline in the dashboard</p></div>
<div><table><thead><tr><th>Live 10.000 BD payment</th><th>Fils</th></tr></thead><tbody>
<tr><td>Capture, fee 2.50%</td><td>10,000 / 250</td></tr><tr><td>Partial refund 3.333 BD</td><td>−3,333 (fee −83)</td></tr>
<tr><td>Full remainder 6.667 BD</td><td>−6,667 (fee −167)</td></tr><tr><td>Merchant payable after</td><td><b>0</b></td></tr></tbody></table>
<p style="font-size:17px;margin-top:14px">Settlement report, batch 2026-10-29:<br><span class="mono">gross 3,750 · fee 84 · net 3,666</span></p></div></div></div>

<div class="s">{mk}<p class="k">5 · Under load</p><h2>1 vCPU / 2 GB, live</h2>
<div class="row"><div><p><b>Estimate:</b> ~10 checkouts/s sustained, ~16 ceiling.</p>
<table><thead><tr><th>Offered/s</th><th>Done/s</th><th>p95</th><th>Correct</th></tr></thead><tbody>
<tr><td>10</td><td>8.7</td><td>1.76 s</td><td>100%</td></tr><tr><td>14</td><td>12.0</td><td>2.86 s</td><td>100%</td></tr><tr><td>20</td><td>16.3</td><td>3.3 s</td><td>100%</td></tr></tbody></table></div>
<div><ul><li>Caddy (TLS) → API 0.5 vCPU → Postgres; only 80/443/22 open</li><li>Bottleneck: Postgres CPU, then the pool</li><li>Overload: instant 503 + Retry-After past 64 in flight</li><li>kill -9 under load: auto-restart, 0 double charges</li></ul></div></div></div>

<div class="s">{mk}<p class="k">6 · How we used AI</p><h2>Claude Code, checked by tests</h2>
<p class="big">Setup: CLAUDE.md (corrected) + permission rules + /test-all /deploy /smoke /finding commands.</p>
<div class="card"><b>When it was wrong:</b> its first crash fix made a buyer's retry return 409. The locked test caught it: <span class="mono">not ok 304 … expected 200, actual 409</span>. We changed the fix to replay the original payment for the same key, and the crash test then showed 0 double charges.</div>
<p style="margin-top:18px">Also caught: CLAUDE.md told the AI money was cents and UTC; earlier AI answers in comments (“INTEGER is 64-bit”) were false.</p></div>

<div class="s">{mk}<p class="k">7 · Decisions and open risks</p><h2>What we chose not to change</h2>
<ul><li><b>5 locked tests</b> assert reported bugs: fixes kept, tests not edited</li>
<li><b>March sweep</b> in production: not reversed without finance sign-off</li>
<li><b>OTP on screen</b> in the demo: no email/SMS gateway exists yet</li>
<li><b>Historic data</b> (scheme over-reporting, 10× CSV imports): needs reviewed adjustments</li>
<li><b>Callback freshness window</b>: blocked by a locked test; dedupe makes replays harmless</li></ul></div>

<div class="s app">{mk}<p class="k">Appendix</p><h2>Evidence</h2>
<pre>ops/test-all.sh   api 374 pass / 5 locked-test fails · reporting 11/11 · web 8/8 · money 40/40 · events 4/4 · Go 7/7 packages
R1 ledger scans   before seq_scan 27,430 (376M rows) · after 0 (idx_scan 10,068)
Crash audit       unbalanced groups 0 · paid links w/o capture 0 · stuck keys 0 · double charges 0
Reconciliation    2026-10-29..30: ledger 3,666 = settled 3,666 + pending 0 → gap 0</pre>
<div class="row"><div class="shot"><img src="img/before-desktop-01-checkout.jpg" style="max-height:250px"><p class="cap">Checkout before</p></div>
<div class="shot"><img src="img/after-desktop-01-checkout.jpg" style="max-height:250px"><p class="cap">Checkout after</p></div></div>
<p class="cap">Full findings: docs/AUDIT.md · capacity: docs/CAPACITY.md · UI: docs/UI_EVIDENCE.md · repo {T['fork']}</p></div>
</body></html>"""
open(os.path.join(HERE, "slides.html"), "w").write(SL)
print("built submission.html and slides.html")
