#!/usr/bin/env python3
"""
Enforce SEO invariants across every HTML page from tools/site-config.json.

Idempotent — re-running on already-correct HTML is a no-op.

Run:
  npm run seo:apply
"""
from __future__ import annotations
import sys
from seo_lib import (
    ROOT, load_config, canonical_url, og_url,
    enforce_canonical, enforce_og_url, enforce_book_href,
    enforce_gtm_head, enforce_gtm_body, enforce_attribution,
)


def main() -> int:
    cfg = load_config()
    pages = cfg["pages"]
    booking = cfg["bookingUrl"]
    track = cfg.get("tracking") or {}
    gtm_id = track.get("gtmContainerId")
    tracking_enabled = bool(gtm_id)

    print(f"seo:apply — base={cfg['baseUrl']} booking={booking}")
    if tracking_enabled:
        print(f"           tracking gtm={gtm_id} cookie={track.get('attributionCookieName')}")
    else:
        print("           tracking DISABLED (no tracking.gtmContainerId in site-config.json)")
    print()

    total_changed = 0
    for fname, slug in pages.items():
        path = ROOT / fname
        if not path.exists():
            print(f"  WARN  {fname} listed in config but missing on disk")
            continue
        text = path.read_text(encoding="utf-8")
        before = text

        target_canonical = canonical_url(cfg, slug)
        target_og = og_url(cfg, slug)

        text, _ = enforce_canonical(text, target_canonical)
        text, _ = enforce_og_url(text, target_og)
        text, book_fixes = enforce_book_href(text, booking)

        gtm_head_changed = gtm_body_changed = attr_changed = False
        if tracking_enabled:
            text, gtm_head_changed = enforce_gtm_head(text, gtm_id)
            text, gtm_body_changed = enforce_gtm_body(text, gtm_id)
            text, attr_changed = enforce_attribution(text, track)

        if text != before:
            path.write_text(text, encoding="utf-8")
            total_changed += 1
            marks = []
            marks.append(f"canonical={target_canonical}")
            marks.append(f"og:url={target_og}")
            if book_fixes:
                marks.append(f"booking[+{book_fixes}]")
            if gtm_head_changed:
                marks.append("gtm-head")
            if gtm_body_changed:
                marks.append("gtm-body")
            if attr_changed:
                marks.append("attribution")
            print(f"  WROTE   {fname}  ({', '.join(marks)})")
        else:
            print(f"  ok      {fname}")

    print()
    print(f"Files changed: {total_changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
