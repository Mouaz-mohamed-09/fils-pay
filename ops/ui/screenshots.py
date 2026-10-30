"""Captures screenshots of checkout, the merchant dashboard and the admin
console for before/after UI evidence. Runs in the official Playwright image
on the dev compose network:

  docker run --rm --network ops_default -v "$PWD/ops/ui":/ui \
    -e WEB=http://<web ip>:5173 -e ADMIN=http://<admin ip>:5174 -e API=http://api:3000 \
    -e OUT=/ui/shots/before mcr.microsoft.com/playwright/python:v1.48.0-jammy python /ui/screenshots.py

Uses the dev seed's Alpha Retail owner and super admin.
"""
import json, os, re, urllib.request, uuid
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

WEB, ADMIN, API, OUT = (os.environ[k] for k in ("WEB", "ADMIN", "API", "OUT"))
MERCHANT_ID = os.environ.get("MERCHANT_ID", "9972daab-2c86-459f-9d78-3fe1be4e3280")
MERCHANT_EMAIL = os.environ.get("MERCHANT_EMAIL", "owner@alpharetail.example")
MERCHANT_PASS = os.environ.get("MERCHANT_PASS", "FilsPaySeed!2026")
API_KEY = os.environ.get("API_KEY", "fp_test_jqM1roXMtQN39E7CYuDfFD2CW8p-QrI6")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "superadmin@filspay.test")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "FilsPayAdminSeed!2026")
os.makedirs(OUT, exist_ok=True)


def api(method, path, body=None, headers=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None)
    req.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def fresh_link():
    exp = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    return api("POST", f"/v1/merchants/{MERCHANT_ID}/payment-links",
               {"amountFils": 12750, "expiresAt": exp, "reference": "ORDER-1042", "description": "2x Karak tea, 1x Samosa box"},
               {"authorization": f"Bearer {API_KEY}"})["token"]


def shot(page, name, full=True):
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/{name}.png", full_page=full)
    print("saved", name)


def otp_login(page, fill):
    fill()
    page.get_by_role("button", name=re.compile("continue|sign in|log in", re.I)).first.click()
    page.wait_for_selector("text=/code/i")
    code = re.search(r"\b(\d{6})\b", page.inner_text("body")).group(1)
    page.get_by_label(re.compile("one-time code|code", re.I)).last.fill(code)
    page.get_by_role("button", name=re.compile("verify", re.I)).first.click()
    page.wait_for_load_state("networkidle")


with sync_playwright() as p:
    browser = p.chromium.launch()
    for label, vp in (("desktop", {"width": 1440, "height": 900}), ("mobile", {"width": 390, "height": 844})):
        ctx = browser.new_context(viewport=vp, device_scale_factor=2)
        page = ctx.new_page()

        # Checkout: open, then pay
        page.goto(f"{WEB}/pay/{fresh_link()}"); page.wait_for_load_state("networkidle")
        shot(page, f"{label}-01-checkout")
        if label == "mobile":
            ctx.close(); continue

        # Merchant dashboard
        page.goto(f"{WEB}/dashboard/login"); page.wait_for_load_state("networkidle")
        shot(page, f"{label}-02-merchant-login")
        def fill_merchant():
            page.get_by_label("Merchant ID").fill(MERCHANT_ID)
            page.get_by_label("Email").fill(MERCHANT_EMAIL)
            page.get_by_label("Password").fill(MERCHANT_PASS)
        otp_login(page, fill_merchant)
        for path, name in (("/dashboard/transactions", "03-transactions"), ("/dashboard/payment-links", "05-payment-links"),
                           ("/dashboard/overview", "06-overview"), ("/dashboard/settlement", "07-settlement"),
                           ("/dashboard/reconciliation", "08-reconciliation")):
            page.goto(WEB + path); page.wait_for_load_state("networkidle"); shot(page, f"{label}-{name}")
        page.goto(WEB + "/dashboard/transactions"); page.wait_for_load_state("networkidle")
        link = page.locator("a[href*='/dashboard/transactions/']").first
        if link.count():
            link.click(); page.wait_for_load_state("networkidle"); shot(page, f"{label}-04-transaction-detail")

        # Admin console
        page.goto(f"{ADMIN}/login"); page.wait_for_load_state("networkidle")
        shot(page, f"{label}-09-admin-login")
        def fill_admin():
            page.get_by_label("Email").fill(ADMIN_EMAIL)
            page.get_by_label("Password").fill(ADMIN_PASS)
        otp_login(page, fill_admin)
        page.goto(f"{ADMIN}/merchants"); page.wait_for_load_state("networkidle"); shot(page, f"{label}-10-admin-merchants")
        page.goto(f"{ADMIN}/merchants/{MERCHANT_ID}"); page.wait_for_load_state("networkidle"); shot(page, f"{label}-11-admin-merchant-detail")
        ctx.close()
    browser.close()
