#!/usr/bin/env python3
"""
Read-only SEO verifier — fails non-zero if any HTML drifts from site-config.

Run before every push (or wire into a pre-deploy hook):
  npm run seo:check
"""
from __future__ import annotations
import sys
from seo_lib import (
    ROOT, load_config, canonical_url, og_url,
    extract_canonical, extract_og_url, count_dead_book_hrefs,
)


def main() -> int:
    cfg = load_config()
    pages = cfg["pages"]
    ignored = set(cfg.get("ignoredPages", []))

    drifts: list[tuple[str, str]] = []
    print(f"seo:check — base={cfg['baseUrl']}")
    print()
    print(f"  {'PAGE':<48} {'CANONICAL':<60} {'OG:URL':<60} {'BOOK#':>5}")
    print(f"  {'-'*48} {'-'*60} {'-'*60} {'-'*5}")
    for fname, slug in pages.items():
        path = ROOT / fname
        if not path.exists():
            drifts.append((fname, "missing on disk"))
            continue
        text = path.read_text(encoding="utf-8")

        expected_can = canonical_url(cfg, slug)
        expected_og = og_url(cfg, slug)

        actual_can = extract_canonical(text) or "(missing)"
        actual_og = extract_og_url(text) or "(missing)"
        book_dead = count_dead_book_hrefs(text)

        status_can = "OK" if actual_can == expected_can else "DRIFT"
        status_og = "OK" if actual_og == expected_og else "DRIFT"
        status_book = "OK" if book_dead == 0 else f"DRIFT({book_dead})"

        line = f"  {fname:<48} {actual_can:<60} {actual_og:<60} {book_dead:>5}"
        print(line)

        if actual_can != expected_can:
            drifts.append((fname, f"canonical: expected {expected_can}, found {actual_can}"))
        if actual_og != expected_og:
            drifts.append((fname, f"og:url: expected {expected_og}, found {actual_og}"))
        if book_dead > 0:
            drifts.append((fname, f"{book_dead} dead Book CTA href=# anchors"))

    # Sanity scan for accidental www. or /agoura-hills/ in any tracked file
    for fname in pages:
        path = ROOT / fname
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if 'www.agourahillsdentaldesigns' in text:
            drifts.append((fname, "contains www.agourahillsdentaldesigns"))
        # /agoura-hills/<service-slug> shouldn't appear in canonical/og/JSON-LD URLs
        # (it's fine in visible NAP text — that's a different match)

    print()
    if drifts:
        print(f"❌ {len(drifts)} drift(s) detected:")
        for fname, msg in drifts:
            print(f"  - {fname}: {msg}")
        print()
        print("Fix: edit tools/site-config.json if the truth has changed,")
        print("then run `npm run seo:apply` to enforce.")
        return 1

    print("✅ all pages match site-config.json — no drift.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
