/* ===== GitHub identity gate — exclusive access for the account holder =====
 *
 * Used when the app is hosted (GitHub Pages, any http(s) origin). A lock
 * screen asks the visitor to prove they are the GitHub account holder:
 *
 *   1. "Sign in with GitHub"  — OAuth Device Flow (NO client secret needed).
 *        POST github.com/login/device/code  -> {user_code, device_code, ...}
 *        visitor opens github.com/login/device and enters the code
 *        poll  github.com/login/oauth/access_token until authorized
 *   2. Paste a Personal Access Token (read:user) — always works, even if a
 *      browser/network blocks the OAuth endpoints.
 *
 * Either way the token is exchanged for GET api.github.com/user and the
 * login must match PORTFOLIO_PROFILE.githubOwner. The verified session is
 * stored in localStorage and re-verified against the API on every load.
 *
 * file:// (the Android APK) is never gated — the app is local to the device.
 */
(function (global) {
  'use strict';

  /* ---------- pure helpers (no DOM — covered by tests) ---------- */
  const GitHubAuth = {
    DEVICE_URL: 'https://github.com/login/device/code',
    TOKEN_URL: 'https://github.com/login/oauth/access_token',
    VERIFY_URL: 'https://api.github.com/user',
    DEVICE_ENTER_URL: 'https://github.com/login/device',

    /** The visitor's GitHub login must exactly match the owner (case-insensitive). */
    isAllowedLogin(login, owner) {
      if (!login || !owner) return false;
      return String(login).toLowerCase() === String(owner).toLowerCase();
    },

    /** URL-encoded body for POST /login/device/code */
    deviceCodeBody(clientId) {
      if (!clientId) throw new Error('GitHub OAuth App Client ID is required');
      return 'client_id=' + encodeURIComponent(clientId) +
             '&scope=' + encodeURIComponent('read:user');
    },

    /** URL-encoded body for the polling POST /login/oauth/access_token */
    tokenPollBody(clientId, deviceCode) {
      if (!clientId) throw new Error('GitHub OAuth App Client ID is required');
      if (!deviceCode) throw new Error('device_code is required');
      return 'client_id=' + encodeURIComponent(clientId) +
             '&device_code=' + encodeURIComponent(deviceCode) +
             '&grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:device_code');
    },

    /** Tolerant JSON parse — network layers may hand back HTML/empty bodies. */
    parseJson(text) {
      try { const v = JSON.parse(text); return (v && typeof v === 'object') ? v : {}; }
      catch (e) { return {}; }
    },

    /** Poll delay in ms; GitHub asks for +5s more after a slow_down. */
    nextDelay(intervalSec, err) {
      let sec = Number(intervalSec) > 0 ? Number(intervalSec) : 5;
      let ms = sec * 1000;
      if (err === 'slow_down') ms += 5000;
      return ms;
    },

    /** Keep polling only while GitHub says "not yet". */
    keepPolling(err) {
      return err === 'authorization_pending' || err === 'slow_down';
    },

    _sleep(ms) { return new Promise(res => setTimeout(res, ms)); },

    /**
     * Run the full Device Flow. DOM-free: fetchImpl + onEvent are injected.
     * Resolves {token, login?} or throws Error with .code
     * ('expired', 'denied', 'config', 'network', 'http:<n>').
     */
    async deviceFlow(opts) {
      const f = opts.fetchImpl || global.fetch;
      const emit = opts.onEvent || function () {};
      const maxMs = opts.maxMs || 15 * 60 * 1000;   // GitHub codes expire ~15 min
      const started = Date.now();

      // 1) request a device + user code
      let start;
      try {
        const res = await f(GitHubAuth.DEVICE_URL, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: GitHubAuth.deviceCodeBody(opts.clientId)
        });
        start = GitHubAuth.parseJson(await res.text());
        if (!start.device_code || !start.user_code) {
          const e = new Error(start.error_description || start.error || 'Device code request rejected');
          e.code = start.error === 'unsupported_grant_type' || /device flow/i.test(start.error_description || '')
            ? 'config' : 'http:' + res.status;
          throw e;
        }
      } catch (e) {
        if (e.code) throw e;
        const err = new Error('Could not reach github.com to start sign-in (' + e.message + ')');
        err.code = 'network';
        throw err;
      }

      emit({ type: 'code', user_code: start.user_code,
             verification_uri: start.verification_uri || GitHubAuth.DEVICE_ENTER_URL,
             interval: start.interval || 5, expires_in: start.expires_in || 900 });

      // 2) poll until the visitor authorizes (or the code expires)
      const deadline = started + Math.min(maxMs, (start.expires_in || 900) * 1000);
      let interval = start.interval || 5;
      while (Date.now() < deadline) {
        await GitHubAuth._sleep(GitHubAuth.nextDelay(interval));
        let poll;
        try {
          const res = await f(GitHubAuth.TOKEN_URL, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: GitHubAuth.tokenPollBody(opts.clientId, start.device_code)
          });
          poll = GitHubAuth.parseJson(await res.text());
        } catch (e) {
          emit({ type: 'status', message: 'Network hiccup — retrying…' });
          continue;
        }
        if (poll.access_token) {
          emit({ type: 'authorized' });
          return { token: poll.access_token };
        }
        if (GitHubAuth.keepPolling(poll.error)) {
          if (poll.error === 'slow_down') interval = interval + 5;
          emit({ type: 'status', message: 'Waiting for you to finish in the GitHub tab…' });
          continue;
        }
        const e = new Error(poll.error_description || poll.error || 'Sign-in failed');
        e.code = poll.error === 'expired_token' ? 'expired'
               : poll.error === 'access_denied' ? 'denied'
               : poll.error === 'incorrect_client_credentials' || poll.error === 'unsupported_grant_type' ? 'config'
               : 'failed';
        throw e;
      }
      const e = new Error('The code expired — start again.');
      e.code = 'expired';
      throw e;
    },

    /** GET api.github.com/user → login (throws on bad token / network). */
    async fetchLogin(token, fetchImpl) {
      const f = fetchImpl || global.fetch;
      if (!token) throw new Error('No token provided');
      const res = await f(GitHubAuth.VERIFY_URL, {
        headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token }
      });
      if (res.status === 401) { const e = new Error('Token rejected (401)'); e.code = 'unauthorized'; throw e; }
      if (!res.ok) { const e = new Error('GitHub API returned ' + res.status); e.code = 'http:' + res.status; throw e; }
      const data = GitHubAuth.parseJson(await res.text());
      if (!data.login) { const e = new Error('No login in response'); e.code = 'bad-response'; throw e; }
      return data.login;
    }
  };

  /* ---------- tiny DOM utils (self-contained; falls back if Util absent) ---------- */
  const ENT = { amp: '&' + 'amp;', lt: '&' + 'lt;', gt: '&' + 'gt;', quot: '&' + 'quot;', squot: '&' + '#39;' };
  function esc(s) {
    return (typeof Util !== 'undefined' && Util.escapeHtml)
      ? Util.escapeHtml(s)
      : String(s == null ? '' : s)
          .replace(/&/g, ENT.amp).replace(/</g, ENT.lt).replace(/>/g, ENT.gt)
          .replace(/"/g, ENT.quot).replace(/'/g, ENT.squot);
  }
  function h(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) { return false; }
    }
  }

  /* ---------- the lock screen ---------- */
  const GitHubGate = {
    _els: {},
    _polling: false,

    /** Gate applies on http(s) when enabled and an owner is configured. */
    applies() {
      if (typeof Store === 'undefined' || !Store.gateEnabled()) return false;
      const owner = Store.githubOwner();
      if (!owner) return false;
      const proto = (global.location && global.location.protocol) || '';
      return proto === 'http:' || proto === 'https:';
    },

    init() {
      if (!GitHubGate.applies()) return;             // APK / disabled / no owner
      const session = Store.gateSession();
      if (session && session.token) {
        GitHubGate._verifySession(session);
      } else {
        GitHubGate.lock();
      }
    },

    /** Re-check a stored session against the API; unlock or fall back to the lock. */
    async _verifySession(session) {
      GitHubGate.lock('Verifying your GitHub sign-in…');
      try {
        const login = await GitHubAuth.fetchLogin(session.token);
        if (GitHubAuth.isAllowedLogin(login, Store.githubOwner())) {
          Store.saveGateSession({ token: session.token, login, verifiedAt: Date.now() });
          GitHubGate.unlock();
          return;
        }
        Store.clearGateSession();
        GitHubGate.lock(null, login);
      } catch (e) {
        // Token revoked/expired or offline — keep the session? No: fail closed,
        // but if it looks like a network error, keep the session and unlock
        // rather than locking the owner out of their own data on a train.
        if (e.code === 'network') { GitHubGate.unlock(); return; }
        Store.clearGateSession();
        GitHubGate.lock(null, null);
      }
    },

    lock(busyMessage, deniedLogin) {
      let root = document.getElementById('gate-root');
      if (!root) { root = h('div'); root.id = 'gate-root'; document.body.appendChild(root); }
      const owner = Store.githubOwner();
      root.innerHTML = '';
      document.body.classList.add('gate-locked');

      const ov = h('div', 'gate');
      const card = h('div', 'gate-card');

      card.appendChild(h('div', 'gate-brand', '<span class="gate-logo">🛰️</span><div><b>JobPilot</b><small>private build</small></div>'));
      card.appendChild(h('h2', 'gate-title', '🔐 Exclusive access'));
      card.appendChild(h('p', 'gate-sub',
        'This app belongs to <b>@' + esc(owner) + '</b>. Sign in with the matching GitHub account to unlock — ' +
        'everything stays in your browser, the sign-in only proves who you are.'));

      // status / busy / denial line
      const status = h('div', 'gate-status' + (deniedLogin ? ' deny' : ''), '');
      if (busyMessage) status.textContent = busyMessage;
      else if (deniedLogin) status.innerHTML =
        '⛔ Access restricted — signed in as <b>@' + esc(deniedLogin) + '</b>, ' +
        'but this build only admits <b>@' + esc(owner) + '</b>. ' +
        'Switch accounts on <a href="' + GitHubAuth.DEVICE_ENTER_URL + '" target="_blank" rel="noopener">github.com/login/device</a> or below.';
      card.appendChild(status);

      /* --- method 1: Sign in with GitHub (Device Flow) --- */
      const clientId = (typeof Store !== 'undefined') ? Store.githubClientId() : '';
      const sec1 = h('div', 'gate-method');
      if (!clientId) {
        sec1.appendChild(h('div', 'gate-needid',
          '<label for="gate-client-id">GitHub OAuth App <b>Client ID</b> <small>(enables one-click sign-in — no secret needed)</small></label>' +
          '<div class="gate-id-row"><input id="gate-client-id" type="text" placeholder="Ov23li…" autocomplete="off" spellcheck="false">' +
          '<button id="gate-id-save" class="btn small" type="button">Save</button></div>' +
          '<p class="hint">Create one free at <a href="https://github.com/settings/developers" target="_blank" rel="noopener">github.com/settings/developers ↗</a> → ' +
          'New OAuth App → any homepage URL → tick <b>“Enable Device Flow”</b>. Or skip this and use a token below.</p>'));
      }
      const ghBtn = h('button', 'btn-github', 
        '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>' +
        '<span>Sign in with GitHub</span>');
      ghBtn.id = 'btn-gate-github';
      ghBtn.type = 'button';
      sec1.appendChild(ghBtn);
      const flowBox = h('div', 'gate-flow hidden');
      sec1.appendChild(flowBox);
      card.appendChild(sec1);

      /* --- divider + method 2: token paste --- */
      card.appendChild(h('div', 'gate-or', '<span>or</span>'));
      const sec2 = h('div', 'gate-method');
      sec2.appendChild(h('label', 'gate-token-label',
        'Unlock with a <b>Personal Access Token</b> <small>(classic, scope <code>read:user</code>)</small>'));
      const tokenRow = h('div', 'gate-id-row');
      const tokIn = h('input'); tokIn.type = 'password'; tokIn.id = 'gate-token';
      tokIn.placeholder = 'ghp_… / gho_… / github_pat_…';
      tokIn.autocomplete = 'off';
      tokenRow.appendChild(tokIn);
      const tokBtn = h('button', 'btn small primary', 'Unlock'); tokBtn.id = 'btn-gate-token'; tokBtn.type = 'button';
      tokenRow.appendChild(tokBtn);
      sec2.appendChild(tokenRow);
      sec2.appendChild(h('p', 'hint',
        'Create one at <a href="https://github.com/settings/tokens/new?scopes=read:user&description=JobPilot%20unlock" target="_blank" rel="noopener">github.com/settings/tokens ↗</a> — ' +
        'only the <code>read:user</code> scope is needed. The token stays in this browser and is sent only to api.github.com.'));
      card.appendChild(sec2);

      const foot = h('p', 'gate-foot',
        'Hosted build · verified via <code>api.github.com/user</code> · ' +
        '<a href="https://github.com/settings/apps/authorizations" target="_blank" rel="noopener">revoke access</a> anytime.');
      card.appendChild(foot);

      ov.appendChild(card);
      root.appendChild(ov);

      GitHubGate._els = { root, status, flowBox, ghBtn, tokIn, tokBtn, clientIdInput: () => document.getElementById('gate-client-id') };

      // wire events
      ghBtn.addEventListener('click', () => GitHubGate.startDeviceFlow());
      tokBtn.addEventListener('click', () => GitHubGate.unlockWithToken());
      tokIn.addEventListener('keydown', ev => { if (ev.key === 'Enter') GitHubGate.unlockWithToken(); });
      const saveBtn = document.getElementById('gate-id-save');
      if (saveBtn) saveBtn.addEventListener('click', () => GitHubGate.saveClientId());
    },

    /** Persist the Client ID typed on the lock screen, then enable the button. */
    saveClientId() {
      const input = GitHubGate._els.clientIdInput && GitHubGate._els.clientIdInput();
      if (!input) return;
      const id = String(input.value || '').trim();
      if (!id) { GitHubGate._setStatus('Paste the Client ID first (it looks like Ov23li…).', false); return; }
      Store.saveGithubClientId(id);
      GitHubGate._setStatus('✓ Client ID saved — one-click sign-in enabled.', false);
    },

    _setStatus(msg, isErr) {
      const s = GitHubGate._els.status;
      if (!s) return;
      s.classList.toggle('deny', !!isErr);
      s.classList.toggle('busy', !isErr && /…$/.test(msg));
      s.textContent = msg;
    },

    /** Device Flow: request code, show it, poll, verify, unlock. */
    async startDeviceFlow() {
      if (GitHubGate._polling) return;
      const clientId = Store.githubClientId();
      if (!clientId) { GitHubGate._setStatus('Add your OAuth App Client ID above first — or use a token below.', true); return; }

      const flow = GitHubGate._els.flowBox;
      flow.classList.remove('hidden');
      flow.innerHTML = '<div class="gate-flow-head">1 · Enter this code on <b>github.com/login/device</b></div>';
      GitHubGate._setStatus('Contacting GitHub…', false);
      GitHubGate._polling = true;
      GitHubGate._els.ghBtn.disabled = true;

      try {
        const result = await GitHubAuth.deviceFlow({
          clientId,
          onEvent(ev) {
            if (ev.type === 'code') {
              flow.innerHTML =
                '<div class="gate-flow-head">1 · Enter this code at</div>' +
                '<a class="gate-device-url" href="' + esc(ev.verification_uri) + '" target="_blank" rel="noopener">' + esc(ev.verification_uri) + ' ↗</a>' +
                '<div class="gate-code-row"><code class="gate-code">' + esc(ev.user_code) + '</code>' +
                '<button id="gate-code-copy" class="btn small" type="button">Copy</button></div>' +
                '<div class="gate-flow-head">2 · Authorize “JobPilot”, then wait here…</div>';
              const cp = document.getElementById('gate-code-copy');
              if (cp) cp.addEventListener('click', async () => {
                const ok = await copyText(ev.user_code);
                cp.textContent = ok ? 'Copied ✓' : 'Copy failed';
                setTimeout(() => { cp.textContent = 'Copy'; }, 1600);
              });
              GitHubGate._setStatus('Waiting for you to finish in the GitHub tab…', false);
            } else if (ev.type === 'status') {
              GitHubGate._setStatus(ev.message, false);
            }
          }
        });
        GitHubGate._setStatus('Verifying your GitHub identity…', false);
        const login = await GitHubAuth.fetchLogin(result.token);
        if (!GitHubAuth.isAllowedLogin(login, Store.githubOwner())) {
          Store.clearGateSession();
          GitHubGate.lock(null, login);
          return;
        }
        Store.saveGateSession({ token: result.token, login, verifiedAt: Date.now() });
        GitHubGate.unlock();
      } catch (e) {
        GitHubGate._polling = false;
        GitHubGate._els.ghBtn.disabled = false;
        const msgs = {
          config: 'GitHub rejected this Client ID — make sure the OAuth App has “Enable Device Flow” ticked.',
          denied: 'Authorization was cancelled on GitHub. Try again when ready.',
          expired: 'The code expired — start again.',
          network: 'Could not reach github.com from this browser (GitHub does not allow cross-site calls to this endpoint). Use the token method below — it always works.'
        };
        GitHubGate._setStatus(msgs[e.code] || ('Sign-in failed: ' + e.message), true);
        if (flow) flow.classList.add('hidden');
      }
    },

    /** Token method: paste PAT → verify → unlock. */
    async unlockWithToken() {
      const input = GitHubGate._els.tokIn;
      const token = String((input && input.value) || '').trim();
      if (!token) { GitHubGate._setStatus('Paste a Personal Access Token first.', true); return; }
      GitHubGate._setStatus('Verifying token with GitHub…', false);
      GitHubGate._els.tokBtn.disabled = true;
      try {
        const login = await GitHubAuth.fetchLogin(token);
        if (!GitHubAuth.isAllowedLogin(login, Store.githubOwner())) {
          Store.clearGateSession();
          GitHubGate.lock(null, login);
          return;
        }
        Store.saveGateSession({ token, login, verifiedAt: Date.now() });
        GitHubGate.unlock();
      } catch (e) {
        GitHubGate._els.tokBtn.disabled = false;
        GitHubGate._setStatus(
          e.code === 'unauthorized' ? 'GitHub rejected that token (401) — check it is valid and has read:user.'
          : e.code && e.code.indexOf('http:') === 0 ? 'GitHub API problem (' + e.code + ') — try again.'
          : 'Network error reaching api.github.com — try again.',
          true);
      }
    },

    unlock() {
      const root = document.getElementById('gate-root');
      if (root) root.innerHTML = '';
      document.body.classList.remove('gate-locked');
      GitHubGate._polling = false;
      GitHubGate._els = {};
    },

    /** Owner-invoked from Settings: forget the session and show the lock. */
    lockNow() {
      Store.clearGateSession();
      GitHubGate.lock('Locked. Sign in again to continue.');
    }
  };

  global.GitHubAuth = GitHubAuth;
  global.GitHubGate = GitHubGate;
})(typeof window !== 'undefined' ? window : globalThis);
