import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// iPhone Safari only exposes the microphone (getUserMedia) in a SECURE context, so the dev
// server defaults to HTTPS.
//   1. Preferred for a real iPhone: a locally trusted certificate made with mkcert, placed in
//      <repo>/certs/dev.pem + dev-key.pem (see README). It is used automatically when present.
//   2. Fallback: a throw-away self-signed certificate (Safari shows a warning; accept it once).
//   3. HTTPS=off: plain http (fine for desktop testing; localhost is a secure context).
const repoRoot = path.resolve(__dirname, '../..');
const certFile = path.join(repoRoot, 'certs/dev.pem');
const keyFile = path.join(repoRoot, 'certs/dev-key.pem');
const hasLocalCert = fs.existsSync(certFile) && fs.existsSync(keyFile);
const useHttps = process.env.HTTPS !== 'off';
// Vite rejects requests whose Host header it does not know (DNS-rebinding protection). IPs and
// localhost always work; the Tailscale MagicDNS names (*.ts.net) are allowed for remote testing
// (README 3c). Add more with ALLOWED_HOSTS=name1,name2 in the shell that starts the dev server.
const allowedHosts = ['.ts.net', ...(process.env.ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? [])];
const apiTarget = `http://127.0.0.1:${process.env.PORT ?? 8787}`;

export default defineConfig({
  plugins: [react(), ...(useHttps && !hasLocalCert ? [basicSsl()] : [])],
  server: {
    host: true, // listen on the LAN so the iPhone can reach it
    port: 5173,
    allowedHosts,
    ...(useHttps && hasLocalCert ? { https: { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) } } : {}),
    proxy: {
      // xfwd: forward the real client address/protocol so the monitor can enforce MONITOR_LOCAL_ONLY
      // and mark its session cookie Secure over HTTPS.
      '/api': { target: apiTarget, changeOrigin: false, xfwd: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, xfwd: true },
    },
  },
});
