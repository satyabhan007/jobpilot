/* ===== Gmail — multi-account via Google Identity Services (read-only, browser-side) =====
 *
 * Supports connecting MULTIPLE Gmail accounts with a single OAuth Client ID.
 * Each account gets its own access token stored in-memory (tokens are never
 * persisted to localStorage — they are short-lived and cannot safely be stored).
 * The list of connected account emails IS persisted so the sidebar can show
 * which accounts were active last session (they need a one-click re-auth on
 * page reload).
 *
 * One-time setup: create a Google OAuth Client ID (Web application) in the
 * Google Cloud Console with Authorized JS origin http://localhost:8000.
 * See README for the full walkthrough.
 */

const GmailClient = {

  SCOPE: 'https://www.googleapis.com/auth/gmail.readonly',

  /**
   * accounts: Map<email, { token, expiry }>
   * Populated in-memory when each account connects.
   */
  accounts: new Map(),

  /* ─── Connection state helpers ─── */

  isConnected() {
    return GmailClient.connectedEmails().length > 0;
  },

  connectedEmails() {
    const now = Date.now();
    return [...GmailClient.accounts.entries()]
      .filter(([, v]) => v.token && now < v.expiry)
      .map(([email]) => email);
  },

  /** Returns the token for a specific email, or null if not connected / expired. */
  tokenFor(email) {
    const acc = GmailClient.accounts.get(email);
    if (!acc || !acc.token || Date.now() >= acc.expiry) return null;
    return acc.token;
  },

  /* ─── Connect a single Gmail account ─── */

  /**
   * Opens the Google Account Chooser popup so the user can pick (or re-pick)
   * an account.  If `emailHint` is supplied the picker pre-selects that account
   * (useful for re-auth after a page reload).
   *
   * Resolves with the authenticated email address.
   */
  async connect(clientId, emailHint) {
    if (!clientId) throw new Error('Add your Google OAuth Client ID first');
    await GmailClient._loadGisScript();
    return new Promise((resolve, reject) => {
      try {
        const tc = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: GmailClient.SCOPE,
          hint: emailHint || '',        // pre-select account if we know the email
          callback: async (resp) => {
            if (resp.error) { reject(new Error(resp.error)); return; }
            try {
              const email = await GmailClient.registerToken(resp.access_token, resp.expires_in || 3600);
              resolve(email);
            } catch (e) { reject(e); }
          }
        });
        // prompt='select_account' always shows the account picker so the user
        // can add a DIFFERENT account each time (skip prompt only on re-auth).
        tc.requestAccessToken({ prompt: emailHint ? '' : 'select_account' });
      } catch (e) { reject(e); }
    });
  },

  /* ─── Login-link OAuth (redirect / implicit flow) ───
   *
   * Google's consent page opened as a normal navigation instead of a popup.
   * This is the easiest connection path when GIS popups are blocked (private
   * windows, some browsers/WebViews) AND it produces a link you can paste into
   * your phone's browser. Google redirects back to this page with
   * #access_token=… which handleRedirect() picks up automatically on load.  */

  AUTH_BASE: 'https://accounts.google.com/o/oauth2/v2/auth',
  _state: null,   // CSRF token for the redirect flow (one per generated link)

  /** True when the current page can run OAuth (needs http/https — not file://). */
  webOriginOk() {
    try {
      const p = window.location.protocol;
      return p === 'http:' || p === 'https:';
    } catch (e) { return false; }
  },

  /** The origin to register in Google Cloud (JS origin + redirect URI). */
  currentOrigin() {
    try { return window.location.origin || ''; } catch (e) { return ''; }
  },

  /**
   * Build the direct OAuth consent URL ("login link").  Pure — unit-tested.
   * state: pre-generated CSRF value (loginLink() generates one when omitted).
   */
  buildAuthUrl(clientId, origin, state) {
    if (!clientId) throw new Error('A Google OAuth Client ID is required');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: origin + '/',
      response_type: 'token',
      scope: GmailClient.SCOPE,
      include_granted_scopes: 'true',
      prompt: 'select_account',
      state: state || ''
    });
    return GmailClient.AUTH_BASE + '?' + params.toString();
  },

  /** Generate a fresh login link (new CSRF state each call). */
  loginLink(clientId) {
    GmailClient._state = 'jp' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    return GmailClient.buildAuthUrl(clientId, GmailClient.currentOrigin(), GmailClient._state);
  },

  /**
   * Parse the URL hash Google redirects back with.
   * Returns {access_token, expires_in, state, error} or null when absent.
   * Pure — unit-tested.
   */
  parseHash(hash) {
    if (!hash || hash.length < 2) return null;
    const raw = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    const params = new URLSearchParams(raw);
    if (!params.get('access_token') && !params.get('error')) return null;
    return {
      access_token: params.get('access_token') || '',
      expires_in: parseInt(params.get('expires_in') || '0', 10) || 0,
      state: params.get('state') || '',
      error: params.get('error') || ''
    };
  },

  /**
   * Call once on page load.  If Google redirected back with a token this
   * validates it, registers the account, cleans the URL and returns the email.
   * Returns null when this load is not an OAuth redirect.
   */
  async handleRedirect() {
    const parsed = GmailClient.parseHash(window.location.hash);
    if (!parsed) return null;
    // Clean the URL first so a refresh never re-processes the token.
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) { /* file:// may refuse — harmless */ }
    if (parsed.error) throw new Error(GmailClient.friendlyAuthError(parsed.error));
    if (!parsed.access_token) return null;
    // CSRF check: the state must be one we issued.
    if (GmailClient._state && parsed.state && parsed.state !== GmailClient._state) {
      throw new Error('OAuth state mismatch — please connect again');
    }
    return GmailClient.registerToken(parsed.access_token, parsed.expires_in || 3600);
  },

  /**
   * Validate an access token against the Gmail profile endpoint and store it
   * in the accounts map.  Shared by the GIS popup flow and the login-link flow.
   */
  async registerToken(token, expiresIn) {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) throw new Error(GmailClient.friendlyAuthError('HTTP ' + res.status));
    const profile = await res.json();
    const email = profile.emailAddress;
    GmailClient.accounts.set(email, {
      token,
      expiry: Date.now() + Math.max(60, (expiresIn || 3600) - 60) * 1000
    });
    return email;
  },

  /** Map common OAuth failures to a human message with the exact fix. */
  friendlyAuthError(code) {
    const c = String(code || '').toLowerCase();
    const origin = GmailClient.currentOrigin();
    if (c.includes('origin_mismatch') || c.includes('redirect_uri_mismatch'))
      return 'This site is not authorized for that Client ID. In Google Cloud → Credentials, add "' +
        (origin || 'http://localhost:8000') + '" under Authorized JavaScript origins and "' +
        (origin || 'http://localhost:8000') + '/" under Authorized redirect URIs.';
    if (c.includes('popup_closed') || c.includes('popup_failed') || c.includes('popup'))
      return 'The Google popup was closed or blocked. Allow popups for this site, or use the Login link button (no popup needed).';
    if (c.includes('access_denied') || c.includes('admin_policy') || c.includes('consent'))
      return 'Access was declined — add your Google account as a Test user on the OAuth consent screen.';
    if (c.includes('403') || c.includes('permission'))
      return 'Gmail API may be disabled for this Google Cloud project — enable it in APIs & Services → Library.';
    if (c.includes('401') || c.includes('invalid_grant') || c.includes('invalid'))
      return 'Token rejected (expired or wrong audience). Click Re-auth to get a fresh one.';
    if (c.includes('idpiframe') || c.includes('network') || c.includes('failed to fetch'))
      return 'Could not reach Google — check your connection, or use the Login link button.';
    return 'Google sign-in failed: ' + (code || 'unknown error');
  },

  /** Silently disconnect one account (revoke token + remove from map). */
  disconnect(email) {
    const acc = GmailClient.accounts.get(email);
    if (acc && acc.token && window.google && google.accounts) {
      try { google.accounts.oauth2.revoke(acc.token, () => {}); } catch (e) {}
    }
    GmailClient.accounts.delete(email);
  },

  /** Disconnect ALL connected accounts. */
  disconnectAll() {
    for (const email of [...GmailClient.accounts.keys()]) {
      GmailClient.disconnect(email);
    }
  },

  /* ─── Gmail API helpers ─── */

  async _api(email, path, params) {
    const token = GmailClient.tokenFor(email);
    if (!token) throw new Error('Gmail not connected for ' + email);
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me' + path + qs, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        const err = await res.json();
        if (err.error && err.error.message) msg = err.error.message;
      } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  },

  /* ─── Inbox scanning ─── */

  /**
   * Scan the inbox of a SINGLE account for job-related mail.
   * Returns an array of normalized lead objects.
   */
  async scanInboxFor(email, days, maxResults) {
    const lookback = Math.max(1, Math.min(180, days || 45));
    const cap = Math.max(5, Math.min(60, maxResults || 50));

    // AI/ML-specific query: subject terms + sender domains cover recruiters, platforms & direct outreach
    const q = 'newer_than:' + lookback + 'd (' +
      'subject:(' +
        'job OR hiring OR opportunity OR interview OR position OR opening OR recruiter OR application ' +
        'OR "AI engineer" OR "ML engineer" OR "LLM" OR "GenAI" OR "generative AI" ' +
        'OR "machine learning" OR "deep learning" OR "data scientist" OR "MLOps" ' +
        'OR "RAG" OR "LangChain" OR "Python engineer" OR "backend engineer"' +
      ')' +
      ' OR from:(' +
        'linkedin.com OR indeed.com OR glassdoor.com OR ziprecruiter.com ' +
        'OR naukri.com OR wellfound.com OR greenhouse.io OR lever.co ' +
        'OR workday.com OR smartrecruiters.com OR ashbyhq.com OR bamboohr.com ' +
        'OR remoteok.com OR himalayas.app OR remotive.com OR jobicy.com' +
      '))';

    const list = await GmailClient._api(email, '/messages', { q, maxResults: cap });
    const ids = (list.messages || []).map(m => m.id).slice(0, cap);

    const leads = [];
    for (let i = 0; i < ids.length; i += 6) {
      const chunk = ids.slice(i, i + 6);
      const msgs = await Promise.all(chunk.map(id =>
        GmailClient._api(email, '/messages/' + id, { format: 'full' }).catch(() => null)
      ));
      for (const msg of msgs) {
        if (msg) leads.push(GmailClient.parseEmail(msg, email));
      }
    }
    return leads;
  },

  /**
   * Scan ALL connected accounts and merge results.
   * onProgress(email, count) is called as each account completes.
   */
  async scanInbox(days, maxResults, onProgress) {
    const emails = GmailClient.connectedEmails();
    if (!emails.length) throw new Error('No Gmail accounts connected');

    const allLeads = [];
    await Promise.all(emails.map(async (email) => {
      const leads = await GmailClient.scanInboxFor(email, days, maxResults);
      leads.forEach(l => allLeads.push(l));
      if (onProgress) onProgress(email, leads.length);
    }));
    return allLeads;
  },

  /* ─── Email parsing ─── */

  /** Gmail API message → normalized lead.  accountEmail tags the source account. */
  parseEmail(msg, accountEmail) {
    const headers = (msg.payload && msg.payload.headers) || [];
    const get = (name) => {
      const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return h ? h.value : '';
    };
    const from = get('From');
    const subject = get('Subject') || '(no subject)';
    const dateStr = get('Date');
    const body = Util.extractTextFromPayload(msg.payload) || msg.snippet || '';

    // ---- guess company from sender domain ----
    const emailMatch = from.match(/<([^>]+)>/) || [null, from.trim()];
    const fromEmail = emailMatch[1] || from;
    const domain = (fromEmail.split('@')[1] || '').toLowerCase();
    const FREE_MAIL = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'protonmail.com'];
    const AGGREGATORS = /linkedin|indeed|glassdoor|ziprecruiter|naukri|workday|myworkdayjobs|greenhouse|lever\.co|smartrecruiters|ashbyhq|bamboohr/;
    let company = 'Unknown';
    if (domain && !FREE_MAIL.includes(domain) && !AGGREGATORS.test(domain)) {
      company = domain.split('.')[0].replace(/[-_]/g, ' ');
      company = company.charAt(0).toUpperCase() + company.slice(1);
    } else {
      const m = subject.match(/\b(?:at|with|from)\s+([A-Z][A-Za-z0-9&.\- ]{2,30})/);
      if (m) company = m[1].trim();
    }

    // ---- role guess ----
    let title = subject
      .replace(/^\s*(re|fwd?|fw)\s*:\s*/i, '')
      .replace(/\s*\[?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\]?/, '')
      .trim() || subject;

    const links = Util.extractLinks(body, 2);
    const lower = (subject + ' ' + body).toLowerCase();
    const postedAt = dateStr ? (new Date(dateStr).getTime() || Date.now()) : Date.now();

    return {
      id: 'gmail-' + msg.id,
      source: 'gmail',
      type: 'lead',
      title,
      company,
      location: '',
      remote: /remote|work from home|wfh/.test(lower),
      url: links[0] || '',
      extraLinks: links.slice(1),
      postedAt,
      from,
      accountEmail: accountEmail || null,   // ← which Gmail account found this
      snippet: Util.truncate(body, 220),
      description: Util.truncate(body, 3000)
    };
  },

  /* ─── GIS script loader ─── */

  _loadGisScript() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load Google Identity Services (offline?)'));
      document.head.appendChild(s);
    });
  }
};
