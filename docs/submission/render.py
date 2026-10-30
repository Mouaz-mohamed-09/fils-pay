"""Renders the two HTML files to PDF with Chromium. Run in the Playwright image:
docker run --rm -v "$PWD/docs/submission":/w mcr.microsoft.com/playwright/python:v1.48.0-jammy \
  sh -c 'pip install -q playwright==1.48.0; python /w/render.py'"""
import json
from playwright.sync_api import sync_playwright

team = json.load(open("/w/team.json"))["team"]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto("file:///w/submission.html"); pg.wait_for_load_state("networkidle")
    pg.pdf(path=f"/w/{team}_FilsPay_Submission.pdf", format="A4", print_background=True,
           display_header_footer=True, header_template="<span></span>",
           footer_template=f'<div style="font-size:7px;width:100%;text-align:center;color:#888">{team} · FilsPay submission · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
           margin={"top": "14mm", "bottom": "14mm", "left": "12mm", "right": "12mm"})
    pg.goto("file:///w/slides.html"); pg.wait_for_load_state("networkidle")
    pg.pdf(path=f"/w/{team}_FilsPay_Slides.pdf", width="1280px", height="720px", print_background=True)
    b.close()
print("rendered")
