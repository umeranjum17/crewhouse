# Serves the guest's files (the .deb, run.sh) from the current folder and takes the guest's transcript back: PUT /t/<name> -> ./<name>.
import http.server, os, sys

class H(http.server.SimpleHTTPRequestHandler):
    def do_PUT(self):
        name = os.path.basename(self.path)
        with open(os.path.join('/w/got', name), 'wb') as f:
            f.write(self.rfile.read(int(self.headers.get('content-length', 0))))
        self.send_response(204); self.end_headers()
    def log_message(self, *a): pass

os.makedirs('/w/got', exist_ok=True)
http.server.ThreadingHTTPServer(('0.0.0.0', 8123), H).serve_forever()
