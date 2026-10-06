#!/usr/bin/env python3
"""Static preview server that behaves like GitHub Pages for measurements:
threaded, gzip for text types, long cache headers off. Usage: serve.py [port] [dir]"""
import gzip
import http.server
import io
import os
import sys

TEXT = ('.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.map')


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        ext = os.path.splitext(path)[1].lower()
        if ext in TEXT and 'gzip' in self.headers.get('Accept-Encoding', '') and os.path.isfile(path):
            with open(path, 'rb') as f:
                raw = f.read()
            body = gzip.compress(raw, 6)
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        return super().send_head()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    root = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    os.chdir(root)
    Handler.extensions_map.update({'.webp': 'image/webp', '.woff2': 'font/woff2', '.js': 'text/javascript'})
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
