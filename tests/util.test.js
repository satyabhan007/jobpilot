/* Quick sanity test for Util helpers (run with: node tests/util.test.js) */
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/../js/util.js', 'utf8');
const sandbox = {
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  decodeURIComponent, encodeURIComponent, console
};
vm.createContext(sandbox);
vm.runInContext(src + '; globalThis.__Util = Util;', sandbox);
const U = sandbox.__Util;

let fails = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  if (!ok) fails++;
}

// escaping must actually escape (expected strings built via concat so they survive as-is)
const LT = '&' + 'lt;', GT = '&' + 'gt;', AMP = '&' + 'amp;', QUOT = '&' + 'quot;';
check('escapeHtml basic', U.escapeHtml('<b>R&D</b> "q" it\'s'),
  LT + 'b' + GT + 'R' + AMP + 'D' + LT + '/b' + GT + ' ' + QUOT + 'q' + QUOT + ' it&#39;s');
check('escapeHtml empty', U.escapeHtml(''), '');
check('escapeHtml null', U.escapeHtml(null), '');

// base64url round-trip
const enc = Buffer.from('hello world & goodbye', 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
check('decodeBase64Url', U.decodeBase64Url(enc), 'hello world & goodbye');

// stripHtml on a gmail-ish html mail
check('stripHtml', U.stripHtml('<div>Hi <b>there</b>,<br>Apply & good luck</div>'), 'Hi there,\nApply & good luck');

// link extraction skips noise
check('extractLinks', U.extractLinks('apply at https://jobs.example.com/x?a=1 then https://www.google.com/search?q=x'), ['https://jobs.example.com/x?a=1']);

// dedupe key
check('dedupeKey', U.dedupeKey('Senior Frontend Developer!', 'Acme Corp.'), 'acmecorp|seniorfrontenddeveloper');

// timeAgo
check('timeAgo now', U.timeAgo(Date.now() - 30000), 'just now');

// requiredYears regex sanity (from matcher)
const re = /(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:years|yrs|year)/g;
const desc = '3-5 years of experience with Node. Also 2+ years SQL preferred.';
let m, best = null;
while ((m = re.exec(desc)) !== null) { const n = parseInt(m[1], 10); if (best === null || n < best) best = n; }
check('requiredYears min', best, 2);

process.exit(fails ? 1 : 0);
