from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import webbrowser

parser = argparse.ArgumentParser(description='Serve HeSuVi Auto Editor on localhost.')
parser.add_argument('--no-browser', action='store_true')
parser.add_argument('--port', type=int, default=0)
args = parser.parse_args()
root = Path(__file__).resolve().parent / 'docs'
class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass
with ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(root))) as server:
    url = 'http://127.0.0.1:%d/' % server.server_port
    print('HeSuVi Auto Editor: ' + url, flush=True)
    print('Keep this window open. Press Ctrl+C to stop.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
