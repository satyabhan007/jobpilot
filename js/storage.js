/* ===== localStorage persistence ===== */
const Store = {
  K: {
    PROFILE: 'jobpilot.profile',
    SETTINGS: 'jobpilot.settings',
    SAVED: 'jobpilot.savedJobs',
    DISMISSED: 'jobpilot.dismissed',
    CACHE: 'jobpilot.cache',            // {sourceId: {ts, jobs:[]}}
    LAYA: 'jobpilot.layaVerdicts',      // {dedupeKey: {fp, lang, ts, ...ai verdict}}
    GMAIL: 'jobpilot.gmailMeta',        // legacy single-account {email}
    GMAIL_ACCOUNTS: 'jobpilot.gmailAccounts',  // multi-account: [email, ...]
    THEME: 'jobpilot.theme',            // 'dark' | 'light'
    GATE: 'jobpilot.gateSession',       // {token, login, verifiedAt} — GitHub identity
    GH_CLIENT_ID: 'jobpilot.githubClientId'    // Device Flow OAuth App Client ID
  },

  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  },

  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { console.warn('Store.set failed (quota?)', e); }
  },

  /* ---- profile ----
   * Defaults come from js/portfolio.js (the real profile from
   * satyabhan007.github.io). Anything saved in localStorage overrides it. */
  profile() {
    return Object.assign({}, PORTFOLIO_PROFILE, Store.get(Store.K.PROFILE, {}));
  },
  isPortfolioProfile() {
    const p = Store.get(Store.K.PROFILE, null);
    return p == null || Object.keys(p).length === 0;
  },
  saveProfile(p) { Store.set(Store.K.PROFILE, p); },
  resetToPortfolio() {
    Store.set(Store.K.PROFILE, Object.assign({}, PORTFOLIO_PROFILE));
    return Store.profile();
  },

  /* ---- settings (AI + gmail client id) ---- */
  settings() {
    return Object.assign({
      // Fall back to the pre-configured Client ID from portfolio.js
      gmailClientId: (typeof PORTFOLIO_PROFILE !== 'undefined' && PORTFOLIO_PROFILE.gmailClientId) || '',
      aiProvider: 'groq',
      aiConfigs: {
        'groq': { base: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', key: '' },
        'openrouter': { base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.1-8b-instruct:free', key: '' },
        'nvidia': { base: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct', key: '' },
        'deepseek': { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: '' },
        'custom': { base: '', model: '', key: '' }
      }
    }, Store.get(Store.K.SETTINGS, {}));
  },
  saveSettings(s) { Store.set(Store.K.SETTINGS, s); },

  /* ---- gmail multi-account email list ---- */
  gmailAccounts() { return Store.get(Store.K.GMAIL_ACCOUNTS, []); },
  saveGmailAccounts(list) { Store.set(Store.K.GMAIL_ACCOUNTS, list); },
  addGmailAccount(email) {
    const list = Store.gmailAccounts();
    if (!list.includes(email)) { list.push(email); Store.set(Store.K.GMAIL_ACCOUNTS, list); }
  },
  removeGmailAccount(email) {
    const list = Store.gmailAccounts().filter(e => e !== email);
    Store.set(Store.K.GMAIL_ACCOUNTS, list);
  },

  /* ---- theme ---- */
  theme() { return Store.get(Store.K.THEME, 'dark'); },
  saveTheme(t) { Store.set(Store.K.THEME, t === 'light' ? 'light' : 'dark'); },

  /* ---- private-access gate (GitHub identity) ----
   * Session = proof the visitor is the GitHub account holder. The token is
   * re-verified against api.github.com on every load and only ever sent to
   * GitHub. */
  gateSession() { return Store.get(Store.K.GATE, null); },
  saveGateSession(session) { Store.set(Store.K.GATE, session); },
  clearGateSession() { try { localStorage.removeItem(Store.K.GATE); } catch (e) {} },

  /* GitHub OAuth App Client ID (Device Flow). Falls back to the value
   * pre-configured in js/portfolio.js. */
  githubClientId() {
    const stored = Store.get(Store.K.GH_CLIENT_ID, '');
    if (stored) return stored;
    return (typeof PORTFOLIO_PROFILE !== 'undefined' && PORTFOLIO_PROFILE.githubClientId) || '';
  },
  saveGithubClientId(id) { Store.set(Store.K.GH_CLIENT_ID, String(id || '').trim()); },
  githubOwner() {
    return (typeof PORTFOLIO_PROFILE !== 'undefined' && PORTFOLIO_PROFILE.githubOwner) || '';
  },
  gateEnabled() {
    return !(typeof PORTFOLIO_PROFILE !== 'undefined' && PORTFOLIO_PROFILE.gateEnabled === false);
  },

  /* ---- saved jobs (full snapshots so they render without re-fetch) ---- */
  savedJobs() { return Store.get(Store.K.SAVED, []); },
  isSaved(id) { return Store.savedJobs().some(j => j.id === id); },
  toggleSaved(job) {
    const list = Store.savedJobs();
    const idx = list.findIndex(j => j.id === job.id);
    if (idx >= 0) { list.splice(idx, 1); Store.set(Store.K.SAVED, list); return false; }
    list.unshift(job); Store.set(Store.K.SAVED, list); return true;
  },

  /* ---- dismissed job ids ---- */
  dismissed() { return Store.get(Store.K.DISMISSED, []); },
  dismiss(id) {
    const d = Store.dismissed();
    if (!d.includes(id)) { d.push(id); Store.set(Store.K.DISMISSED, d); }
  },

  /* ---- Laya AI verdicts (cached per job, invalidated by profile fingerprint) ---- */
  layaVerdicts() { return Store.get(Store.K.LAYA, {}); },
  saveLayaVerdict(key, verdict) {
    const all = Store.layaVerdicts();
    all[key] = verdict;
    // prune to the newest 120 so localStorage never bloats
    const entries = Object.entries(all).sort((a, b) => ((b[1] && b[1].ts) || 0) - ((a[1] && a[1].ts) || 0));
    Store.set(Store.K.LAYA, Object.fromEntries(entries.slice(0, 120)));
  },
  layaVerdict(key) { return Store.layaVerdicts()[key] || null; },
  clearLayaVerdicts() { try { localStorage.removeItem(Store.K.LAYA); } catch (e) {} },

  /* ---- per-source cache of last successful fetch ---- */
  cacheGet(sourceId) { return Store.get(Store.K.CACHE, {})[sourceId] || null; },
  cacheSet(sourceId, jobs) {
    const all = Store.get(Store.K.CACHE, {});
    all[sourceId] = { ts: Date.now(), jobs };
    Store.set(Store.K.CACHE, all);
  },
  cacheAll() { return Store.get(Store.K.CACHE, {}); }
};
