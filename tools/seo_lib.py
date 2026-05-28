"""
Single source of truth for SEO + booking on the AHDD static site.

Used by:
  - seo-apply.py  (enforces canonical / og:url / book href / NAP across every HTML)
  - seo-check.py  (read-only verifier — non-zero exit if any page drifts)

Why this exists: every HTML file was previously hand-edited per page. That
caused canonical and booking URLs to drift across the site (some pages used
www, some non-www; some had /agoura-hills/ prefixes, some didn't). This
module derives every SEO-sensitive value from tools/site-config.json so
drift is impossible.

To change the booking URL, base host, NAP, or page→slug map: edit
site-config.json then run `npm run seo:apply`.
"""
from __future__ import annotations
import json
import pathlib
import re
from typing import Iterable

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "tools" / "site-config.json"


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


# ── URL builders ─────────────────────────────────────────────────────────

def canonical_url(cfg: dict, slug: str) -> str:
    base = cfg["baseUrl"].rstrip("/")
    if slug == "/":
        return base + "/"
    return base + slug


def og_url(cfg: dict, slug: str) -> str:
    # og:url omits trailing slash even for root (Facebook recommendation)
    base = cfg["baseUrl"].rstrip("/")
    if slug == "/":
        return base
    return base + slug


# ── Edit operations (return new text + a list of changes) ────────────────

CANONICAL_RE = re.compile(r'<link\s+rel=["\']canonical["\']\s+href=["\'][^"\']*["\']\s*/?>')
OG_URL_RE = re.compile(r'<meta\s+property=["\']og:url["\']\s+content=["\'][^"\']*["\']\s*/?>')
CANONICAL_INSERT_ANCHOR = re.compile(r'(<meta\s+name=["\']description["\'][^>]*?>)', re.IGNORECASE)
OG_TITLE_RE = re.compile(r'<meta\s+property=["\']og:title["\'][^>]*?>')

# ── Tracking blocks (idempotently injected by seo-apply) ─────────────────
# Marker comments let us locate and replace blocks safely without regex
# acrobatics on the GTM IIFE. Pattern:
#   <!-- AHDD:TRACK:GTM-HEAD --> ... <!-- /AHDD:TRACK:GTM-HEAD -->
GTM_HEAD_OPEN = "<!-- AHDD:TRACK:GTM-HEAD -->"
GTM_HEAD_CLOSE = "<!-- /AHDD:TRACK:GTM-HEAD -->"
GTM_BODY_OPEN = "<!-- AHDD:TRACK:GTM-BODY -->"
GTM_BODY_CLOSE = "<!-- /AHDD:TRACK:GTM-BODY -->"
ATTR_CFG_OPEN = "<!-- AHDD:TRACK:ATTR-CFG -->"
ATTR_CFG_CLOSE = "<!-- /AHDD:TRACK:ATTR-CFG -->"
ATTR_SCRIPT_OPEN = "<!-- AHDD:TRACK:ATTR-SCRIPT -->"
ATTR_SCRIPT_CLOSE = "<!-- /AHDD:TRACK:ATTR-SCRIPT -->"

_GTM_HEAD_BLOCK_RE = re.compile(
    re.escape(GTM_HEAD_OPEN) + r".*?" + re.escape(GTM_HEAD_CLOSE),
    re.DOTALL,
)
_GTM_BODY_BLOCK_RE = re.compile(
    re.escape(GTM_BODY_OPEN) + r".*?" + re.escape(GTM_BODY_CLOSE),
    re.DOTALL,
)
_ATTR_CFG_BLOCK_RE = re.compile(
    re.escape(ATTR_CFG_OPEN) + r".*?" + re.escape(ATTR_CFG_CLOSE),
    re.DOTALL,
)
_ATTR_SCRIPT_BLOCK_RE = re.compile(
    re.escape(ATTR_SCRIPT_OPEN) + r".*?" + re.escape(ATTR_SCRIPT_CLOSE),
    re.DOTALL,
)
_HEAD_OPEN_RE = re.compile(r"<head([^>]*)>", re.IGNORECASE)
_BODY_OPEN_RE = re.compile(r"<body([^>]*)>", re.IGNORECASE)

# A free-standing GTM snippet already in the file (without our markers) —
# strip it so we own the only copy. The IIFE signature is distinctive.
_STRAY_GTM_HEAD_RE = re.compile(
    r"<!--\s*Google Tag Manager\s*-->\s*<script>\(function\(w,d,s,l,i\).*?End Google Tag Manager\s*-->",
    re.DOTALL | re.IGNORECASE,
)
_STRAY_GTM_BODY_RE = re.compile(
    r"<!--\s*Google Tag Manager \(noscript\)\s*-->\s*<noscript><iframe src=\"https://www\.googletagmanager\.com/ns\.html\?id=[^\"]+\".*?End Google Tag Manager \(noscript\)\s*-->",
    re.DOTALL | re.IGNORECASE,
)


def _gtm_head_block(gtm_id: str) -> str:
    return (
        f'{GTM_HEAD_OPEN}\n'
        '<!-- Google Tag Manager -->\n'
        "<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\n"
        "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\n"
        "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n"
        "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n"
        f"}})(window,document,'script','dataLayer','{gtm_id}');</script>\n"
        '<!-- End Google Tag Manager -->\n'
        f'{GTM_HEAD_CLOSE}'
    )


def _gtm_body_block(gtm_id: str) -> str:
    return (
        f'{GTM_BODY_OPEN}\n'
        '<!-- Google Tag Manager (noscript) -->\n'
        f'<noscript><iframe src="https://www.googletagmanager.com/ns.html?id={gtm_id}"\n'
        'height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n'
        '<!-- End Google Tag Manager (noscript) -->\n'
        f'{GTM_BODY_CLOSE}'
    )


def _attr_cfg_block(track: dict) -> str:
    """Window globals consumed by /assets/attribution.js."""
    return (
        f'{ATTR_CFG_OPEN}\n'
        '<script>\n'
        f'window.AHDD_TRACKING_COOKIE_NAME={json.dumps(track.get("attributionCookieName","ahdd_attribution"))};\n'
        f'window.AHDD_TRACKING_COOKIE_DAYS={int(track.get("attributionCookieDays",90))};\n'
        f'window.AHDD_TRACKING_LEAD_VALUE={float(track.get("leadValueUSD",50))};\n'
        f'window.AHDD_TRACKING_CURRENCY={json.dumps(track.get("currency","USD"))};\n'
        f'window.AHDD_GADS_CONVERSION_ID={json.dumps(track.get("googleAdsConversionId",""))};\n'
        f'window.AHDD_GADS_CONVERSION_LABEL={json.dumps(track.get("googleAdsConversionLabel",""))};\n'
        '</script>\n'
        f'{ATTR_CFG_CLOSE}'
    )


def _attr_script_block(track: dict) -> str:
    href = track.get("attributionScriptHref", "/assets/attribution.js")
    v = track.get("attributionScriptVersion", "1")
    return (
        f'{ATTR_SCRIPT_OPEN}\n'
        f'<script src="{href}?v={v}" defer></script>\n'
        f'{ATTR_SCRIPT_CLOSE}'
    )


def enforce_gtm_head(text: str, gtm_id: str) -> tuple[str, bool]:
    new_block = _gtm_head_block(gtm_id)
    changed = False
    if _GTM_HEAD_BLOCK_RE.search(text):
        new_text = _GTM_HEAD_BLOCK_RE.sub(new_block, text, count=1)
        return new_text, new_text != text
    # Strip any pre-existing unmanaged GTM snippet so we don't duplicate
    text2 = _STRAY_GTM_HEAD_RE.sub("", text)
    if text2 != text:
        changed = True
    m = _HEAD_OPEN_RE.search(text2)
    if m:
        new_text = text2[: m.end()] + "\n" + new_block + text2[m.end():]
        return new_text, True
    return text2, changed


def enforce_gtm_body(text: str, gtm_id: str) -> tuple[str, bool]:
    new_block = _gtm_body_block(gtm_id)
    changed = False
    if _GTM_BODY_BLOCK_RE.search(text):
        new_text = _GTM_BODY_BLOCK_RE.sub(new_block, text, count=1)
        return new_text, new_text != text
    text2 = _STRAY_GTM_BODY_RE.sub("", text)
    if text2 != text:
        changed = True
    m = _BODY_OPEN_RE.search(text2)
    if m:
        new_text = text2[: m.end()] + "\n" + new_block + text2[m.end():]
        return new_text, True
    return text2, changed


def enforce_attribution(text: str, track: dict) -> tuple[str, bool]:
    cfg_block = _attr_cfg_block(track)
    script_block = _attr_script_block(track)
    changed = False

    if _ATTR_CFG_BLOCK_RE.search(text):
        new_text = _ATTR_CFG_BLOCK_RE.sub(cfg_block, text, count=1)
        if new_text != text:
            changed = True
        text = new_text
    else:
        anchor = text.find(GTM_HEAD_CLOSE)
        if anchor != -1:
            insert_at = anchor + len(GTM_HEAD_CLOSE)
            text = text[:insert_at] + "\n" + cfg_block + text[insert_at:]
            changed = True
        else:
            m = _HEAD_OPEN_RE.search(text)
            if m:
                text = text[: m.end()] + "\n" + cfg_block + text[m.end():]
                changed = True

    if _ATTR_SCRIPT_BLOCK_RE.search(text):
        new_text = _ATTR_SCRIPT_BLOCK_RE.sub(script_block, text, count=1)
        if new_text != text:
            changed = True
        text = new_text
    else:
        anchor = text.find(ATTR_CFG_CLOSE)
        if anchor != -1:
            insert_at = anchor + len(ATTR_CFG_CLOSE)
            text = text[:insert_at] + "\n" + script_block + text[insert_at:]
            changed = True
        else:
            m = _HEAD_OPEN_RE.search(text)
            if m:
                text = text[: m.end()] + "\n" + script_block + text[m.end():]
                changed = True

    return text, changed

BOOK_DEAD_HREF_FORWARD_RE = re.compile(
    r'href=(["\'])#\1(\s+[^>]*?onclick=(["\'])doBook\(event\)\3)'
)
BOOK_DEAD_HREF_REVERSE_RE = re.compile(
    r'(onclick=(["\'])doBook\(event\)\2[^>]*?)href=(["\'])#\3'
)


def enforce_canonical(text: str, target: str) -> tuple[str, bool]:
    new_tag = f'<link rel="canonical" href="{target}"/>'
    if CANONICAL_RE.search(text):
        new_text = CANONICAL_RE.sub(new_tag, text, count=1)
        return new_text, new_text != text
    # Missing — insert after meta description
    m = CANONICAL_INSERT_ANCHOR.search(text)
    if m:
        new_text = text[: m.end()] + "\n" + new_tag + text[m.end():]
        return new_text, True
    return text, False  # no description to anchor on; leave untouched


def enforce_og_url(text: str, target: str) -> tuple[str, bool]:
    new_tag = f'<meta property="og:url" content="{target}"/>'
    if OG_URL_RE.search(text):
        new_text = OG_URL_RE.sub(new_tag, text, count=1)
        return new_text, new_text != text
    # Missing — insert after og:title if present, else after canonical
    m = OG_TITLE_RE.search(text)
    if m:
        new_text = text[: m.end()] + "\n" + new_tag + text[m.end():]
        return new_text, True
    # Fall back to inserting after canonical line
    m = CANONICAL_RE.search(text)
    if m:
        new_text = text[: m.end()] + "\n" + new_tag + text[m.end():]
        return new_text, True
    return text, False


def enforce_book_href(text: str, booking_url: str) -> tuple[str, int]:
    replacements = 0
    def fwd(match):
        nonlocal replacements
        replacements += 1
        return f'href="{booking_url}" target="_blank" rel="noopener"' + match.group(2)
    text2 = BOOK_DEAD_HREF_FORWARD_RE.sub(fwd, text)
    def rev(match):
        nonlocal replacements
        replacements += 1
        return match.group(1) + f'href="{booking_url}" target="_blank" rel="noopener"'
    text3 = BOOK_DEAD_HREF_REVERSE_RE.sub(rev, text2)
    return text3, replacements


# ── Inspection helpers (for seo-check.py) ────────────────────────────────

def extract_canonical(text: str) -> str | None:
    m = CANONICAL_RE.search(text)
    if not m:
        return None
    inner = m.group(0)
    hm = re.search(r'href=["\']([^"\']+)["\']', inner)
    return hm.group(1) if hm else None


def extract_og_url(text: str) -> str | None:
    m = OG_URL_RE.search(text)
    if not m:
        return None
    inner = m.group(0)
    cm = re.search(r'content=["\']([^"\']+)["\']', inner)
    return cm.group(1) if cm else None


def count_dead_book_hrefs(text: str) -> int:
    return len(BOOK_DEAD_HREF_FORWARD_RE.findall(text)) + len(BOOK_DEAD_HREF_REVERSE_RE.findall(text))
