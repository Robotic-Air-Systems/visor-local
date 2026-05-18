#!/usr/bin/env python3
"""Static file server for the local visor workspace.

Tuned for serving lots of binary tile data (WebP) to a single browser
tab without bloating its memory. The previous version used
`SimpleHTTPRequestHandler` defaults: HTTP/1.0 (no keepalive), no
cache headers, no ETags — every fetch became a fresh socket and the
browser had no signal to release decoded image buffers.

What this server does differently
---------------------------------

* **HTTP/1.1 + keepalive.** Browsers reuse 6 sockets across hundreds
  of fetches instead of opening one each. Less concurrent decode
  pressure, less memory pile-up.
* **Per-path `Cache-Control`.** Big HD photos get `no-store`
  (browser doesn't accumulate them); map-overlay tiles get a short
  `max-age` (smooth panning, bounded cache); GeoJSON gets long
  `max-age` (data is static); HTML/JS/CSS gets `no-cache` (dev
  iteration). See `CACHE_RULES`.
* **`Connection: close` on HD photos.** Forces the browser to drop
  the socket after fetching each huge file so the keepalive pool
  doesn't carry ~5 MB buffers around per pooled connection.
* **ETags.** Cheap `(mtime_ns, size)` ETag. Browsers re-requesting an
  already-fetched file get a `304 Not Modified` with zero body —
  no re-decode, no extra memory.
* **Threaded server.** `ThreadingHTTPServer` so a single slow fetch
  doesn't block the rest.
"""
from __future__ import annotations

import argparse
import http.server
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


# Order matters: first match wins. Patterns are regex searched against
# the request `path` (not the on-disk path).
CACHE_RULES: list[tuple[re.Pattern, str, bool]] = [
    # (regex, Cache-Control value, force `Connection: close`)
    (re.compile(r"/data/report_[^/]+/photos_hd/.*\.webp$"),
     "no-store", True),
    (re.compile(r"/data/report_[^/]+/photos/.*\.webp$"),
     "max-age=300", False),
    (re.compile(r"/data/.*\.geojson$"),
     "max-age=3600, immutable", False),
    (re.compile(r"/data/.*\.json$"),
     "max-age=300", False),
    (re.compile(r"(\.(html|js|css)|/)$"),
     "no-cache, must-revalidate", False),
]


def _rule_for(path: str) -> tuple[str | None, bool]:
    for pat, cc, force_close in CACHE_RULES:
        if pat.search(path):
            return cc, force_close
    return None, False


class Handler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 enables keepalive. SimpleHTTPRequestHandler already sends
    # Content-Length correctly so bumping the version is safe.
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ------------------------------------------------------------------
    # Quiet logging
    # ------------------------------------------------------------------

    def log_message(self, fmt, *args):
        try:
            code = int(args[1])
        except (IndexError, ValueError):
            code = 0
        if code >= 400:
            super().log_message(fmt, *args)

    # ------------------------------------------------------------------
    # ETag + 304 fast-path
    # ------------------------------------------------------------------

    @staticmethod
    def _etag_for(fs_path: Path) -> str:
        st = fs_path.stat()
        return f'"{st.st_mtime_ns:x}-{st.st_size:x}"'

    def send_head(self):
        """Add ETag and short-circuit to 304 when If-None-Match matches.
        Otherwise stash the ETag so `end_headers` can emit it on the
        200 response."""
        fs_path = Path(self.translate_path(self.path))
        if fs_path.is_file():
            etag = self._etag_for(fs_path)
            inm = self.headers.get("If-None-Match", "")
            if any(t.strip() == etag for t in inm.split(",")):
                self.send_response(304)
                # Let `end_headers` add Cache-Control/Connection/ETag
                # — calling _send_custom_headers here would duplicate them.
                self._pending_etag = etag
                self.end_headers()
                return None
            self._pending_etag = etag
        return super().send_head()

    # ------------------------------------------------------------------
    # Custom response headers
    # ------------------------------------------------------------------

    def _send_custom_headers(self, etag: str | None = None) -> None:
        cc, force_close = _rule_for(self.path)
        if cc is not None:
            self.send_header("Cache-Control", cc)
        if force_close:
            self.send_header("Connection", "close")
        if etag is not None:
            self.send_header("ETag", etag)

    def end_headers(self):
        self._send_custom_headers(etag=getattr(self, "_pending_etag", None))
        self._pending_etag = None
        super().end_headers()


class ThreadedServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--bind", default="127.0.0.1")
    args = p.parse_args()

    with ThreadedServer((args.bind, args.port), Handler) as srv:
        url = f"http://{args.bind}:{args.port}/"
        print(f"visor-local serving  →  {url}")
        print(f"workspace root       →  {ROOT}")
        print(f"protocol             →  HTTP/1.1 + keepalive + ETag")
        print(f"cache rules          →  {len(CACHE_RULES)} path patterns")
        print("ctrl-c to stop")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")


if __name__ == "__main__":
    main()
