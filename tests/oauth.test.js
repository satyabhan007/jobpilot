/* OAuth login-link test (run with: node tests/oauth.test.js)
 *
 * Covers the "easy Gmail connection" machinery:
 *   1. buildAuthUrl — the direct OAuth consent "login link"
 *   2. parseHash    — parsing Google's #access_token redirect
 *   3. handleRedirect — full round-trip: validate → register → clean URL
 *   4. registerToken — token validation + expiry bookkeeping
 *   5. friendlyAuthError — actionable messages for every common failure
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

(async () => {
let fails = 0, passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log('PASS: ' + name + (extra != null ? ' (' + extra + ')' : '')); }
  else { fails++; console.log('FAIL: ' + name + (extra != null ? ' (' + extra + ')' : '')); }
}
function section(t) { console.log('\n===== ' + t + ' ====='); }

/* ---------- sandbox: browser location/history/fetch stubs ---------- */
const loc = {
  protocol: 'http:',
  origin: 'http://localhost:8000',
  hash: '',
  pathname: '/',
  search: ''
};
let replaceStateCalls = [];
let fetchProfileOk = true;
const sandbox = {
  URLSearchParams, console,
  fetch: async () => fetchProfileOk
    ? { ok: true, status: 200, json: async () => ({ emailAddress: 'sattester@gmail.com' }) }
    : { ok: false, status: 403, json: async () => ({ error: { message: ' Gmail API has not been used' } }) },
  window: { location: loc },
  history: { replaceState: (s, t, url) => { replaceStateCalls.push(url); loc.hash = ''; } }
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'gmail.js'), 'utf8') +
  '; globalThis.__G = GmailClient;',
  sandbox
);
const G = sandbox.__G;
const CLIENT_ID = '1234567890-abc123def.apps.googleusercontent.com';

/* ---------- 1. login link ---------- */
section('buildAuthUrl — the login link');
let url = G.buildAuthUrl(CLIENT_ID, 'http://localhost:8000', 'state123');
let u = new URL(url);
check('points at Google OAuth endpoint', url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'), url.slice(0, 52) + '…');
check('client_id passed', u.searchParams.get('client_id') === CLIENT_ID);
check('implicit token flow', u.searchParams.get('response_type') === 'token');
check('gmail.readonly scope', u.searchParams.get('scope') === 'https://www.googleapis.com/auth/gmail.readonly');
check('redirect_uri = origin + /', u.searchParams.get('redirect_uri') === 'http://localhost:8000/');
check('always shows account picker', u.searchParams.get('prompt') === 'select_account');
check('include_granted_scopes', u.searchParams.get('include_granted_scopes') === 'true');
check('state passed through', u.searchParams.get('state') === 'state123');
let threw = false;
try { G.buildAuthUrl('', 'http://localhost:8000', 'x'); } catch (e) { threw = true; }
check('throws without a Client ID', threw);
url = G.loginLink(CLIENT_ID);
check('loginLink generates a fresh state', !!G._state && url.includes('state=' + G._state));

/* ---------- 2. hash parsing ---------- */
section('parseHash — Google redirect fragments');
let h = G.parseHash('#access_token=ya29.abc&expires_in=3599&state=xyz&token_type=Bearer');
check('parses access_token', h && h.access_token === 'ya29.abc');
check('parses expires_in', h.expires_in === 3599);
check('parses state', h.state === 'xyz');
check('no hash → null', G.parseHash('') === null && G.parseHash(null) === null);
check('unrelated hash → null', G.parseHash('#section-2') === null);
h = G.parseHash('#error=access_denied&state=xyz');
check('error hash surfaced', h && h.error === 'access_denied' && h.access_token === '');

/* ---------- 3. full redirect round-trip ---------- */
section('handleRedirect — validate → register → clean URL');
loc.hash = '#access_token=tok_ok_1&expires_in=1200&state=' + G._state;
let email = await G.handleRedirect();
check('returns the authenticated email', email === 'sattester@gmail.com', email);
check('account registered', G.accounts.has('sattester@gmail.com'));
check('expiry = expires_in − 60s', Math.abs(G.accounts.get('sattester@gmail.com').expiry - (Date.now() + 1140 * 1000)) < 5000);
check('URL cleaned (replaceState to /)', replaceStateCalls[replaceStateCalls.length - 1] === '/');

loc.hash = '#access_token=tok2&expires_in=3599&state=WRONG_STATE';
G._state = 'expected';
threw = false;
try { await G.handleRedirect(); } catch (e) { threw = /state mismatch/i.test(e.message); }
check('CSRF: wrong state rejected', threw);

loc.hash = '#error=access_denied';
threw = false;
try { await G.handleRedirect(); } catch (e) { threw = /Test user/i.test(e.message); }
check('error redirect → friendly message', threw);

loc.hash = '';
email = await G.handleRedirect();
check('normal load → null, no throw', email === null);

/* ---------- 4. token validation failures ---------- */
section('registerToken — API failure mapping');
fetchProfileOk = false;
threw = false;
try { await G.registerToken('bad', 3600); } catch (e) { threw = /Gmail API may be disabled/i.test(e.message); }
check('403 → Gmail-API-disabled hint', threw);
fetchProfileOk = true;

/* ---------- 5. friendly errors ---------- */
section('friendlyAuthError — every common failure has a fix');
check('origin_mismatch', /Authorized JavaScript origins/.test(G.friendlyAuthError('origin_mismatch')));
check('redirect_uri_mismatch', /Authorized redirect URIs/.test(G.friendlyAuthError('redirect_uri_mismatch')));
check('popup blocked', /Login link/.test(G.friendlyAuthError('popup_failed_to_open')));
check('access denied', /Test user/.test(G.friendlyAuthError('access_denied')));
check('403 → enable Gmail API', /Library/.test(G.friendlyAuthError('HTTP 403')));
check('unknown → still a message', /unknown error/.test(G.friendlyAuthError('')));

/* ---------- 6. origin detection ---------- */
section('webOriginOk / currentOrigin');
check('http origin ok', G.webOriginOk() === true && G.currentOrigin() === 'http://localhost:8000');
loc.protocol = 'file:';
check('file:// (APK) detected as non-web', G.webOriginOk() === false);
loc.protocol = 'http:';

console.log('\n=========================================');
console.log('TOTAL: ' + passes + ' passed, ' + fails + ' failed');
console.log('=========================================');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
