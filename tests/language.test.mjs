// Site-wide English / Filipino switching: translation coverage, language
// switching, saved preference, dynamic content and personal-data preservation.
//
// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const languageSource = fs.readFileSync(path.join(publicDir, "js", "language.js"), "utf8");
const appSource = fs.readFileSync(path.join(publicDir, "js", "app.js"), "utf8");
const pages = fs.readdirSync(publicDir).filter(name => name.endsWith(".html")).sort();

const BASE_URL = "https://smartpwd.test/";
const SETTINGS_KEY = "spwd_settings";

// The settings-panel copy lives in app.js and is registered when app.js starts
// the language engine, so the tests register it exactly like the site does.
const catalog = extractLiteral(languageSource, "catalog");
const settingsCatalog = extractLiteral(appSource, "filipinoSettings");
const allCopy = Object.assign({}, catalog, settingsCatalog);

function extractLiteral(source, name) {
  const marker = `const ${name} = {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `could not find "${name}" in the source`);
  const bodyStart = start + marker.length - 1;
  const end = source.indexOf("\n  };", bodyStart);
  assert.notEqual(end, -1, `could not find the end of "${name}"`);
  return new Function(`return (${source.slice(bodyStart, end + 4)});`)();
}

function readPage(name) {
  return fs.readFileSync(path.join(publicDir, name), "utf8");
}

// Mirrors app.js loadSettings(): the page decides the language from storage.
function savedLanguage(window) {
  const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
  return raw.language === "Filipino" ? "Filipino" : "English";
}

// Boots one page with the real language engine, the way app.js does.
function boot(html, { page = "index.html", settings, language } = {}) {
  const dom = new JSDOM(html, {
    url: BASE_URL + page,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (settings) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  window.eval(languageSource);
  window.SmartPWDLanguage.start(language ?? savedLanguage(window), settingsCatalog);
  return dom;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const text = document_ => document_.documentElement.textContent.replace(/\s+/g, " ");

// A trimmed snapshot of the two admin tables as the pages render them: the
// reference/holder, establishment and timestamp columns carry API data, while
// the method, result and status columns are interface copy in the same row.
const personalDataPage = `<!doctype html><html lang="en"><body>
  <aside class="sidebar">
    <div class="profile-info"><b id="sidebar-name">Ken Mijay A. Espiritu</b></div>
  </aside>

  <section class="panel">
    <h2>My Smart PWD ID</h2>
    <div id="myIdCard">
      <div><span class="label">Full Name</span><span class="value">Ken Mijay A. Espiritu</span></div>
    </div>

    <p class="bubble">Forgot password? Please review my Benefits application.</p>
    <form><textarea id="note" rows="2">Welcome back</textarea></form>
    <p data-no-translate>Settings</p>

    <table>
      <thead><tr><th>Reference</th><th>PWD</th><th>Method</th><th>Establishment</th><th>Result</th><th>Timestamp</th></tr></thead>
      <tbody id="logs-body">
        <tr>
          <td><code>VER-9F2A</code></td>
          <td>Unknown<br><small>PWD-0001</small></td>
          <td><span class="method">Manual</span></td>
          <td>SM City North EDSA</td>
          <td><span>Success</span></td>
          <td>Nov 26, 2026, 09:15 AM</td>
        </tr>
      </tbody>
    </table>

    <table>
      <thead><tr><th>ID</th><th>Establishment</th><th>Mobile</th><th>Status</th><th>Registered</th><th>Valid Until</th><th></th></tr></thead>
      <tbody id="est-body">
        <tr>
          <td><code>EST-0007</code></td>
          <td>SM City North EDSA</td>
          <td>0917 123 4567</td>
          <td><span>Approved</span></td>
          <td>2026-01-14</td>
          <td>2026-12-31</td>
          <td><button type="button">Detail</button></td>
        </tr>
      </tbody>
    </table>
  </section>
</body></html>`;

test("the catalog is complete and has no empty or colliding entries", () => {
  const keys = Object.keys(allCopy);
  assert.ok(keys.length > 500, `expected a full copy catalog, found ${keys.length} entries`);
  for (const [english, filipino] of Object.entries(allCopy)) {
    assert.equal(typeof filipino, "string", `"${english}" is not translated to a string`);
    assert.ok(filipino.trim().length > 0, `"${english}" has an empty translation`);
    assert.equal(english, english.replace(/\s+/g, " ").trim(), `"${english}" is not normalised`);
    assert.ok(!/<[a-z/]/i.test(filipino), `"${english}" contains markup`);
  }

  // The lookup lower-cases its keys, so entries that only differ by case must
  // agree; otherwise the wording would depend on their order in the file.
  const byNormalised = new Map();
  for (const key of keys) byNormalised.set(key.toLowerCase(), (byNormalised.get(key.toLowerCase()) || []).concat(key));
  for (const group of byNormalised.values()) {
    const meanings = new Set(group.map(key => allCopy[key].toLowerCase()));
    assert.equal(meanings.size, 1, `entries that collide after normalisation disagree: ${group.join(", ")}`);
  }
});

test("every page loads the shared language engine", () => {
  assert.ok(pages.length >= 19, `expected the full site, found ${pages.length} pages`);
  for (const page of pages) {
    assert.match(readPage(page), /js\/app\.js/, `${page} does not load app.js`);
  }
  // app.js applies the saved preference before any interaction happens.
  assert.match(
    appSource,
    /SmartPWDLanguage\.start\(loadSettings\(\)\.language, filipinoSettings\)/,
    "app.js does not start the engine with the saved preference"
  );
  assert.match(appSource, /applySettingsLanguage[\s\S]*?setLanguage\(language\)/, "app.js does not switch language live");
});

test("Filipino translates the page and English restores it exactly", () => {
  const { window } = boot(readPage("login.html"), { page: "login.html" });
  const document = window.document;
  const engine = window.SmartPWDLanguage;

  const before = text(document);
  assert.match(before, /Sign in/);
  assert.match(before, /Forgot password\?/);
  assert.match(before, /Remember me/);

  engine.setLanguage("Filipino");
  const filipino = text(document);
  assert.match(filipino, /Mag-sign in/);
  assert.match(filipino, /Nakalimutan ang password\?/);
  assert.match(filipino, /Tandaan ako/);
  assert.match(filipino, /Mga demo account/);
  assert.match(filipino, /Ligtas na web portal/);
  assert.doesNotMatch(filipino, /Forgot password\?/);
  assert.equal(document.querySelector("title").textContent, "Mag-sign in | Smart PWD ID");

  engine.setLanguage("English");
  assert.equal(text(document), before, "switching back did not restore the original copy");
  assert.equal(document.querySelector("title").textContent, "Login | Smart PWD ID");

  engine.setLanguage("Filipino");
  engine.setLanguage("English");
  assert.equal(text(document), before, "repeated switching drifted from the original copy");
});

test("attributes, decorations, counts and titles are translated too", () => {
  const { window } = boot(readPage("login.html"), { page: "login.html" });
  const document = window.document;
  const engine = window.SmartPWDLanguage;

  assert.equal(document.getElementById("pass").placeholder, "Enter your password");
  engine.setLanguage("Filipino");
  assert.equal(document.getElementById("pass").placeholder, "Ilagay ang iyong password");
  assert.equal(document.getElementById("togglePassword").getAttribute("aria-label"), "Ipakita ang password");
  assert.equal(document.documentElement.lang, "fil");

  assert.equal(engine.translate("Good day, Ken"), "Magandang araw, Ken");
  assert.equal(engine.translate("3 applications to review."), "3 aplikasyon na susuriin.");
  assert.equal(engine.translate("Login | Smart PWD ID"), "Mag-sign in | Smart PWD ID");
  assert.equal(engine.translate("\u2713 QR Verification"), "\u2713 Beripikasyong QR");
  assert.equal(engine.translate("Ken Mijay A. Espiritu"), "Ken Mijay A. Espiritu");

  engine.setLanguage("English");
  assert.equal(document.getElementById("pass").placeholder, "Enter your password");
  assert.equal(document.getElementById("togglePassword").getAttribute("aria-label"), "Show password");
  assert.equal(document.documentElement.lang, "en");
  assert.equal(engine.translate("Good day, Ken"), "Good day, Ken", "English must not translate");
});

test("the saved preference is applied on load and carried to the next page", () => {
  const first = boot(readPage("login.html"), {
    page: "login.html",
    settings: { language: "Filipino", largeText: true, darkMode: true }
  });
  assert.match(text(first.window.document), /Mag-sign in/, "the saved language was not applied on load");

  // Two other accessibility toggles must survive alongside the language.
  const stored = JSON.parse(first.window.localStorage.getItem(SETTINGS_KEY));
  assert.equal(stored.largeText, true);
  assert.equal(stored.darkMode, true);

  // Same browser, next page: the preference is read from storage again.
  const second = boot(readPage("dashboard.html"), {
    page: "dashboard.html",
    settings: stored
  });
  assert.match(text(second.window.document), /Mga Setting/, "the next page did not reuse the preference");
  assert.equal(second.window.document.documentElement.lang, "fil");
});

test("content rendered after load is translated, including re-renders", async () => {
  const { window } = boot(readPage("dashboard.html"), { page: "dashboard.html" });
  const document = window.document;
  const engine = window.SmartPWDLanguage;

  const host = document.createElement("section");
  document.body.appendChild(host);
  engine.setLanguage("Filipino");

  // A dashboard list arriving from the API.
  host.innerHTML = `<h2>Verification Logs</h2>
    <table><tbody id="logs-body"><tr><td>Today</td><td>Jenny Rose Dela Cruz</td></tr></tbody></table>
    <select id="statusFilter"><option>All Status</option></select>
    <button id="apply" title="Review">Review</button>`;
  await tick();

  assert.match(text(document), /Mga Talaan ng Beripikasyon/, "dynamic copy was not translated");
  assert.equal(document.querySelector("#apply").getAttribute("title"), "Suriin");
  assert.equal(document.querySelector("#statusFilter option").textContent, "Lahat ng Katayuan");
  assert.equal(
    document.querySelector("#statusFilter option").value,
    "All Status",
    "translating an option value broke the filter payload"
  );

  // The same list is re-rendered from scratch in English (refresh, filter
  // change, pagination) and must be translated again by the observer.
  host.innerHTML = `<h2>Verification Logs</h2>
    <p>Loading applications...</p>
    <select id="statusFilter"><option>All Status</option></select>`;
  await tick();
  assert.match(text(document), /Mga Talaan ng Beripikasyon/);
  assert.match(text(document), /Nilo-load ang mga aplikasyon/);
  assert.equal(
    document.querySelector("#statusFilter option").textContent,
    "Lahat ng Katayuan",
    "a re-rendered control was not translated"
  );

  // Switching back must restore the English copy of everything rendered later.
  engine.setLanguage("English");
  assert.match(text(document), /Verification Logs/);
  assert.match(text(document), /Loading applications\.\.\./);
  assert.equal(document.querySelector("#statusFilter option").textContent, "All Status");
});

test("personal data is never translated, while the surrounding copy is", async () => {
  const { window } = boot(personalDataPage, { page: "verification-logs.html" });
  const document = window.document;
  const engine = window.SmartPWDLanguage;
  const copy = selector => document.querySelector(selector).textContent;

  // Columns taken from the real templates: reference, holder, method,
  // establishment, result, timestamp.
  const personalData = [
    "#logs-body td:nth-child(1)",  // reference, rendered inside <code>
    "#logs-body td:nth-child(2)",  // holder name + PWD ID
    "#logs-body td:nth-child(4)",  // establishment name
    "#logs-body td:nth-child(6)",  // timestamp
    "#est-body td:nth-child(1)",   // establishment ID, inside <code>
    "#est-body td:nth-child(2)",   // establishment name
    "#est-body td:nth-child(3)",   // establishment contact number
    "#est-body td:nth-child(5)",   // registration date
    "#est-body td:nth-child(6)",   // validity date
    "#sidebar-name",
    "#myIdCard .value",
    ".bubble",
    "textarea",
    "code",
    "[data-no-translate]"
  ];
  const before = personalData.map(copy);

  engine.setLanguage("Filipino");
  await tick();

  // Personal data is byte-for-byte identical, even where it collides with
  // interface copy: "Unknown" is a catalogue label and the textarea holds a
  // message the user typed themselves.
  personalData.forEach((selector, index) => {
    assert.equal(copy(selector), before[index], `${selector} was translated`);
  });
  assert.equal(copy(".bubble"), "Forgot password? Please review my Benefits application.");
  assert.equal(copy("textarea"), "Welcome back");
  assert.equal(copy("[data-no-translate]"), "Settings");

  // ... while the interface around it really is in Filipino, so the exclusions
  // are not simply masking a page that never translated.
  assert.match(text(document), /Aking Smart PWD ID/);
  assert.match(text(document), /Buong Pangalan/);
  assert.equal(copy("#logs-body td:nth-child(3)"), "Manwal", "the method column should translate");
  assert.equal(copy("#logs-body td:nth-child(5)"), "Matagumpay", "the result column should translate");
  assert.equal(copy("#est-body td:nth-child(4)"), "Aprubado", "the establishment status should translate");

  engine.setLanguage("English");
  personalData.forEach((selector, index) => {
    assert.equal(copy(selector), before[index], `${selector} changed on the way back`);
  });
  assert.equal(copy("#logs-body td:nth-child(3)"), "Manual");
});

test("the compact switch covers pages without the settings panel and saves the choice", () => {
  const { window } = boot(readPage("login.html"), { page: "login.html" });
  const document = window.document;
  const engine = window.SmartPWDLanguage;

  const switcher = document.getElementById("languageSwitch");
  assert.ok(switcher, "sign-in has no way to change the language");
  assert.equal(switcher.getAttribute("role"), "group");
  assert.equal(switcher.getAttribute("aria-label"), "Website language");
  const buttons = Array.from(switcher.querySelectorAll("button[data-language]"));
  assert.deepEqual(buttons.map(button => button.textContent), ["English", "Filipino"]);
  assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
  assert.equal(buttons[1].getAttribute("aria-pressed"), "false");

  buttons[1].click();
  assert.match(text(document), /Mag-sign in/);
  assert.equal(switcher.getAttribute("aria-label"), "Wika ng website");
  assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
  assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
  // Language names stay readable in both languages.
  assert.deepEqual(
    Array.from(switcher.querySelectorAll("button[data-language]")).map(button => button.textContent),
    ["English", "Filipino"]
  );

  // The preference is stored under the shared settings key and keeps the other
  // accessibility toggles intact.
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "English", largeText: true }));
  buttons[1].click();
  const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY));
  assert.equal(stored.language, "Filipino");
  assert.equal(stored.largeText, true);

  buttons[0].click();
  assert.equal(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)).language, "English");
  assert.match(text(document), /Forgot password\?/);

  // Pages that already expose the language selector inside the settings panel
  // must not get a second control.
  const portal = boot(readPage("index.html"), { page: "index.html" });
  assert.equal(portal.window.document.getElementById("languageSwitch"), null);
  assert.ok(portal.window.document.querySelector("[data-access]"));
});

test("the settings selector and page metadata follow the active language", () => {
  const html = `<!doctype html><html lang="en"><body>
    <button data-access>Settings</button>
    <div id="settingsPanel">
      <select id="langSelect">
        <option value="English">English</option>
        <option value="Filipino">Filipino</option>
      </select>
    </div>
  </body></html>`;
  const { window } = boot(html, { page: "dashboard.html" });
  const document = window.document;
  const select = document.getElementById("langSelect");

  window.SmartPWDLanguage.setLanguage("Filipino");
  assert.equal(select.value, "Filipino");
  assert.equal(document.getElementById("settingsPanel").lang, "fil");
  assert.deepEqual(
    Array.from(select.options).map(option => option.textContent),
    ["English", "Filipino"],
    "the language options were translated"
  );

  // A change made in the panel is picked up without a reload, as app.js does.
  select.value = "English";
  window.SmartPWDLanguage.setLanguage(select.value);
  assert.equal(document.documentElement.lang, "en");
  assert.match(text(document), /Settings/);
});
