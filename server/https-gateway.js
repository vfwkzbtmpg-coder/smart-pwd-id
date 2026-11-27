/**
 * Smart PWD ID — HTTPS gateway
 *
 * This is the piece that makes  https://smartpwdgov.duckdns.org  work.
 * It is a small reverse proxy that sits in front of the existing Express
 * server and does exactly four jobs:
 *
 *   port 80   — answers Let's Encrypt's HTTP-01 validation challenge, and
 *               redirects every other request to HTTPS
 *   port 443  — terminates TLS with the Let's Encrypt certificate and
 *               forwards the request to the Express server on port 3000
 *
 * The existing server.js is NOT modified: this only forwards to it, so
 * nothing that already works can break.
 *
 * Why not Caddy / nginx / IIS?
 *   This PC has Smart App Control enforced. It refuses to run unsigned
 *   executables, and the official Caddy Windows build is unsigned. Node
 *   itself is signed and already installed, so the gateway is written in
 *   Node instead. Fewer moving parts, and no extra program to install.
 *
 * Configuration (all optional, defaults shown):
 *   HTTPS_DOMAIN     smartpwdgov.duckdns.org
 *   UPSTREAM_HOST    ::1
 *   UPSTREAM_PORT    3000
 *   HTTP_PORT        80
 *   HTTPS_PORT       443
 *   SMART_PWD_DATA_DIR  C:\ProgramData\SmartPWDID
 *
 * Run directly:   node server/https-gateway.js
 * (normally started by the SmartPWDID-HTTPS scheduled task)
 */
'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

// ------------------------------ configuration ------------------------------
const DOMAIN = process.env.HTTPS_DOMAIN || 'smartpwdgov.duckdns.org';
// Deliberately the IPv6 loopback "::1" and not "127.0.0.1".
// The Express server binds to "::" (all interfaces), which covers both
// loopbacks. Editors such as VS Code and Trae also grab the more specific
// 127.0.0.1:3000 for their own port preview, and Windows then prefers that
// binding for IPv4 - so a request to 127.0.0.1:3000 reaches the editor and
// comes back 401, not the website. "::1" always lands on the real server.
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || '::1';
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 3000);
const HTTP_PORT = Number(process.env.HTTP_PORT || 80);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);

const DATA_DIR = process.env.SMART_PWD_DATA_DIR || 'C:\\ProgramData\\SmartPWDID';
const CERT_DIR = path.join(DATA_DIR, 'certs');
const CHALLENGE_DIR = path.join(DATA_DIR, 'acme-webroot', '.well-known', 'acme-challenge');

const CHALLENGE_PREFIX = '/.well-known/acme-challenge/';
const CERT_KEY_FILE = path.join(CERT_DIR, 'privkey.pem');
const CERT_CHAIN_FILE = path.join(CERT_DIR, 'fullchain.pem');

for (const dir of [CERT_DIR, CHALLENGE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function log(level, message) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`${stamp}  ${level.padEnd(5)} ${message}`);
}

// ------------------------------- certificates ------------------------------
// Held in memory and re-read when the files change, so a renewal by
// issue-cert.js takes effect with no restart and no downtime.
let tlsMaterial = null;

function readCertFiles() {
  if (!fs.existsSync(CERT_KEY_FILE) || !fs.existsSync(CERT_CHAIN_FILE)) return null;
  try {
    return { key: fs.readFileSync(CERT_KEY_FILE), cert: fs.readFileSync(CERT_CHAIN_FILE) };
  } catch (err) {
    log('ERROR', `could not read certificate files: ${err.message}`);
    return null;
  }
}

function certFileMtime() {
  try {
    return Math.max(fs.statSync(CERT_KEY_FILE).mtimeMs, fs.statSync(CERT_CHAIN_FILE).mtimeMs);
  } catch {
    return 0;
  }
}

// ------------------------------ reverse proxy ------------------------------
// Hop-by-hop headers must not be forwarded; everything else is passed through
// so the Express server sees exactly what the browser sent.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function proxyToUpstream(req, res) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
  }
  // Tell the app how the visitor really arrived, so any absolute URL it builds
  // uses https:// and the public domain instead of localhost.
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-host'] = headers.host || DOMAIN;
  headers['x-forwarded-for'] = req.socket.remoteAddress || '';
  headers['x-forwarded-port'] = String(HTTPS_PORT);

  const upstream = http.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: req.method, path: req.url, headers },
    (upstreamRes) => {
      const outHeaders = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (!HOP_BY_HOP.has(name.toLowerCase())) outHeaders[name] = value;
      }
      res.writeHead(upstreamRes.statusCode || 502, outHeaders);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    log('ERROR', `upstream ${UPSTREAM_HOST}:${UPSTREAM_PORT} failed: ${err.message}`);
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      '<h1>Smart PWD ID is starting up</h1>' +
      '<p>The web server on port ' + UPSTREAM_PORT + ' is not answering yet. ' +
      'Reload in a few seconds.</p>'
    );
  });

  req.pipe(upstream);
}

// --------------------------- port 80 (http://) -----------------------------
function handleHttp(req, res) {
  const urlPath = (req.url || '/').split('?')[0];

  // 1. Let's Encrypt validation. This must keep working forever, because
  //    certificates are renewed every ~60 days using the same challenge.
  if (urlPath.startsWith(CHALLENGE_PREFIX)) {
    const token = decodeURIComponent(urlPath.slice(CHALLENGE_PREFIX.length));
    // Only a bare filename: blocks ../ escapes out of the challenge folder.
    if (token.includes('/') || token.includes('\\') || token.includes('..')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    const file = path.join(CHALLENGE_DIR, token);
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(fs.readFileSync(file));
  }

  // 2. Everything else is sent to the secure address. The redirect target is
  //    built from the configured domain, never from the Host header, so this
  //    cannot be abused as an open redirect.
  const target = `https://${DOMAIN}${req.url || '/'}`;
  res.writeHead(301, { location: target });
  res.end();
}

const httpServer = http.createServer(handleHttp);

// -------------------------- port 443 (https://) ----------------------------
let httpsServer = null;

function startHttps() {
  if (httpsServer || !tlsMaterial) return;

  httpsServer = https.createServer(
    {
      key: tlsMaterial.key,
      cert: tlsMaterial.cert,
      minVersion: 'TLSv1.2',
      SNICallback: (servername, cb) => {
        const material = tlsMaterial || readCertFiles();
        if (!material) return cb(new Error('no certificate available'));
        cb(null, tls.createSecureContext({ key: material.key, cert: material.cert }));
      },
    },
    proxyToUpstream
  );

  httpsServer.on('error', (err) => log('ERROR', `https server error: ${err.message}`));
  httpsServer.listen(HTTPS_PORT, () => {
    log('INFO', `https listening on port ${HTTPS_PORT} for ${DOMAIN}`);
  });
}

// ------------------------------- start up ---------------------------------
log('INFO', `gateway starting — ${DOMAIN} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);

tlsMaterial = readCertFiles();
if (tlsMaterial) {
  startHttps();
} else {
  log('WARN', `no certificate in ${CERT_DIR} yet — running http only`);
  log('WARN', 'run  node server/issue-cert.js  to request one; this process');
  log('WARN', 'picks it up automatically within 30 seconds, no restart needed');
}

httpServer.on('error', (err) => {
  log('ERROR', `http server error: ${err.message}`);
  if (err.code === 'EACCES') log('ERROR', `port ${HTTP_PORT} needs Administrator rights`);
});

httpServer.listen(HTTP_PORT, () => {
  log('INFO', `http listening on port ${HTTP_PORT} (redirect to https + ACME challenges)`);
});

// Watch for a new certificate: either the first one being issued, or a renewal.
let seenMtime = certFileMtime();
setInterval(() => {
  const current = certFileMtime();
  if (current === 0 || current === seenMtime) return;
  seenMtime = current;
  const fresh = readCertFiles();
  if (!fresh) return;
  tlsMaterial = fresh;
  log('INFO', 'certificate (re)loaded from disk');
  startHttps();
}, 30000);

// A gateway that dies quietly is worse than one that shouts: the scheduled
// task is configured to restart this process, so exiting on a hard error is
// the correct behaviour.
process.on('uncaughtException', (err) => {
  log('ERROR', `uncaught exception: ${err.stack || err.message}`);
  process.exit(1);
});
