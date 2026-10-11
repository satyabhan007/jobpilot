/* ===== App controller — wires UI, sources, gmail, matcher, llm ===== */

const App = {
  PAGE_SIZE: 60,       // matches rendered per page (Show more loads the next page)
  state: {
    jobs: [],            // merged, normalized jobs from all sources
    matches: [],         // [{job, score, reasons, matchedSkills, aiScore, aiReason}]
    activeTab: 'matches',
    filters: { text: '', minScore: 0, source: 'all', remoteOnly: false, aiOnly: false, sort: 'score' },
    renderLimit: 60,     // pagination window into filteredMatches()
    scanning: false,
    demo: false,
    sourceStatus: {},    // {id: {ok, ts, count, error}}
    layaSort: 'priority',// decision-board ranking
    layaLang: 'en',      // dossier language for Laya AI ('en' | 'hi')
    dossier: null        // match currently open in the dossier modal
  },

  /* ================= init ================= */
  init() {
    App.applyTheme(Store.theme());
    App.loadProfileForm();
    App.loadSettingsForm();
    App.renderBoardRows();
    App.bindEvents();
    App.restoreCachedJobs();
    App.refreshGmailChip();
    App.updateCounts();
    App.renderAll();
    App.handleOAuthRedirect();   // picks up ?login-link returns (#access_token=…)
    App.renderGateIdentity();
    if (typeof GitHubGate !== 'undefined') GitHubGate.init();   // lock screen (hosted builds)
    if (!App.state.jobs.length) App.toast('Welcome! Fill your profile, then hit "Scan everything" — or try Demo data.');
  },

  /* ================= profile ================= */
  loadProfileForm() {
    const p = Store.profile();
    el('p-name').value = p.name || '';
    el('p-years').value = p.years != null ? p.years : '';
    el('p-skills').value = (p.skills || []).join(', ');
    el('p-roles').value = (p.roles || []).join(', ');
    el('p-locations').value = (p.locations || []).join(', ');
    el('p-remote').checked = !!p.remoteOk;
    App.renderProfileSummary();
  },

  saveProfileFromForm() {
    const p = Object.assign({}, PORTFOLIO_PROFILE, {
      name: el('p-name').value.trim(),
      years: Util.toInt(el('p-years').value),
      skills: el('p-skills').value.split(',').map(s => s.trim()).filter(Boolean),
      roles: el('p-roles').value.split(',').map(s => s.trim()).filter(Boolean),
      locations: el('p-locations').value.split(',').map(s => s.trim()).filter(Boolean),
      remoteOk: el('p-remote').checked
    });
    Store.saveProfile(p);
    App.renderProfileSummary();
    App.rematch();
    return p;
  },

  /* summary card fed by js/portfolio.js (satyabhan007.github.io) */
  renderProfileSummary() {
    const p = Store.profile();
    const L = p.links || PORTFOLIO_PROFILE.links || {};
    el('ps-avatar').textContent = p.initials || (p.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    el('ps-name').textContent = p.name || 'Unnamed profile';
    el('ps-headline').textContent = p.headline || '';
    el('ps-summary').textContent = p.summary || '';

    const chips = [
      (p.years != null ? p.years + '+ yrs' : null),
      (p.locations || []).slice(0, 2).map(Util.escapeHtml).join(' · ') || null,
      p.remoteOk ? 'remote ok' : null
    ].filter(Boolean);
    el('ps-chips').innerHTML = chips.map(c => '<span class="ps-chip">' + c + '</span>').join('');

    const links = [
      L.site ? ['site', L.site] : null,
      L.resume ? ['résumé ↓', L.resume] : null,
      L.github ? ['github ↗', L.github] : null,
      L.linkedin ? ['linkedin ↗', L.linkedin] : null,
      L.email ? ['✉ email', 'mailto:' + L.email] : null,
      L.phone ? ['✆ ' + L.phone, 'tel:' + String(L.phone).replace(/\s+/g, '')] : null
    ].filter(Boolean);
    el('ps-links').innerHTML = links.map(l =>
      '<a href="' + Util.escapeHtml(l[1]) + '" target="_blank" rel="noopener">' + l[0] + '</a>').join('');
  },

  resetProfile() {
    Store.resetToPortfolio();
    App.loadProfileForm();
    App.rematch();
    App.toast('Profile restored from satyabhan007.github.io');
  },

  /* ================= settings ================= */
  loadSettingsForm() {
    const s = Store.settings();
    el('g-client-id').value = s.gmailClientId || '';
    el('g-days').value = 45;
    
    // Load AI Provider settings
    el('ai-provider').value = s.aiProvider || 'groq';
    App.loadAiProviderForm(s.aiProvider || 'groq');

    // Smart Client ID row: hide when pre-configured, show badge instead
    App._refreshClientIdRow();
  },

  loadAiProviderForm(provider) {
    const s = Store.settings();
    const cfg = s.aiConfigs[provider] || { base: '', model: '', key: '' };
    el('ai-base').value = cfg.base || '';
    el('ai-model').value = cfg.model || '';
    el('ai-key').value = cfg.key || '';
    
    // Disable base/model inputs for known providers to avoid mistakes, keep enabled for custom
    const isCustom = provider === 'custom';
    el('ai-base').disabled = !isCustom;
    // We allow changing models for known providers since they update frequently, but base URL is fixed.
  },

  /** Show/hide the Client ID input field based on whether an ID is pre-configured. */
  _refreshClientIdRow() {
    const portfolioId  = (typeof PORTFOLIO_PROFILE !== 'undefined' && PORTFOLIO_PROFILE.gmailClientId) || '';
    const storedId     = Store.settings().gmailClientId || '';
    const effectiveId  = storedId || portfolioId;
    const row          = el('gmail-clientid-row');
    const sourceLabel  = el('gmail-clientid-source');
    const hint         = el('gmail-clientid-hint');

    if (effectiveId && !el('g-client-id')._forceShow) {
      // Pre-configured — collapse the input and show a compact badge
      row.classList.add('clientid-configured');
      const shortId = effectiveId.split('-')[0] + '-…';
      sourceLabel.innerHTML =
        ' — <span class="badge-ok">✓ configured</span> ' +
        '<a href="#" id="gmail-clientid-change" title="Override Client ID">(change)</a>';
      const changeLink = el('gmail-clientid-change');
      if (changeLink) {
        changeLink.addEventListener('click', (e) => {
          e.preventDefault();
          el('g-client-id')._forceShow = true;
          row.classList.remove('clientid-configured');
          sourceLabel.innerHTML = '';
          el('g-client-id').focus();
        }, { once: true });
      }
      hint.classList.add('hidden');
    } else {
      row.classList.remove('clientid-configured');
      hint.classList.remove('hidden');
      sourceLabel.innerHTML = '';
    }
  },

  saveSettingsFromForm() {
    const s = Store.settings();
    s.gmailClientId = el('g-client-id').value.trim();
    const provider = el('ai-provider').value;
    s.aiProvider = provider;
    
    if (!s.aiConfigs[provider]) s.aiConfigs[provider] = {};
    s.aiConfigs[provider].base = el('ai-base').value.trim();
    s.aiConfigs[provider].model = el('ai-model').value.trim();
    s.aiConfigs[provider].key = el('ai-key').value.trim();
    
    Store.saveSettings(s);
    return s;
  },

  /* ================= boards UI ================= */
  renderBoardRows() {
    const rows = el('board-rows');
    rows.innerHTML = '';
    const cache = Store.cacheAll();
    for (const src of JobSources.sources) {
      const st = App.state.sourceStatus[src.id];
      const cached = cache[src.id];
      const div = document.createElement('div');
      div.className = 'field row';
      div.style.justifyContent = 'space-between';
      div.style.marginBottom = '8px';
      div.innerHTML =
        '<div><b style="font-size:13px">' + Util.escapeHtml(src.name) + '</b><br>' +
        '<small>' + Util.escapeHtml(src.note) + '</small></div>' +
        '<span class="status ' + (st ? (st.ok ? 'on' : 'off') : (cached ? 'on' : 'off')) + '">' +
          (st ? (st.ok ? st.count + ' jobs' : 'failed') : (cached ? cached.jobs.length + ' cached' : 'idle')) +
        '</span>';
      rows.appendChild(div);
    }
  },

  /* ================= events ================= */
  bindEvents() {
    // tabs (top tab bar + bottom nav both go through setTab)
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => App.setTab(t.dataset.tab));
    });

    // profile — auto-save (debounced) and re-match
    ['p-name', 'p-years', 'p-skills', 'p-roles', 'p-locations', 'p-remote'].forEach(id => {
      el(id).addEventListener('input', Util_debounce(() => App.saveProfileFromForm(), 500));
      el(id).addEventListener('change', () => App.saveProfileFromForm());
    });
    el('btn-profile-reset').addEventListener('click', () => App.resetProfile());

    // settings — save on change
    ['g-client-id', 'ai-base', 'ai-model', 'ai-key'].forEach(id => {
      el(id).addEventListener('change', () => App.saveSettingsFromForm());
    });
    el('ai-provider').addEventListener('change', () => {
      // First save the current input to the PREVIOUS provider (the onchange of the select happens after value changes, 
      // but wait, we need to load the NEW provider config. So we actually should save on input, but since we just changed, 
      // the base/model/key fields still hold the OLD provider's values? No, the user changed the dropdown.
      // So we just load the new provider form. The old ones were saved on their own 'change' events.
      App.loadAiProviderForm(el('ai-provider').value);
      App.saveSettingsFromForm(); // saves the newly loaded provider as active
    });

    // scan everything
    el('btn-scan-all').addEventListener('click', () => App.scanAll());

    // boards only
    el('btn-boards-scan').addEventListener('click', () => App.scanBoardsOnly());

    // gmail — multi-account
    el('btn-gmail-add').addEventListener('click', () => App.addGmailAccount());
    el('btn-gmail-scan').addEventListener('click', () => App.scanGmailOnly());

    // gmail — one-click Google sign-in + login link + setup wizard
    el('btn-google-signin').addEventListener('click', () => App.signInGoogle());
    el('btn-gmail-login-link').addEventListener('click', () => App.copyLoginLink());
    el('btn-gmail-setup').addEventListener('click', () => App.openOAuthWizard());
    el('wiz-close').addEventListener('click', () => App.closeOAuthWizard());
    el('wiz-connect').addEventListener('click', () => App.connectFromWizard());
    el('wiz-copy-origin').addEventListener('click', () => App.copyText(el('wiz-origin').textContent, 'Origin copied — paste into "Authorized JavaScript origins"'));
    el('wiz-copy-redirect').addEventListener('click', () => App.copyText(el('wiz-redirect').textContent, 'Redirect URI copied — paste into "Authorized redirect URIs"'));
    el('wiz-copy-login-link').addEventListener('click', () => App.copyLoginLink());
    el('oauth-wizard').addEventListener('click', (ev) => { if (ev.target.id === 'oauth-wizard') App.closeOAuthWizard(); });

    // demo
    el('btn-demo').addEventListener('click', () => App.toggleDemo());
    document.querySelectorAll('[data-empty-act]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.emptyAct === 'scan') App.scanAll();
        else App.toggleDemo();
      });
    });

    // ai rerank
    el('btn-ai-rerank').addEventListener('click', () => App.aiRerank());

    // filters (each resets the "show more" pagination)
    el('f-text').addEventListener('input', Util_debounce(() => {
      App.state.filters.text = el('f-text').value.trim().toLowerCase();
      App.state.renderLimit = App.PAGE_SIZE;
      App.renderAll();
    }, 250));
    el('f-minscore').addEventListener('input', () => {
      App.state.filters.minScore = Util.toInt(el('f-minscore').value) || 0;
      el('f-minscore-val').textContent = el('f-minscore').value;
      App.state.renderLimit = App.PAGE_SIZE;
      App.renderAll();
    });
    el('f-source').addEventListener('change', () => {
      App.state.filters.source = el('f-source').value;
      App.state.renderLimit = App.PAGE_SIZE;
      App.renderAll();
    });
    el('f-remote').addEventListener('change', () => {
      App.state.filters.remoteOnly = el('f-remote').checked;
      App.state.renderLimit = App.PAGE_SIZE;
      App.renderAll();
    });
    el('f-ai').addEventListener('change', () => {
      App.state.filters.aiOnly = el('f-ai').checked;
      App.state.renderLimit = App.PAGE_SIZE;
      App.renderAll();
    });
    el('f-sort').addEventListener('change', () => {
      App.state.filters.sort = el('f-sort').value;
      App.state.renderLimit = App.PAGE_SIZE;
      App.renderAll();
    });

    App.bindExtraUI();
  },

  /* ============ private-access gate (GitHub identity) ============ */
  /** Settings card: who is verified, and whether the gate is active here. */
  renderGateIdentity() {
    const box = el('gate-identity');
    const badge = el('gate-badge');
    const ownerEl = el('gate-owner-name');
    if (!box) return;
    const owner = (typeof Store !== 'undefined' && Store.githubOwner()) || '';
    if (ownerEl) ownerEl.textContent = owner || '(not configured)';
    const active = typeof GitHubGate !== 'undefined' && GitHubGate.applies();

    const session = (typeof Store !== 'undefined') ? Store.gateSession() : null;
    const who = session && session.login
      ? '@' + Util.escapeHtml(session.login)
      : null;

    if (badge) {
      badge.textContent = active ? (session ? 'protected ✓' : 'armed') : 'off here';
      badge.className = 'status ' + (session ? 'on' : 'busy');
    }
    if (active) {
      box.classList.toggle('ok', !!session);
      box.innerHTML =
        '<span class="gi-dot"></span>' +
        (session
          ? '<div><b>' + who + '</b> verified<small>Token re-checked against api.github.com on every load</small></div>'
          : '<div><b>Locked</b><small>Reload to see the sign-in screen, or lock now to test it</small></div>');
    } else {
      box.classList.remove('ok');
      box.innerHTML =
        '<span class="gi-dot"></span>' +
        '<div><b>Gate inactive on this origin</b>' +
        '<small>file:// builds (the APK) and disabled configs stay unlocked — hosting on GitHub Pages arms it automatically</small></div>';
    }
  },

  /* ============ extra UI: drawer, theme, collapsibles, nav, shortcuts ============ */
  bindExtraUI() {
    // theme toggle
    el('btn-theme').addEventListener('click', () => {
      const next = document.body.classList.contains('light') ? 'dark' : 'light';
      App.applyTheme(next);
      Store.saveTheme(next);
      App.toast('Theme: ' + next);
    });

    // mobile drawer
    el('btn-menu').addEventListener('click', () => App.openDrawer(true));
    el('btn-drawer-close').addEventListener('click', () => App.openDrawer(false));
    el('drawer-overlay').addEventListener('click', () => App.openDrawer(false));
    el('bn-setup').addEventListener('click', () => App.openDrawer(true));

    // private-access gate
    if (el('btn-gate-lock')) el('btn-gate-lock').addEventListener('click', () => {
      if (typeof GitHubGate === 'undefined') { App.toast('Gate module not loaded', true); return; }
      if (!GitHubGate.applies()) { App.toast('Gate is off for local file:// builds (the APK)'); return; }
      GitHubGate.lockNow();
    });
    if (el('btn-gate-recheck')) el('btn-gate-recheck').addEventListener('click', async () => {
      if (typeof GitHubGate === 'undefined' || typeof GitHubAuth === 'undefined') { App.toast('Gate module not loaded', true); return; }
      const session = Store.gateSession();
      if (!session || !session.token) { App.toast('No session yet — lock the app and sign in first', true); return; }
      App.toast('Verifying session with GitHub…');
      try {
        const login = await GitHubAuth.fetchLogin(session.token);
        if (GitHubAuth.isAllowedLogin(login, Store.githubOwner())) {
          Store.saveGateSession({ token: session.token, login, verifiedAt: Date.now() });
          App.renderGateIdentity();
          App.toast('✓ Session verified — signed in as @' + login);
        } else {
          Store.clearGateSession();
          App.renderGateIdentity();
          App.toast('Signed in as @' + login + ' — not the owner. Session cleared.', true);
        }
      } catch (e) {
        App.toast('Verification failed: ' + e.message, true);
      }
    });

    // bottom nav tabs
    el('bn-matches').addEventListener('click', () => { App.openDrawer(false); App.setTab('matches'); });
    el('bn-laya').addEventListener('click', () => { App.openDrawer(false); App.setTab('laya'); });
    el('bn-saved').addEventListener('click', () => { App.openDrawer(false); App.setTab('saved'); });

    // Laya decision board
    el('laya-sort').addEventListener('change', () => {
      App.state.layaSort = el('laya-sort').value;
      App.renderLaya();
    });
    el('btn-laya-ai').addEventListener('click', () => App.runLayaAI());
    el('dossier-close').addEventListener('click', () => App.closeDossier());
    el('job-dossier').addEventListener('click', (ev) => {
      if (ev.target.id === 'job-dossier') App.closeDossier();
    });

    // collapsible sidebar cards (head click or Enter/Space)
    document.querySelectorAll('.collapsible').forEach(cardEl => {
      const head = cardEl.querySelector('.card-head');
      head.addEventListener('click', (e) => {
        if (e.target.closest('a, button:not(.card-toggle), input, select')) return;
        cardEl.classList.toggle('collapsed');
        head.setAttribute('aria-expanded', String(!cardEl.classList.contains('collapsed')));
      });
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); }
      });
    });

    // show more pagination
    el('btn-show-more').addEventListener('click', () => {
      App.state.renderLimit += App.PAGE_SIZE;
      App.renderAll();
      el('matches').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // keyboard: "/" focuses search, Esc closes drawer / clears search
    document.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        el('f-text').focus();
        el('f-text').select();
      } else if (e.key === 'Escape') {
        if (!el('job-dossier').classList.contains('hidden')) { App.closeDossier(); return; }
        if (el('sidebar').classList.contains('open')) App.openDrawer(false);
        else if (document.activeElement === el('f-text')) {
          el('f-text').value = '';
          App.state.filters.text = '';
          App.renderAll();
          el('f-text').blur();
        }
      }
    });
  },

  applyTheme(theme) {
    document.body.classList.toggle('light', theme === 'light');
    const btn = el('btn-theme');
    if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  },

  openDrawer(open) {
    el('sidebar').classList.toggle('open', !!open);
    el('drawer-overlay').classList.toggle('show', !!open);
    document.body.style.overflow = open ? 'hidden' : '';
  },

  setTab(name) {
    App.state.activeTab = name;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    ['bn-matches', 'bn-laya', 'bn-saved'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.toggle('active', id === 'bn-' + name);
    });
    App.renderAll();
  },

  /** Show/hide the three content views + their chrome (called from renderAll). */
  applyView() {
    const t = App.state.activeTab;
    el('matches').classList.toggle('hidden', t !== 'matches');
    el('laya').classList.toggle('hidden', t !== 'laya');
    el('saved').classList.toggle('hidden', t !== 'saved');
    el('filter-bar').classList.toggle('hidden', t === 'laya');
    el('stats-bar').classList.toggle('hidden', t === 'laya');
    const hasData = App.state.matches.length > 0;
    el('empty-state').classList.toggle('hidden', t !== 'matches' || hasData || App.state.scanning);
    el('skeletons').classList.toggle('hidden', !(t === 'matches' && !hasData && App.state.scanning));
    el('btn-show-more').classList.toggle('hidden', t !== 'matches' ||
      App.filteredMatches().length <= App.state.renderLimit);
  },

  /* ================= scanning ================= */
  async scanAll() {
    if (App.state.scanning) return;
    App.state.scanning = true;
    const btn = el('btn-scan-all');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">◌</span> Scanning…';
    App.renderAll(); // show skeletons over the empty grid
    App.log('— scan started —');

    try {
      // boards in parallel
      const boardPromise = JobSources.fetchAll((src, result) => {
        App.state.sourceStatus[src.id] = {
          ok: result.ok,
          count: result.jobs.length,
          error: result.error,
          ts: result.ts
        };
        if (result.ok) {
          Store.cacheSet(src.id, result.jobs);
          App.log('✔ ' + src.name + ': ' + result.jobs.length + ' jobs');
        } else {
          App.log('✖ ' + src.name + ': ' + result.error, true);
        }
        App.renderBoardRows();
      });

      // gmail if any account connected
      let gmailPromise = Promise.resolve([]);
      if (GmailClient.isConnected()) {
        const days = Util.toInt(el('g-days').value) || 45;
        gmailPromise = GmailClient.scanInbox(days, 40, (email, count) => {
          App.log('✔ Gmail (' + email + '): ' + count + ' job emails');
        }).catch(e => { App.log('✖ Gmail: ' + e.message, true); return []; });
      } else {
        App.log('ℹ Gmail not connected — skipping (add an account in the sidebar)');
      }

      const [boardJobs, gmailLeads] = await Promise.all([boardPromise, gmailPromise]);
      App.mergeJobs(boardJobs, gmailLeads);
      App.rematch();
      App.toast('Scan complete — ' + App.state.jobs.length + ' unique items, ' +
        App.matchesCount() + ' matches for you');
    } finally {
      App.state.scanning = false;
      btn.disabled = false;
      btn.innerHTML = '⚡ Scan everything';
      App.refreshBoardsChip();
      App.updateCounts();
      App.renderAll(); // clear skeletons even if everything failed
    }
  },

  async scanBoardsOnly() {
    if (App.state.scanning) return;
    App.state.scanning = true;
    const btn = el('btn-boards-scan');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">◌</span> Fetching…';
    App.renderAll(); // show skeletons over the empty grid
    try {
      const jobs = await JobSources.fetchAll((src, result) => {
        App.state.sourceStatus[src.id] = {
          ok: result.ok, count: result.jobs.length, error: result.error, ts: result.ts
        };
        if (result.ok) { Store.cacheSet(src.id, result.jobs); App.log('✔ ' + src.name + ': ' + result.jobs.length + ' jobs'); }
        else App.log('✖ ' + src.name + ': ' + result.error, true);
        App.renderBoardRows();
      });
      App.mergeJobs(jobs, null);
      App.rematch();
      App.toast('Boards fetched — ' + App.state.jobs.length + ' unique items');
    } finally {
      App.state.scanning = false;
      btn.disabled = false;
      btn.innerHTML = '🌐 Fetch boards';
      App.refreshBoardsChip();
      App.updateCounts();
      App.renderAll();
    }
  },

  async scanGmailOnly() {
    if (!GmailClient.isConnected()) { App.toast('Connect a Gmail account first', true); return; }
    const btn = el('btn-gmail-scan');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">◌</span> Scanning…';
    try {
      const days = Util.toInt(el('g-days').value) || 45;
      const leads = await GmailClient.scanInbox(days, 40, (email, count) => {
        App.log('✔ Gmail (' + email + '): ' + count + ' job emails');
      });
      App.mergeJobs(null, leads);
      App.rematch();
      App.toast('Gmail scanned — ' + leads.length + ' job emails found across ' +
        GmailClient.connectedEmails().length + ' account(s)');
    } catch (e) {
      App.log('✖ Gmail: ' + e.message, true);
      App.toast('Gmail scan failed: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '📥 Scan all inboxes';
    }
  },

  /* ================= one-click Google sign-in ================= */

  /** Best available Client ID: an unsaved wizard entry wins over settings. */
  _clientId() {
    const wiz = el('wiz-client-id');
    const fromWizard = wiz && wiz.value.trim();
    if (fromWizard && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(fromWizard)) return fromWizard;
    return (Store.settings().gmailClientId || '').trim();
  },

  /**
   * THE easy path: one button → Google account picker → connected.
   * Falls back automatically to the login-link redirect when the popup is
   * blocked, and opens the setup wizard when no Client ID is configured.
   */
  async signInGoogle() {
    const clientId = App._clientId();
    if (!clientId) { App.openOAuthWizard(); return; }
    if (!GmailClient.webOriginOk()) {
      App.toast('Google sign-in needs a web origin (http://localhost:8000) — file:// (APK) can use board data + demo, or run the web app in a browser', true);
      return;
    }
    const btn = el('btn-google-signin');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const email = await GmailClient.connect(clientId, /* picker */ null);
      Store.addGmailAccount(email);
      App.refreshGmailChip();
      App.toast('✓ Gmail connected — ' + email);
      App.log('✔ Gmail connected: ' + email);
    } catch (e) {
      const raw = String((e && e.message) || e);
      App.log('✖ Google sign-in: ' + raw, true);
      const em = raw.toLowerCase();
      if (em.includes('popup')) {
        App.toast('Popup blocked — switching to the login link…');
        App.useLoginLink();          // top-level redirect, no popup needed
        return;
      }
      App.toast(GmailClient.friendlyAuthError(raw), true);
      if (em.includes('origin') || em.includes('client') || em.includes('invalid')) App.openOAuthWizard();
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  },

  /** Redirect the whole tab to Google's consent screen (the "login link"). */
  useLoginLink() {
    const clientId = App._clientId();
    if (!clientId) { App.openOAuthWizard(); return; }
    try { window.location.assign(GmailClient.loginLink(clientId)); }
    catch (e) { App.toast('Could not open the login link: ' + e.message, true); }
  },

  /** Copy the login link so it can be pasted into another browser / phone. */
  copyLoginLink() {
    const clientId = App._clientId();
    if (!clientId) { App.openOAuthWizard(); return; }
    if (!GmailClient.webOriginOk()) {
      App.toast('The login link needs a web origin — run the app at http://localhost:8000 first', true);
      return;
    }
    App.copyText(GmailClient.loginLink(clientId), 'Login link copied — paste it in any browser and sign in');
  },

  /** Called on page load: completes a login-link redirect if one came back. */
  async handleOAuthRedirect() {
    if (!window.location || !window.location.hash) return;
    try {
      const email = await GmailClient.handleRedirect();
      if (email) {
        Store.addGmailAccount(email);
        App.refreshGmailChip();
        App.toast('✓ Gmail connected — ' + email);
        App.log('✔ Gmail connected via login link: ' + email);
      }
    } catch (e) {
      App.toast(GmailClient.friendlyAuthError(e.message || e), true);
      App.log('✖ OAuth redirect: ' + (e.message || e), true);
    }
  },

  /* ---- setup wizard ---- */

  openOAuthWizard() {
    const origin = GmailClient.currentOrigin() || 'http://localhost:8000';
    el('wiz-origin').textContent = origin;
    el('wiz-redirect').textContent = origin + '/';
    el('wiz-client-id').value = Store.settings().gmailClientId || '';
    el('oauth-wizard').classList.remove('hidden');
    setTimeout(() => el('wiz-client-id').focus(), 60);
  },

  closeOAuthWizard() {
    el('oauth-wizard').classList.add('hidden');
  },

  /** Validate + save the Client ID from the wizard, then connect immediately. */
  async connectFromWizard() {
    const id = el('wiz-client-id').value.trim();
    if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(id)) {
      App.toast('That does not look like a Client ID — it should end in .apps.googleusercontent.com', true);
      return;
    }
    const s = Store.settings();
    s.gmailClientId = id;
    Store.saveSettings(s);
    el('g-client-id').value = id;     // keep the (hidden) field in sync
    App._refreshClientIdRow();
    App.closeOAuthWizard();
    App.toast('Client ID saved — connecting…');
    await App.signInGoogle();
  },

  /** Clipboard helper with a fallback for non-secure contexts. */
  copyText(text, okMsg) {
    const done = () => App.toast(okMsg || 'Copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        window.prompt('Press Ctrl+C, then Enter:', text); done();
      });
    } else {
      window.prompt('Press Ctrl+C, then Enter:', text); done();
    }
  },

  /* ================= gmail multi-account ================= */

  /** Add a new Gmail account (shows Google account picker). */
  async addGmailAccount() {
    const s = App.saveSettingsFromForm();
    const btn = el('btn-gmail-add');
    if (!s.gmailClientId) { App.openOAuthWizard(); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">◌</span> Connecting…';
    try {
      const email = await GmailClient.connect(s.gmailClientId, /* hint */ null);
      Store.addGmailAccount(email);
      App.refreshGmailChip();
      App.toast('Connected: ' + email + ' — hit "Scan all inboxes" to import leads');
    } catch (e) {
      const msg = GmailClient.friendlyAuthError(e.message || e);
      App.toast(msg, true);
      App.log('✖ Gmail connect: ' + (e.message || e), true);
      if (/popup/i.test(e.message || '')) App.useLoginLink();
    } finally {
      btn.disabled = false;
      btn.innerHTML = '＋ Add another account';
      App.refreshGmailChip();
    }
  },

  /** Re-authenticate a known account (no picker, silent re-auth). */
  async reAuthGmailAccount(email) {
    const s = Store.settings();
    if (!s.gmailClientId) { App.openOAuthWizard(); return; }
    try {
      const got = await GmailClient.connect(s.gmailClientId, email);
      App.refreshGmailChip();
      App.toast('Re-authenticated: ' + got);
    } catch (e) {
      App.toast(GmailClient.friendlyAuthError(e.message || e), true);
    }
  },

  /** Remove and revoke one Gmail account. */
  removeGmailAccount(email) {
    GmailClient.disconnect(email);
    Store.removeGmailAccount(email);
    App.refreshGmailChip();
    App.toast('Removed: ' + email);
  },

  refreshGmailChip() {
    const chip = el('gmail-chip');
    const status = el('gmail-status');
    const connected = GmailClient.connectedEmails();
    const savedList = Store.gmailAccounts();

    // Update topbar chip
    if (connected.length > 0) {
      chip.textContent = '🟢 Gmail: ' + connected.length + ' account' + (connected.length > 1 ? 's' : '');
      chip.classList.add('on');
      status.textContent = connected.length + ' connected';
      status.className = 'status on';
    } else if (savedList.length > 0) {
      chip.textContent = '🟡 Gmail: ' + savedList.length + ' saved (need re-auth)';
      chip.classList.remove('on');
      status.textContent = 'token expired';
      status.className = 'status off';
    } else {
      chip.textContent = '⚫ Gmail: not connected';
      chip.classList.remove('on');
      status.textContent = 'not connected';
      status.className = 'status off';
    }

    // Render per-account rows
    const list = el('gmail-accounts-list');
    list.innerHTML = '';

    // Merge: in-memory connected + saved (for re-auth)
    const allEmails = [...new Set([...connected, ...savedList])];
    for (const email of allEmails) {
      const isLive = connected.includes(email);
      const row = document.createElement('div');
      row.className = 'gmail-account-row';
      row.innerHTML =
        '<span class="acct-dot' + (isLive ? '' : ' expired') + '"></span>' +
        '<span class="acct-email" title="' + Util.escapeHtml(email) + '">' + Util.escapeHtml(email) + '</span>' +
        '<span class="acct-status">' + (isLive ? 'active' : 'expired') + '</span>' +
        (isLive ? '' : '<button class="btn-reauth" data-email="' + Util.escapeHtml(email) + '">Re-auth</button>') +
        '<button class="btn-remove" data-email="' + Util.escapeHtml(email) + '">✕ Remove</button>';
      row.querySelectorAll('.btn-reauth').forEach(b =>
        b.addEventListener('click', () => App.reAuthGmailAccount(b.dataset.email))
      );
      row.querySelectorAll('.btn-remove').forEach(b =>
        b.addEventListener('click', () => App.removeGmailAccount(b.dataset.email))
      );
      list.appendChild(row);
    }

    // Enable Scan button if any account is live
    el('btn-gmail-scan').disabled = connected.length === 0;
  },

  refreshBoardsChip() {
    const chip = el('boards-chip');
    const ok = Object.values(App.state.sourceStatus).filter(s => s.ok);
    const total = ok.reduce((a, s) => a + s.count, 0);
    if (total) { chip.textContent = '🟢 Boards: ' + total + ' jobs'; chip.classList.add('on'); }
    else { chip.textContent = '⚫ Boards: idle'; chip.classList.remove('on'); }
  },

  /* ================= demo ================= */
  toggleDemo() {
    App.state.demo = !App.state.demo;
    const btn = el('btn-demo');
    btn.classList.toggle('active-demo', App.state.demo);
    if (App.state.demo) {
      App.mergeJobs(DEMO_JOBS.slice(), DEMO_EMAILS.slice());
      App.rematch();
      App.toast('Demo data loaded — ' + App.state.jobs.length + ' items. Hit "Demo data" again to clear.');
      App.log('✔ Demo data loaded (' + DEMO_JOBS.length + ' jobs, ' + DEMO_EMAILS.length + ' emails)');
    } else {
      App.state.jobs = [];
      App.state.matches = [];
      App.rematch();
      App.toast('Demo data cleared');
    }
    App.updateCounts();
  },

  /* ================= merge + match ================= */
  mergeJobs(boardJobs, gmailLeads) {
    const seen = {};
    const out = [];
    const add = (job) => {
      if (!job || !job.title) return;
      const key = Util.dedupeKey(job.title, job.company);
      if (seen[key]) return;
      seen[key] = true;
      out.push(job);
    };
    if (boardJobs) boardJobs.forEach(add);
    if (gmailLeads) gmailLeads.forEach(add);
    if (boardJobs != null && gmailLeads == null) {
      // keep existing gmail leads when only boards were re-fetched
      App.state.jobs.filter(j => j.source === 'gmail').forEach(add);
    }
    if (boardJobs == null && gmailLeads != null) {
      // keep existing board jobs when only gmail was re-scanned
      App.state.jobs.filter(j => j.source !== 'gmail').forEach(add);
    }
    App.state.jobs = out;
  },

  rematch() {
    const profile = Store.profile();
    App.state.matches = App.state.jobs.map(job => {
      const scored = Matcher.score(profile, job);
      return {
        job,
        score: scored.score,
        reasons: scored.reasons,
        matchedSkills: scored.matchedSkills
      };
    });
    App.renderAll();
    App.updateCounts();
  },

  matchesCount() {
    return App.state.matches.filter(m => m.score > 0).length;
  },

  restoreCachedJobs() {
    const cache = Store.cacheAll();
    const jobs = [];
    for (const src of JobSources.sources) {
      const c = cache[src.id];
      if (c && Array.isArray(c.jobs)) {
        jobs.push(...c.jobs);
        App.state.sourceStatus[src.id] = { ok: true, count: c.jobs.length, ts: c.ts };
      }
    }
    if (jobs.length) {
      App.mergeJobs(jobs, null);
      App.log('✔ Restored cached jobs from last scan');
      App.refreshBoardsChip();
    }
  },

  /* ================= AI ================= */
  async aiRerank() {
    const s = App.saveSettingsFromForm();
    if (!LLM.hasKey(s)) { App.toast('Add an API key first (Setup → AI re-ranking)', true); return; }
    const top = App.state.matches
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
    if (!top.length) { App.toast('Scan or load Demo data first — nothing to re-rank', true); return; }

    const btn = el('btn-ai-rerank');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">◌</span> Thinking…';
    try {
      const results = await LLM.rerank(Store.profile(), top, s);
      const byId = {};
      results.forEach(r => { byId[r.id] = r; });
      App.state.matches.forEach(m => {
        const r = byId[m.job.id];
        if (r) { m.aiScore = r.score; m.aiReason = r.reason; }
      });
      App.renderAll();
      App.toast('AI re-ranked ' + results.length + ' jobs');
      App.log('✔ AI re-ranked ' + results.length + ' jobs');
    } catch (e) {
      App.toast(e.message, true);
      App.log('✖ AI: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '✨ Re-rank top matches';
    }
  },

  /* ================= rendering ================= */
  renderAll() {
    App.renderMatches();
    App.renderSaved();
    App.renderLaya();
    App.applyView();
  },

  filteredMatches() {
    const f = App.state.filters;
    let list = App.state.matches.slice();
    if (f.text) {
      list = list.filter(m =>
        (m.job.title + ' ' + m.job.company + ' ' + (m.job.description || '')).toLowerCase().includes(f.text));
    }
    if (f.source !== 'all') list = list.filter(m => m.job.source === f.source);
    if (f.remoteOnly) list = list.filter(m => m.job.remote);
    if (f.aiOnly) {
      // Mirror the AI_KEYWORDS filter from jobs.js for post-scan filtering
      const AI_KW = ['ai', 'ml', 'machine learning', 'llm', 'genai', 'generative', 'nlp',
        'rag', 'langchain', 'mlops', 'data science', 'data engineer', 'python', 'pytorch',
        'deep learning', 'transformer', 'vllm', 'vertex', 'embeddings', 'model', 'inference',
        'fine-tun', 'vector', 'platform engineer', 'backend', 'devops', 'cloud'];
      list = list.filter(m => {
        const hay = (m.job.title + ' ' + (m.job.description || '') + ' ' +
          (Array.isArray(m.job.tags) ? m.job.tags.join(' ') : '')).toLowerCase();
        return AI_KW.some(kw => hay.includes(kw));
      });
    }
    const sortKey = m => (m.aiScore != null ? m.aiScore : m.score);
    if (f.sort === 'new') list.sort((a, b) => (b.job.postedAt || 0) - (a.job.postedAt || 0));
    else list.sort((a, b) => sortKey(b) - sortKey(a));
    if (f.minScore > 0) list = list.filter(m => sortKey(m) >= f.minScore);
    return list.slice(0, 300);
  },

  renderMatches() {
    const wrap = el('matches');
    const empty = el('empty-state');
    const skel = el('skeletons');
    const more = el('btn-show-more');
    wrap.innerHTML = '';
    const list = App.filteredMatches();

    // empty + skeleton states
    const hasData = App.state.matches.length > 0;
    empty.classList.toggle('hidden', hasData || App.state.scanning);
    skel.classList.toggle('hidden', !(!hasData && App.state.scanning));
    if (!hasData && App.state.scanning && !skel.children.length) App.renderSkeletons(skel, 6);

    // paginated render
    const page = list.slice(0, App.state.renderLimit);
    for (const m of page) wrap.appendChild(App.jobCard(m, false));
    more.classList.toggle('hidden', list.length <= page.length);
    more.textContent = 'Show ' + Math.min(App.PAGE_SIZE, list.length - page.length) + ' more of ' +
      (list.length - page.length) + ' ↓';
  },

  renderSkeletons(skel, n) {
    skel.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'sk-card';
      c.innerHTML =
        '<div class="sk-row"><div class="sk sk-ava"></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:7px">' +
        '<div class="sk sk-line w80"></div><div class="sk sk-line w40"></div></div></div>' +
        '<div class="sk sk-line w60"></div><div class="sk sk-line w30"></div>' +
        '<div class="sk-row" style="justify-content:flex-end"><div class="sk sk-line w30" style="height:30px"></div></div>';
      skel.appendChild(c);
    }
  },

  renderSaved() {
    const wrap = el('saved');
    wrap.innerHTML = '';
    const saved = Store.savedJobs();
    for (const job of saved) {
      const scored = Matcher.score(Store.profile(), job);
      wrap.appendChild(App.jobCard({
        job,
        score: scored.score,
        reasons: scored.reasons,
        matchedSkills: scored.matchedSkills
      }, true));
    }
  },

  jobCard(m, inSaved) {
    const job = m.job;
    const card = document.createElement('div');
    card.className = 'job-card' + (m.score >= 70 ? ' fit-hi' : '');

    const score = m.aiScore != null ? m.aiScore : m.score;
    const cls = score >= 70 ? 'hi' : score >= 40 ? 'mid' : 'lo';
    const scoreTitle = m.aiScore != null ? 'AI re-ranked score' : 'match score for your profile';

    const srcName = job.source === 'gmail' ? 'Gmail' :
      (JobSources.sources.find(s => s.id === job.source) || { name: job.source }).name;

    const coInitial = (String(job.company || '?').trim()[0] || '?').toUpperCase();

    const meta = [];
    if (job.type === 'lead') meta.push('<span class="tag src-gmail">📧 lead</span>');
    meta.push('<span class="tag">' + Util.escapeHtml(srcName) + '</span>');
    if (m.aiScore != null) meta.push('<span class="tag ai-tag">🤖 AI ranked</span>');
    if (job.remote) meta.push('<span class="tag remote">remote</span>');
    if (job.location) meta.push('<span class="tag">' + Util.escapeHtml(job.location) + '</span>');
    if (job.postedAt) meta.push('<span class="tag">' + Util.escapeHtml(Util.timeAgo(job.postedAt)) + '</span>');

    const skills = (m.matchedSkills || []).slice(0, 6)
      .map(s => '<span class="tag skill">' + Util.escapeHtml(s) + '</span>').join('');

    const reasons = (m.reasons || []).slice(0, 3).map(r => '<li>' + r + '</li>').join('');
    const moreR = (m.reasons || []).length > 3
      ? '<li><i>+' + (m.reasons.length - 3) + ' more reasons…</i></li>' : '';
    const aiReason = m.aiReason ? '<li>🤖 <b>' + Util.escapeHtml(m.aiReason) + '</b></li>' : '';

    const applyBtn = job.url
      ? '<a class="btn small primary" href="' + Util.escapeHtml(job.url) + '" target="_blank" rel="noopener">Apply ↗</a>'
      : '<span class="hint">no link found</span>';

    const isSaved = Store.isSaved(job.id);

    card.innerHTML =
      '<div class="job-top">' +
        '<span class="co-avatar" aria-hidden="true">' + Util.escapeHtml(coInitial) + '</span>' +
        '<div class="job-headline">' +
          '<div class="job-title">' +
            (job.url ? '<a href="' + Util.escapeHtml(job.url) + '" target="_blank" rel="noopener">' + Util.escapeHtml(job.title) + '</a>'
                     : Util.escapeHtml(job.title)) +
          '</div>' +
          '<div class="job-company">' + Util.escapeHtml(job.company) + '</div>' +
        '</div>' +
        '<div class="ring ' + cls + (m.aiScore != null ? ' ai' : '') + '" style="--p:' + Math.max(0, Math.min(100, score)) +
          '" title="' + scoreTitle + '" role="img" aria-label="' + scoreTitle + ': ' + score + ' out of 100"><b>' + score + '</b></div>' +
      '</div>' +
      '<div class="meta-row">' + meta.join('') + '</div>' +
      (skills ? '<div class="meta-row">' + skills + '</div>' : '') +
      (reasons || aiReason ? '<ul class="reasons">' + reasons + moreR + aiReason + '</ul>' : '') +
      '<div class="job-actions">' + applyBtn + '<span class="spacer"></span>' +
        '<button class="icon-btn" data-act="laya" title="Open the Laya dossier (value, odds, readiness)" aria-label="Open the Laya dossier for this job">🧠</button>' +
        '<button class="icon-btn' + (isSaved ? ' saved' : '') + '" data-act="save" aria-label="' + (isSaved ? 'Remove from saved' : 'Save this job') + '">' +
          (isSaved ? '💾 saved' : '💾 save') + '</button>' +
        (inSaved ? '' : '<button class="icon-btn dismiss" data-act="dismiss" title="Hide this job" aria-label="Hide this job">✕</button>') +
      '</div>';

    card.querySelector('[data-act="laya"]').addEventListener('click', () => App.openDossier(m));
    card.querySelector('[data-act="save"]').addEventListener('click', () => {
      const now = Store.toggleSaved(job);
      App.toast(now ? 'Saved: ' + Util.truncate(job.title, 40) : 'Removed from saved');
      App.updateCounts();
      App.renderAll();
    });

    const dis = card.querySelector('[data-act="dismiss"]');
    if (dis) dis.addEventListener('click', () => {
      Store.dismiss(job.id);
      App.state.matches = App.state.matches.filter(x => x.job.id !== job.id);
      App.renderAll();
      App.toast('Job hidden');
    });

    return card;
  },

  /* ================= Laya — decision board + dossiers ================= */

  /** Ranked [{m, a}] rows for every currently filtered match. */
  layaRows() {
    return Laya.rank(App.filteredMatches(), Store.profile());
  },

  renderLaya() {
    const wrap = el('laya-list');
    if (!wrap) return;
    const rows = App.layaRows();
    el('count-laya').textContent = rows.length;

    // engine mode line
    const s = Store.settings();
    const mode = el('laya-mode');
    if (mode) {
      if (LLM.hasKey(s)) {
        mode.innerHTML = 'Realtime metrics ✓ · Laya AI armed on <b>' + Util.escapeHtml(LLM.cfg(s).provider) +
          '</b> — “Run Laya AI” writes full dossiers (translation · readiness · cover note)';
      } else {
        mode.textContent = 'Realtime metrics, no AI key needed — add one in Setup for translated dossiers + cover notes';
      }
    }

    // headline stats
    const applyNow = rows.filter(r => r.a.priority >= 78).length;
    const avgRead = rows.length ? Math.round(rows.reduce((x, r) => x + r.a.readiness.percent, 0) / rows.length) : 0;
    const bestOdds = rows.length ? Math.max.apply(null, rows.map(r => r.a.odds)) : 0;
    const topValue = rows.length ? Math.max.apply(null, rows.map(r => r.a.value)) : 0;
    el('stat-laya-apply').textContent = applyNow;
    el('stat-laya-readiness').textContent = avgRead + '%';
    el('stat-laya-odds').textContent = bestOdds + '%';
    el('stat-laya-value').textContent = topValue;

    // ranking
    const sorters = {
      priority: (x, y) => y.a.priority - x.a.priority,
      value:    (x, y) => y.a.value - x.a.value,
      odds:     (x, y) => y.a.odds - x.a.odds,
      match:    (x, y) => y.a.match.blended - x.a.match.blended,
      fresh:    (x, y) => (x.a.daysOld == null ? 9e9 : x.a.daysOld) - (y.a.daysOld == null ? 9e9 : y.a.daysOld)
    };
    rows.sort(sorters[App.state.layaSort] || sorters.priority);

    wrap.innerHTML = '';
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty small"><div class="empty-art">🧠</div>' +
        '<h3>Nothing to decide on yet</h3><p class="hint">Scan the boards or load Demo data — Laya will rank ' +
        'every job by <b>priority = match × value × odds</b> and open a full dossier for each.</p></div>';
      return;
    }
    for (let i = 0; i < Math.min(rows.length, 120); i++) {
      wrap.appendChild(App.layaCard(rows[i], i + 1));
    }
  },

  /** A metric bar: label + track + value. */
  bar(label, v) {
    const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    const cls = n >= 70 ? 'hi' : n >= 40 ? 'mid' : 'lo';
    return '<div class="bar"><span class="bar-label">' + Util.escapeHtml(label) + '</span>' +
      '<div class="bar-track"><i class="' + cls + '" style="width:' + n + '%"></i></div>' +
      '<b>' + n + '</b></div>';
  },

  layaCard(r, rankNo) {
    const m = r.m, a = r.a, job = m.job;
    const card = document.createElement('div');
    card.className = 'laya-card';

    const srcName = job.source === 'gmail' ? 'Gmail' :
      (JobSources.sources.find(x => x.id === job.source) || { name: job.source }).name;
    const coInitial = (String(job.company || '?').trim()[0] || '?').toUpperCase();

    const chips = [];
    if (a.salaryText) chips.push('<span class="tag pay">💰 ' + Util.escapeHtml(a.salaryText) + '</span>');
    chips.push('<span class="tag">' + Util.escapeHtml(a.levelUnknown ? 'level unstated' : Util.truncate(a.level, 12)) + '</span>');
    if (job.remote) chips.push('<span class="tag remote">remote</span>');
    if (job.location) chips.push('<span class="tag">' + Util.escapeHtml(Util.truncate(job.location, 26)) + '</span>');
    chips.push('<span class="tag">' + Util.escapeHtml(a.freshLabel) + '</span>');
    chips.push('<span class="tag">' + Util.escapeHtml(srcName) + '</span>');
    const verdict = Store.layaVerdict(Util.dedupeKey(job.title, job.company));
    if (verdict && verdict.fp === Laya.fingerprint(Store.profile())) {
      chips.push('<span class="tag ai-tag">🧠 AI dossier</span>');
    }

    const titleHtml = job.url
      ? '<a href="' + Util.escapeHtml(job.url) + '" target="_blank" rel="noopener">' + Util.escapeHtml(job.title) + '</a>'
      : Util.escapeHtml(job.title);

    card.innerHTML =
      '<div class="laya-rankcol">' +
        '<span class="laya-rank">#' + rankNo + '</span>' +
        '<div class="ring prio" style="--p:' + a.priority + '" title="Laya priority score" ' +
          'role="img" aria-label="Priority ' + a.priority + ' out of 100"><b>' + a.priority + '</b></div>' +
      '</div>' +
      '<div class="laya-main">' +
        '<div class="job-top">' +
          '<span class="co-avatar" aria-hidden="true">' + Util.escapeHtml(coInitial) + '</span>' +
          '<div class="job-headline">' +
            '<div class="job-title">' + titleHtml + '</div>' +
            '<div class="job-company">' + Util.escapeHtml(job.company) + '</div>' +
          '</div>' +
          '<span class="decision ' + a.decision.cls + '">' + a.decision.icon + ' ' + a.decision.label + '</span>' +
        '</div>' +
        '<div class="meta-row">' + chips.join('') + '</div>' +
        '<div class="laya-bars">' +
          App.bar('Match', a.match.blended) + App.bar('Value', a.value) +
          App.bar('Odds', a.odds) + App.bar('Readiness', a.readiness.percent) +
        '</div>' +
        '<div class="laya-why">' + Util.escapeHtml(Laya.explain(a)) + '</div>' +
        '<div class="job-actions">' +
          '<button class="btn small primary" data-act="dossier">Full dossier →</button>' +
          (job.url ? '<a class="btn small ghost" href="' + Util.escapeHtml(job.url) + '" target="_blank" rel="noopener">Apply ↗</a>' : '') +
          '<span class="spacer"></span>' +
          '<button class="icon-btn" data-act="save-l">💾 save</button>' +
        '</div>' +
      '</div>';

    card.querySelector('[data-act="dossier"]').addEventListener('click', () => App.openDossier(m));
    card.querySelector('[data-act="save-l"]').addEventListener('click', () => {
      const now = Store.toggleSaved(job);
      App.toast(now ? 'Saved: ' + Util.truncate(job.title, 40) : 'Removed from saved');
      App.updateCounts();
      App.renderAll();
    });
    return card;
  },

  /* ---- dossier modal ---- */
  openDossier(m) {
    App.state.dossier = m;
    App.renderDossier();
    el('job-dossier').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  },

  closeDossier() {
    el('job-dossier').classList.add('hidden');
    App.state.dossier = null;
    document.body.style.overflow = '';
  },

  renderDossier() {
    const m = App.state.dossier;
    if (!m) return;
    const body = el('dossier-body');
    const profile = Store.profile();
    const job = m.job;
    const a = Laya.analyze(m, profile);
    const key = Util.dedupeKey(job.title, job.company);
    const fp = Laya.fingerprint(profile);
    const v = Store.layaVerdict(key);
    const fresh = !!(v && v.fp === fp);
    const lang = fresh ? (v.lang || 'en') : App.state.layaLang;

    // AI enrichments win over the local ones when present
    const readinessPct = (fresh && v.readiness_percent != null) ? v.readiness_percent : a.readiness.percent;
    const strengths = (fresh && v.strengths && v.strengths.length) ? v.strengths : a.readiness.strengths;
    const gaps = (fresh && v.gaps && v.gaps.length) ? v.gaps : a.readiness.gaps;
    const actionMap = { apply: '🚀 Apply now', prepare: '🟡 Prepare, then apply', watch: '👀 Keep watching', skip: '💤 Skip' };

    const srcName = job.source === 'gmail' ? 'Gmail lead' :
      (JobSources.sources.find(x => x.id === job.source) || { name: job.source }).name;

    const chips = [
      '<span class="tag">' + Util.escapeHtml(srcName) + '</span>',
      '<span class="tag">' + Util.escapeHtml(a.levelUnknown ? 'level unstated' : Util.truncate(a.level, 14) + ' level') + '</span>',
      '<span class="tag">' + Util.escapeHtml(a.freshLabel) + '</span>'
    ];
    if (job.remote) chips.push('<span class="tag remote">remote</span>');
    if (job.location) chips.push('<span class="tag">' + Util.escapeHtml(Util.truncate(job.location, 30)) + '</span>');
    if (a.salaryText) chips.push('<span class="tag pay">💰 ' + Util.escapeHtml(a.salaryText) + '</span>');

    // "what it really means" — AI translation when available, local facts otherwise
    let means;
    if (fresh && v.what_it_really_means) {
      means = '<p class="dossier-meaning">' + Util.escapeHtml(v.what_it_really_means) + '</p>' +
        '<small>' + (lang === 'hi' ? 'Laya AI · हिन्दी अनुवाद' : 'Laya AI translation') + '</small>';
    } else {
      means = '<ul class="dossier-facts">' +
        Laya.plainSummary(job, profile, a).map(r =>
          '<li><b>' + Util.escapeHtml(r.k) + ':</b> ' + Util.escapeHtml(r.v) + '</li>').join('') +
        '</ul><small>Local translation — hit “Ask Laya” for the AI read (plain talk + Hindi option).</small>';
    }

    const reqRows = a.requirements.map(req => {
      const hay = req.toLowerCase();
      const hit = (profile.skills || []).some(s => Matcher.textHas(hay, String(s).toLowerCase()));
      return '<li class="' + (hit ? 'ok' : 'gap') + '">' + (hit ? '✓' : '•') + ' ' + Util.escapeHtml(req) + '</li>';
    }).join('');

    body.innerHTML =
      '<div class="dossier-head">' +
        '<span class="co-avatar big" aria-hidden="true">' + Util.escapeHtml((String(job.company || '?').trim()[0] || '?').toUpperCase()) + '</span>' +
        '<div class="job-headline">' +
          '<div class="job-title">' + (job.url ? '<a href="' + Util.escapeHtml(job.url) + '" target="_blank" rel="noopener">' + Util.escapeHtml(job.title) + '</a>' : Util.escapeHtml(job.title)) + '</div>' +
          '<div class="job-company">' + Util.escapeHtml(job.company) + '</div>' +
        '</div>' +
        '<span class="decision ' + a.decision.cls + '">' + a.decision.icon + ' ' + a.decision.label + '</span>' +
      '</div>' +
      '<div class="meta-row">' + chips.join('') + '</div>' +

      '<div class="dossier-scores">' +
        '<div class="score-plate big"><b>' + a.priority + '</b><span>priority</span></div>' +
        '<div class="score-plate"><b>' + a.match.blended + '</b><span>match' + (a.match.aiScore != null ? '*' : '') + '</span></div>' +
        '<div class="score-plate"><b>' + a.value + '</b><span>value</span></div>' +
        '<div class="score-plate"><b>' + a.odds + '</b><span>odds</span></div>' +
        '<div class="score-plate read"><b>' + readinessPct + '%</b><span>readiness</span></div>' +
      '</div>' +

      '<div class="dossier-bars">' +
        App.bar('Skills', a.parts.odds.skills) + App.bar('Role fit', a.parts.odds.role) +
        App.bar('Experience', a.parts.odds.exp) + App.bar('Location', a.parts.odds.loc) +
        App.bar('Freshness', a.parts.odds.fresh) + App.bar('Level', a.levelFit) +
        App.bar('Pay', a.parts.value.pay) + App.bar('Inbound intent', a.parts.odds.intent) +
      '</div>' +
      (a.match.aiScore != null ? '<small>* match blends your local ' + a.match.score + ' with the AI score ' + a.match.aiScore + '</small>' : '') +

      '<section class="dossier-sec"><h3>💬 What this job really means' + (lang === 'hi' ? ' (हिन्दी)' : '') + '</h3>' + means + '</section>' +

      '<section class="dossier-sec"><h3>🧭 Profile readiness — ' + readinessPct + '%</h3>' +
        '<div class="readiness-cols">' +
          '<div><h4>✓ You bring</h4><ul class="req-list">' +
            strengths.map(x => '<li class="ok">✓ ' + Util.escapeHtml(x) + '</li>').join('') + '</ul></div>' +
          '<div><h4>⚠ Gaps / risks</h4><ul class="req-list">' +
            (gaps.length ? gaps.map(x => '<li class="gap">⚠ ' + Util.escapeHtml(x) + '</li>').join('')
              : '<li class="ok">✓ No obvious gaps detected</li>') + '</ul></div>' +
        '</div></section>' +

      (a.requirements.length
        ? '<section class="dossier-sec"><h3>📋 Their requirements vs your profile</h3><ul class="req-list">' + reqRows + '</ul></section>'
        : '') +

      (fresh && v.verdict
        ? '<section class="dossier-sec verdict-box"><h3>🧠 Laya’s verdict</h3>' +
          '<p class="verdict-text">' + Util.escapeHtml(v.verdict) + '</p>' +
          (v.action ? '<span class="decision ' + (v.action === 'apply' ? 'good' : v.action === 'prepare' ? 'warn' : v.action === 'watch' ? 'info' : 'off') + '">' + actionMap[v.action] + '</span>' : '') +
          (v.cover_note
            ? '<h4>✍️ Ready-to-send cover note</h4><pre class="cover-note" id="dossier-cover-note">' + Util.escapeHtml(v.cover_note) + '</pre>' +
              '<button class="btn small" data-dossier="copy-cover">📋 Copy cover note</button>'
            : '') +
          '</section>'
        : '') +

      '<div class="dossier-actions">' +
        (job.url ? '<a class="btn primary" href="' + Util.escapeHtml(job.url) + '" target="_blank" rel="noopener">Apply now ↗</a>' : '<span class="hint">no apply link found</span>') +
        '<button class="btn" data-dossier="ask">✨ ' + (fresh ? 'Re-ask Laya' : 'Ask Laya for full dossier') + '</button>' +
        '<select data-dossier="lang" aria-label="Dossier language" title="Language for the Laya AI read">' +
          '<option value="en"' + (lang === 'en' ? ' selected' : '') + '>English</option>' +
          '<option value="hi"' + (lang === 'hi' ? ' selected' : '') + '>हिन्दी</option>' +
        '</select>' +
        '<button class="btn ghost" data-dossier="save">💾 ' + (Store.isSaved(job.id) ? 'saved' : 'save') + '</button>' +
      '</div>' +

      (job.description
        ? '<details class="dossier-raw"><summary>📄 Original posting</summary><pre>' +
          Util.escapeHtml(Util.truncate(Util.stripHtml(job.description), 3500)) + '</pre></details>'
        : '');

    // dynamic bindings
    const askBtn = body.querySelector('[data-dossier="ask"]');
    askBtn.addEventListener('click', () => App.askLaya(m, lang, askBtn));

    const langSel = body.querySelector('[data-dossier="lang"]');
    langSel.addEventListener('change', () => {
      App.state.layaLang = langSel.value;
      const cached = Store.layaVerdict(key);
      if (cached && cached.fp === fp && cached.lang === langSel.value) App.renderDossier();
      else App.askLaya(m, langSel.value, body.querySelector('[data-dossier="ask"]'));
    });

    const saveBtn = body.querySelector('[data-dossier="save"]');
    saveBtn.addEventListener('click', () => {
      const now = Store.toggleSaved(job);
      saveBtn.textContent = now ? '💾 saved' : '💾 save';
      App.toast(now ? 'Saved: ' + Util.truncate(job.title, 40) : 'Removed from saved');
      App.updateCounts();
      App.renderAll();
    });

    const copyBtn = body.querySelector('[data-dossier="copy-cover"]');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const note = el('dossier-cover-note');
      App.copyText(note ? note.textContent : (v.cover_note || ''), 'Cover note copied — paste it into the application');
    });
  },

  /** One Laya AI call for a single job (fetch → parse → cache). */
  async _layaOne(m, lang) {
    const profile = Store.profile();
    const a = Laya.analyze(m, profile);
    const p = Laya.buildPrompt(m.job, profile, a, lang);
    const raw = await LLM.chat([
      { role: 'system', content: p.sys },
      { role: 'user', content: p.user }
    ], Store.settings(), { temperature: 0.3 });
    const verdict = Laya.parseAIJson(raw);
    Store.saveLayaVerdict(Util.dedupeKey(m.job.title, m.job.company),
      Object.assign({ fp: Laya.fingerprint(profile), lang, ts: Date.now() }, verdict));
    return verdict;
  },

  /** Per-job button inside the dossier. */
  async askLaya(m, lang, btnEl) {
    const s = Store.settings();
    if (!LLM.hasKey(s)) {
      App.toast('Add an AI key in Setup → AI re-ranking to unlock full dossiers', true);
      App.openDrawer(true);
      return;
    }
    const key = Util.dedupeKey(m.job.title, m.job.company);
    const cached = Store.layaVerdict(key);
    if (cached && cached.fp === Laya.fingerprint(Store.profile()) && cached.lang === lang) {
      App.renderDossier();
      return;
    }
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<span class="spin">◌</span> Laya is reading…'; }
    try {
      await App._layaOne(m, lang);
      App.toast('✓ Laya finished the dossier');
      App.renderLaya();
      App.renderDossier();
    } catch (e) {
      App.toast('Laya AI: ' + e.message, true);
      App.log('✖ Laya AI: ' + e.message, true);
      if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '✨ Ask Laya'; }
    }
  },

  /** Batch: dossier the top 10 ranked jobs. */
  async runLayaAI() {
    const s = Store.settings();
    if (!LLM.hasKey(s)) {
      App.toast('Add an AI key first (Setup → AI re-ranking)', true);
      App.openDrawer(true);
      return;
    }
    const btn = el('btn-laya-ai');
    const fp = Laya.fingerprint(Store.profile());
    const lang = App.state.layaLang;
    const pending = App.layaRows().slice(0, 10).filter(r => {
      const v = Store.layaVerdict(Util.dedupeKey(r.m.job.title, r.m.job.company));
      return !(v && v.fp === fp && v.lang === lang);
    });
    if (!pending.length) {
      App.toast('Laya AI has already dossiered the top 10 — open any card for the full read');
      return;
    }
    btn.disabled = true;
    let done = 0, failed = 0;
    for (const r of pending) {
      btn.innerHTML = '<span class="spin">◌</span> Laya reading ' + (done + failed + 1) + '/' + pending.length + '…';
      try { await App._layaOne(r.m, lang); done++; }
      catch (e) { failed++; App.log('✖ Laya AI (' + Util.truncate(r.m.job.title, 40) + '): ' + e.message, true); }
    }
    btn.disabled = false;
    btn.innerHTML = '✨ Run Laya AI — top 10';
    App.renderLaya();
    if (App.state.dossier) App.renderDossier();
    App.toast('Laya AI finished — ' + done + ' full dossiers written' + (failed ? ', ' + failed + ' failed' : ''));
    App.log('✔ Laya AI: ' + done + ' dossiers' + (failed ? ', ' + failed + ' failed' : ''));
  },

  updateCounts() {
    el('count-matches').textContent = App.matchesCount();
    el('count-saved').textContent = Store.savedJobs().length;
    App.updateStats();
  },

  updateStats() {
    const total = App.state.jobs.length;
    const strong = App.state.matches.filter(m => (m.aiScore != null ? m.aiScore : m.score) >= 70).length;
    const saved = Store.savedJobs().length;
    const all = JobSources.sources.length;
    const ok = Object.values(App.state.sourceStatus).filter(s => s.ok).length;
    el('stat-total').textContent = total;
    el('stat-strong').textContent = strong;
    el('stat-saved').textContent = saved;
    el('stat-sources').textContent = ok + '/' + all;
  },

  /* ================= misc ================= */
  toast(msg, isError) {
    const t = el('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' err' : ' info');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.classList.remove('show'); }, 3200);
  },

  log(msg, isErr) {
    const box = el('scan-log');
    box.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = isErr ? 'err' : 'ok';
    const t = new Date().toLocaleTimeString();
    line.textContent = '[' + t + '] ' + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 60) box.removeChild(box.firstChild);
  }
};

function el(id) { return document.getElementById(id); }

function Util_debounce(fn, ms) {
  let t = null;
  return function () {
    const args = arguments;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

document.addEventListener('DOMContentLoaded', () => App.init());
