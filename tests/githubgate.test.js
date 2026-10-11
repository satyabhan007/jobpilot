/* GitHub identity gate test (run with: node tests/githubgate.test.js)
 *
 * Covers the "exclusive access only to the GitHub account holder" machinery:
 *   1. isAllowedLogin       — owner matching (case-insensitive, rejects empties)
 *   2. request bodies       — Device Flow /login/device/code + polling bodies
 *   3. parseJson            — tolerant parsing of odd responses
 *   4. nextDelay/keepPolling— polling backoff + "keep waiting" errors
 *   5. deviceFlow           — full round-trip, expiry, denial, bad config, network
 *   6. fetchLogin           — api.github.com/user verification
 *   7. storage              — gate session + GitHub client id persistence
 *   8. portfolio/config     — owner wiring from portfolio.js
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

/* ---------- sandbox: location + fetch stubs (no DOM needed for pure logic) ---------- */
const loc = { protocol: 'http:', origin: 'https://satyabhan007.github.io' };
const mem = new Map();
const sandbox = {
  console, setTimeout, Date, Promise, Error, URLSearchParams,
  localStorage: {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k)
  },
  window: { location: loc, fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }) }
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'portfolio.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(__dirname, '..', 'js', 'githubauth.js'), 'utf8') + '\n' +
  '; globalThis.__A = window.GitHubAuth; globalThis.__G = window.GitHubGate; globalThis.__S = Store; globalThis.__P = PORTFOLIO_PROFILE;',
  sandbox
);
const A = sandbox.__A, G = sandbox.__G, S = sandbox.__S;
const OWNER = 'satyabhan007';
const CID = 'Ov23liTestClientID12345';

/* ---------- 1. owner matching ---------- */
section('isAllowedLogin — only the account holder passes');
check('exact match', A.isAllowedLogin('satyabhan007', OWNER));
check('case-insensitive (GitHub logins are)', A.isAllowedLogin('Satyabhan007', OWNER));
check('different user rejected', !A.isAllowedLogin('randomvisitor', OWNER));
check('lookalike rejected', !A.isAllowedLogin('satyabhan007x', OWNER));
check('prefix rejected', !A.isAllowedLogin('sat', OWNER));
check('empty login rejected', !A.isAllowedLogin('', OWNER));
check('empty owner rejected', !A.isAllowedLogin('satyabhan007', ''));
check('null inputs rejected', !A.isAllowedLogin(null, null));

/* ---------- 2. request bodies ---------- */
section('device-flow request bodies');
let body = A.deviceCodeBody(CID);
check('device/code: client_id', body.includes('client_id=' + encodeURIComponent(CID)));
check('device/code: scope read:user', body.includes('scope=' + encodeURIComponent('read:user')));
check('device/code: urlencoded content', !body.includes('{'));
let threw = false;
try { A.deviceCodeBody(''); } catch (e) { threw = true; }
check('device/code: throws without client id', threw);
body = A.tokenPollBody(CID, 'devcode456');
check('poll: client_id', body.includes('client_id=' + encodeURIComponent(CID)));
check('poll: device_code', body.includes('device_code=' + encodeURIComponent('devcode456')));
check('poll: RFC grant_type', body.includes('grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:device_code')));
threw = false;
try { A.tokenPollBody(CID, ''); } catch (e) { threw = true; }
check('poll: throws without device_code', threw);

/* ---------- 3. tolerant JSON ---------- */
section('parseJson — never trust the network body');
check('valid object', A.parseJson('{"a":1}').a === 1);
check('invalid → {}', Object.keys(A.parseJson('not json')).length === 0);
check('empty → {}', Object.keys(A.parseJson('')).length === 0);
check('array → returned as object', Array.isArray(A.parseJson('[1,2]')));
check('null literal → {}', Object.keys(A.parseJson('null')).length === 0);

/* ---------- 4. polling rules ---------- */
section('polling backoff + continue rules');
check('default interval 5s', A.nextDelay(undefined) === 5000);
check('interval 3s → 3000ms', A.nextDelay(3) === 3000);
check('slow_down adds 5s', A.nextDelay(5, 'slow_down') === 10000);
check('garbage interval → default', A.nextDelay('x') === 5000);
check('keeps polling on authorization_pending', A.keepPolling('authorization_pending'));
check('keeps polling on slow_down', A.keepPolling('slow_down'));
check('stops on access_denied', !A.keepPolling('access_denied'));
check('stops on expired_token', !A.keepPolling('expired_token'));
check('stops on success (no error)', !A.keepPolling(undefined));

/* ---------- 5. full device flow ---------- */
section('deviceFlow — happy path with pending + slow_down');
A._sleep = async () => {};                       // instant polling for tests
const events = [];
let calls = 0;
sandbox.window.fetch = async (url, opts) => {
  calls++;
  if (calls === 1) {
    check('call 1 → device/code endpoint', url === A.DEVICE_URL, url);
    check('call 1 POST', opts.method === 'POST');
    check('call 1 Accept json', opts.headers.Accept === 'application/json');
    return { status: 200, ok: true, text: async () => JSON.stringify({
      device_code: 'DC123', user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900
    })};
  }
  if (calls === 2) return { status: 200, ok: true, text: async () => JSON.stringify({ error: 'authorization_pending' }) };
  if (calls === 3) return { status: 200, ok: true, text: async () => JSON.stringify({ error: 'slow_down' }) };
  check('poll body sent to token endpoint', url === A.TOKEN_URL, url);
  check('poll body carries grant_type', String(opts.body).includes('urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code'));
  return { status: 200, ok: true, text: async () => JSON.stringify({ access_token: 'gho_tok123', token_type: 'bearer' }) };
};
let result = await A.deviceFlow({ clientId: CID, onEvent: ev => events.push(ev.type) });
check('flow returns token', result && result.token === 'gho_tok123');
check('emitted the code event', events.includes('code'));
check('emitted authorized at the end', events[events.length - 1] === 'authorized');
check('poll retried through pending + slow_down', calls === 4, calls + ' calls');

section('deviceFlow — failure modes');
/* helper: device/code succeeds, token endpoint returns the given body */
function pollAlways(tokBody) {
  let n = 0;
  return async (url) => {
    n++;
    if (url === A.DEVICE_URL) return { status: 200, ok: true, text: async () => JSON.stringify({ device_code: 'DC', user_code: 'XXXX-XXXX', verification_uri: A.DEVICE_ENTER_URL, interval: 1, expires_in: 900 }) };
    if (n > 200) return { status: 200, ok: true, text: async () => JSON.stringify({ error: 'access_denied' }) };  // safety net
    return { status: 200, ok: true, text: async () => (typeof tokBody === 'function' ? tokBody(n) : tokBody) };
  };
}
sandbox.window.fetch = pollAlways(JSON.stringify({ error: 'expired_token', error_description: 'code expired' }));
let err = null;
try { await A.deviceFlow({ clientId: CID }); } catch (e) { err = e; }
check('expired code → code expired', err && err.code === 'expired', err && err.code);
sandbox.window.fetch = pollAlways(JSON.stringify({ error: 'access_denied' }));
err = null;
try { await A.deviceFlow({ clientId: CID }); } catch (e) { err = e; }
check('user denial → code denied', err && err.code === 'denied', err && err.code);
sandbox.window.fetch = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ error: 'unauthorized_client', error_description: 'Device flow not enabled for this app' }) });
err = null;
try { await A.deviceFlow({ clientId: CID }); } catch (e) { err = e; }
check('device flow disabled → code config', err && err.code === 'config', err && err.message);
sandbox.window.fetch = async () => { throw new Error('EAI_AGAIN'); };
err = null;
try { await A.deviceFlow({ clientId: CID }); } catch (e) { err = e; }
check('offline → code network', err && err.code === 'network');
sandbox.window.fetch = async () => ({ status: 200, ok: true, text: async () => '<html>blocked</html>' });
err = null;
try { await A.deviceFlow({ clientId: CID }); } catch (e) { err = e; }
check('CORS/HTML junk → non-device_code failure', err && err.code === 'http:200', err && err.code);

/* ---------- 6. identity verification ---------- */
section('fetchLogin — api.github.com/user verification');
sandbox.window.fetch = async (url, opts) => {
  check('verify hits /user', url === A.VERIFY_URL, url);
  check('verify sends Bearer token', opts.headers.Authorization === 'Bearer gho_tok123');
  return { status: 200, ok: true, text: async () => JSON.stringify({ login: OWNER, id: 1 }) };
};
check('returns the login', await A.fetchLogin('gho_tok123') === OWNER);
sandbox.window.fetch = async () => ({ status: 401, ok: false, text: async () => '{}' });
err = null;
try { await A.fetchLogin('bad'); } catch (e) { err = e; }
check('401 → unauthorized', err && err.code === 'unauthorized');
sandbox.window.fetch = async () => ({ status: 200, ok: true, text: async () => '{"id":1}' });
err = null;
try { await A.fetchLogin('x'); } catch (e) { err = e; }
check('missing login → bad-response', err && err.code === 'bad-response');

/* ---------- 7. storage: session + client id ---------- */
section('storage — gate session lifecycle');
check('no session initially', S.gateSession() === null);
S.saveGateSession({ token: 'gho_t', login: OWNER, verifiedAt: 123 });
check('session persists', S.gateSession().token === 'gho_t' && S.gateSession().login === OWNER);
S.clearGateSession();
check('session clears', S.gateSession() === null);

section('storage — GitHub client id + config');
check('owner from portfolio.js', S.githubOwner() === OWNER);
check('gate enabled by default', S.gateEnabled() === true);
check('client id empty until configured', S.githubClientId() === '');
S.saveGithubClientId(' Ov23liSavedValue ');
check('client id saved + trimmed', S.githubClientId() === 'Ov23liSavedValue');
S.saveGithubClientId('');
check('cleared → falls back to portfolio value', S.githubClientId() === '');

/* ---------- 8. portfolio wiring + gate scope ---------- */
section('config — portfolio.js is the source of truth');
check('PORTFOLIO_PROFILE.githubOwner set', sandbox.__P.githubOwner === OWNER);
check('PORTFOLIO_PROFILE.gateEnabled true', sandbox.__P.gateEnabled === true);
check('PORTFOLIO_PROFILE.githubClientId key exists', 'githubClientId' in sandbox.__P);

loc.protocol = 'http:';
check('gate applies on http(s)', G.applies() === true);
loc.protocol = 'https:';
check('gate applies on GitHub Pages', G.applies() === true);
loc.protocol = 'file:';
check('gate skipped for the APK (file://)', G.applies() === false);
loc.protocol = 'http:';

console.log('\n===== RESULT =====');
console.log('PASS: ' + passes + '  FAIL: ' + fails);
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
