/**
 * Smart PWD ID — obtain (or renew) the Let's Encrypt certificate
 *
 *   node server/issue-cert.js              # real certificate
 *   node server/issue-cert.js --staging    # test certificate, no rate limits
 *   node server/issue-cert.js --force      # renew even if the current one is fine
 *
 * A scheduled task runs this once a week. If the certificate on disk still
 * has more than ACME_RENEW_WITHIN_DAYS (default 30) days left, nothing is
 * requested - Let's Encrypt only allows a small number of duplicate
 * certificates per week, so renewing on every run would be a mistake.
 *
 * How it works — the HTTP-01 challenge:
 *   1. Let's Encrypt asks for a random file at
 *        http://smartpwdgov.duckdns.org/.well-known/acme-challenge/<token>
 *   2. This script writes that file into
 *        C:\ProgramData\SmartPWDID\acme-webroot\.well-known\acme-challenge\
 *   3. The HTTPS gateway (https-gateway.js) is already serving that folder
 *      on port 80, so Let's Encrypt can read it
 *   4. Let's Encrypt hands back a certificate, which is saved as
 *        C:\ProgramData\SmartPWDID\certs\fullchain.pem
 *        C:\ProgramData\SmartPWDID\certs\privkey.pem
 *      The gateway notices the new files within 30 seconds and starts
 *      serving HTTPS — no restart of anything.
 *
 * Run the gateway first. Issuing a certificate while nothing is listening on
 * port 80 cannot work, and the script says so instead of failing cryptically.
 *
 * Environment (all optional):
 *   HTTPS_DOMAIN      smartpwdgov.duckdns.org
 *   ACME_EMAIL        admin@smartpwdgov.duckdns.org
 *   SMART_PWD_DATA_DIR  C:\ProgramData\SmartPWDID
 */
'use strict';

const acme = require('acme-client');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const dns = require('dns').promises;
const os = require('os');
const fs = require('fs');
const path = require('path');

const DOMAIN = process.env.HTTPS_DOMAIN || 'smartpwdgov.duckdns.org';
const EMAIL = process.env.ACME_EMAIL || `admin@${DOMAIN}`;
const USE_STAGING = process.argv.includes('--staging');
const FORCE = process.argv.includes('--force');
const RENEW_WITHIN_DAYS = Number(process.env.ACME_RENEW_WITHIN_DAYS || 30);

const DATA_DIR = process.env.SMART_PWD_DATA_DIR || 'C:\\ProgramData\\SmartPWDID';
const CERT_DIR = path.join(DATA_DIR, 'certs');
const CHALLENGE_DIR = path.join(DATA_DIR, 'acme-webroot', '.well-known', 'acme-challenge');
const ACCOUNT_KEY_FILE = path.join(CERT_DIR, 'account.key');
const CERT_KEY_FILE = path.join(CERT_DIR, 'privkey.pem');
const CERT_CHAIN_FILE = path.join(CERT_DIR, 'fullchain.pem');

for (const dir of [CERT_DIR, CHALLENGE_DIR]) fs.mkdirSync(dir, { recursive: true });

function log(level, message) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`${stamp}  ${level.padEnd(5)} ${message}`);
}

function localIpv6Addresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list || []) {
      if (entry.family !== 'IPv6') continue;
      const address = entry.address.split('%')[0];
      if (address === '::1' || address.startsWith('fe80') || address.startsWith('fd')) continue;
      found.push(address);
    }
  }
  return found;
}

/**
 * How many days the certificate already on disk has left, or null if there
 * is none / it cannot be read. The weekly renewal task uses this to decide
 * whether there is anything to do.
 */
function existingCertDaysLeft() {
  try {
    const x509 = new crypto.X509Certificate(fs.readFileSync(CERT_CHAIN_FILE));
    const expiry = new Date(x509.validTo).getTime();
    if (Number.isNaN(expiry)) return null;
    return Math.floor((expiry - Date.now()) / 86400000);
  } catch {
    return null;
  }
}

/**
 * acme-client normally checks the challenge itself by fetching
 * http://smartpwdgov.duckdns.org/... That request would leave this PC through
 * the ISP's CGNAT and may never come back, so the self-check is switched off
 * and replaced with a direct request to this machine's own IPv6 address.
 */
function fetchChallengeOverIpv6(address, token) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: address,
        family: 6,
        port: 80,
        path: `/.well-known/acme-challenge/${token}`,
        headers: { host: DOMAIN },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: body.trim() }));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timed out' }); });
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
  });
}

// ------------------------------ pre-flight --------------------------------
/**
 * Look the domain up the way Windows itself would.
 *
 * dns.resolve6()/resolve4() send a DNS query straight to the servers named in
 * Windows' network settings. On this PC that is a local stub listening on
 * 127.0.0.1 that answers nothing, so those calls fail with ECONNREFUSED and
 * the script wrongly reports "no AAAA record" while every browser resolves
 * the name perfectly well. dns.lookup() goes through the normal Windows
 * resolver instead - the same path a visitor's browser takes - so it is both
 * more accurate and more reliable here.
 */
async function resolveAddresses() {
  const found = { IPv6: [], IPv4: [] };

  try {
    for (const record of await dns.lookup(DOMAIN, { all: true })) {
      const bucket = record.family === 6 ? found.IPv6 : found.IPv4;
      if (!bucket.includes(record.address)) bucket.push(record.address);
    }
  } catch { }

  // Fall back to a direct query, in case the OS resolver is the broken one.
  if (!found.IPv6.length) { try { found.IPv6 = await dns.resolve6(DOMAIN); } catch { } }
  if (!found.IPv4.length) { try { found.IPv4 = await dns.resolve4(DOMAIN); } catch { } }

  return found;
}

async function preflight() {
  log('INFO', `domain      : ${DOMAIN}`);
  log('INFO', `contact     : ${EMAIL}`);
  log('INFO', `certificate : ${USE_STAGING ? 'STAGING (test, not trusted by browsers)' : 'PRODUCTION'}`);
  log('INFO', `cert folder : ${CERT_DIR}`);

  // 1. DNS
  const { IPv6: aaaa, IPv4: a } = await resolveAddresses();

  if (aaaa.length) log('INFO', `AAAA record : ${aaaa.join(', ')}`);
  else log('WARN', `no AAAA record for ${DOMAIN} — IPv6 visitors cannot reach this PC`);
  if (a.length) log('INFO', `A record    : ${a.join(', ')} (CGNAT, inbound IPv4 does not work)`);

  const local = localIpv6Addresses();
  log('INFO', `this PC     : ${local.join(', ') || 'no global IPv6 address'}`);

  const matched = aaaa.find((record) => local.includes(record));
  if (!matched) {
    log('ERROR', 'The AAAA record does not point at any IPv6 address of this PC.');
    log('ERROR', 'Let\'s Encrypt would look for the challenge on the wrong machine.');
    log('ERROR', 'Fix this first: duckdns.org must show the address listed under "this PC" above.');
    if (local.length) log('ERROR', `Suggested AAAA value: ${local[0]}`);
    return false;
  }
  log('INFO', `AAAA match  : ${matched} is an address of this PC — good`);

  // 2. Is the gateway up on port 80?
  const listening = await new Promise((resolve) => {
    const req = http.get(
      { hostname: matched, family: 6, port: 80, path: '/', timeout: 8000 },
      (res) => { res.resume(); resolve(true); }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
  // A 301 answer still counts as "listening", so errors are what matter here.
  if (!listening) {
    log('ERROR', 'Nothing answered on port 80 of this PC.');
    log('ERROR', 'Start the gateway first:   node server/https-gateway.js');
    log('ERROR', 'It must be running before a certificate can be requested.');
    return false;
  }
  log('INFO', 'port 80     : gateway is answering');

  return true;
}

// -------------------------------- the flow --------------------------------
async function main() {
  // Nothing to do unless the certificate is missing or nearly expired. This
  // is what makes the weekly scheduled task safe to leave running.
  if (!FORCE) {
    const daysLeft = existingCertDaysLeft();
    if (daysLeft !== null && daysLeft > RENEW_WITHIN_DAYS) {
      log('INFO', `the certificate is valid for ${daysLeft} more days - nothing to do`);
      log('INFO', `renewal happens by itself once fewer than ${RENEW_WITHIN_DAYS} days are left`);
      log('INFO', 'run with  --force  to replace it anyway');
      return;
    }
    if (daysLeft !== null) {
      log('INFO', `the certificate expires in ${daysLeft} days - renewing now`);
    } else {
      log('INFO', 'no certificate on disk yet - requesting one');
    }
  }

  if (!(await preflight())) {
    process.exit(1);
  }

  // Account key: identifies this PC to Let's Encrypt and is reused forever.
  let accountKey;
  if (fs.existsSync(ACCOUNT_KEY_FILE)) {
    accountKey = fs.readFileSync(ACCOUNT_KEY_FILE, 'utf8');
    log('INFO', 'reusing the existing Let\'s Encrypt account key');
  } else {
    accountKey = await acme.forge.createPrivateKey();
    fs.writeFileSync(ACCOUNT_KEY_FILE, accountKey, { mode: 0o600 });
    log('INFO', `created a new Let\'s Encrypt account key at ${ACCOUNT_KEY_FILE}`);
  }

  const client = new acme.Client({
    directoryUrl: USE_STAGING ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey,
  });

  // A fresh key for the certificate itself.
  const [certKey, csr] = await acme.forge.createCsr({
    commonName: DOMAIN,
    altNames: [DOMAIN],
  });
  log('INFO', 'generated a new private key and certificate request');

  const writtenFiles = new Set();

  let certificate;
  try {
    certificate = await client.auto({
      csr,
      email: EMAIL,
      termsOfServiceAgreed: true,
      // The self-check would leave through CGNAT and fail; see above.
      skipChallengeVerification: true,
      challengePriority: ['http-01'],
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'http-01') {
          throw new Error(`unexpected challenge type ${challenge.type}`);
        }
        const file = path.join(CHALLENGE_DIR, challenge.token);
        fs.writeFileSync(file, keyAuthorization);
        writtenFiles.add(file);
        log('INFO', `challenge file published for ${authz.identifier.value}`);

        // Prove to ourselves that it is actually being served before asking
        // Let's Encrypt to look at it.
        const address = (await resolveAddresses()).IPv6[0];
        for (let attempt = 1; attempt <= 5; attempt++) {
          const result = await fetchChallengeOverIpv6(address, challenge.token);
          if (result.status === 200 && result.body === keyAuthorization.trim()) {
            log('INFO', 'challenge is being served correctly on port 80');
            return;
          }
          log('WARN', `self-check attempt ${attempt}/5: status=${result.status} ${result.body.slice(0, 80)}`);
          await new Promise((r) => setTimeout(r, 3000));
        }
        throw new Error('the challenge file is not reachable on port 80 — is the gateway running?');
      },
      challengeRemoveFn: async (authz, challenge) => {
        const file = path.join(CHALLENGE_DIR, challenge.token);
        try { fs.unlinkSync(file); } catch { }
        writtenFiles.delete(file);
      },
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    log('ERROR', `certificate request failed: ${message}`);
    if (/rate limited|too many/i.test(message)) {
      log('ERROR', 'Let\'s Encrypt rate limit reached. Wait, then try  --staging  to test safely.');
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
      log('ERROR', 'The domain name could not be resolved. Create it at duckdns.org first.');
    }
    process.exit(1);
  } finally {
    for (const file of writtenFiles) {
      try { fs.unlinkSync(file); } catch { }
    }
  }

  fs.writeFileSync(CERT_KEY_FILE, certKey, { mode: 0o600 });
  fs.writeFileSync(CERT_CHAIN_FILE, certificate, { mode: 0o600 });

  log('INFO', `private key : ${CERT_KEY_FILE}`);
  log('INFO', `certificate : ${CERT_CHAIN_FILE}`);

  // Report the validity dates so expiry is obvious in the log.
  const x509 = new crypto.X509Certificate(certificate);
  log('INFO', `valid from  : ${x509.validFrom}`);
  log('INFO', `valid until : ${x509.validTo}`);
  log('INFO', `issued for  : ${x509.subject}`);

  log('INFO', 'done — the gateway picks this up within 30 seconds, no restart needed');
  if (USE_STAGING) {
    log('WARN', 'this is a STAGING certificate: browsers will still show a warning.');
    log('WARN', 're-run without --staging once the flow works.');
  }
}

main().catch((err) => {
  log('ERROR', `unexpected failure: ${err.stack || err.message}`);
  process.exit(1);
});
