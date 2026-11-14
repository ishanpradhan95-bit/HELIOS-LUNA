"""Best-effort NASA asset fetcher; always leaves deterministic assets available offline."""
from __future__ import annotations
import argparse, urllib.request
from pathlib import Path
def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--url", default="", help="Optional trusted asset URL")
    parser.add_argument("--output", default="data-pipeline/generated/nasa_asset.bin"); args = parser.parse_args()
    if not args.url:
        print("No URL supplied; use generate_default_assets.py for deterministic fallback.")
        return
    target = Path(args.output); target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(args.url, timeout=20) as response: target.write_bytes(response.read())
        print(f"Fetched {target}")
    except Exception as exc:
        print(f"NASA fetch unavailable ({exc}); fallback remains authoritative.")
if __name__ == "__main__": main()
