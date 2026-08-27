#!/usr/bin/env python3
"""Serve the trader replay on localhost so browser file:// restrictions cannot break controls."""
from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import threading
import webbrowser

HOST = "127.0.0.1"
PORT = 8765
PAGE = "review_v3.html"


def main() -> None:
    root = Path(__file__).resolve().parent
    os.chdir(root)
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    server = ThreadingHTTPServer((HOST, PORT), handler)
    url = f"http://{HOST}:{PORT}/{PAGE}"
    print(f"MNQ replay lab: {url}")
    print("Keep this window open while reviewing. Press Ctrl+C here when finished.")
    threading.Timer(0.7, lambda: webbrowser.open(url, new=2)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
