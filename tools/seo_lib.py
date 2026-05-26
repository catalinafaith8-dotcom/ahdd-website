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
