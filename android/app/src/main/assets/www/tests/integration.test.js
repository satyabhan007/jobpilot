/* Full-app integration test (run with: node tests/integration.test.js)
 *
 * Covers everything the user asked to verify:
 *   A. Storage + settings (per-provider AI configs, provider switching)
 *   B. Multi-Gmail accounts (token map, scan merge, parse tagging)  [mocked network]
 *   C. AI provider router (Groq/OpenRouter/NVIDIA/DeepSeek/Custom)  [mocked network]
 *   D. Live job boards (real network, all 6 sources)
 *   E. Matcher end-to-end on live jobs
 *   F. Android assets in sync with the web app
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

(async () => {  /* async wrapper: CommonJS + await */
const ROOT = path.join(__dirname, '..');
let fails = 0, passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log('PASS: ' + name + (extra != null ? ' (' + extra + ')' : '')); }
  else { fails++; console.log('FAIL: ' + name + (extra != null ? ' (' + extra + ')' : '')); }
}
function section(t) { console.log('\n===== ' + t + ' ====='); }

/* ---------- sandbox ---------- */
function makeLS() {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    _dump: () => m
  };
}

/* mock fetch: records calls, routes to canned Gmail/LLM responses */
let fetchCalls = [];
function makeMockFetch() {
  return async (url, opts) => {
    const u = String(url);
    fetchCalls.push({ url: u, opts: opts || {} });
    // --- Gmail API ---
    if (u.includes('gmail.googleapis.com')) {
      if (u.includes('/messages?') || /\/messages\?/.test(u)) {
        return ok({ messages: [{ id: 'm1' }, { id: 'm2' }] });
      }
      if (/\/messages\/m1/.test(u)) return ok(gmailMsg('m1', 'Senior AI Engineer at Quantiphi', 'sarah@quantiphi.com', 'We are hiring a Senior AI Engineer, remote role. https://quantiphi.com/careers'));
      if (/\/messages\/m2/.test(u)) return ok(gmailMsg('m2', 'Interview invite — LLM Engineer', 'hr@sarvam.ai', 'Interview for LLM Engineer position, remote work from home. https://sarvam.ai/jobs'));
      return ok({});
    }
    // --- LLM chat completions ---
    if (u.includes('/chat/completions')) {
      return ok({
        choices: [{ message: { content: 'Here is the JSON you asked for:\n{"results":[{"n":0,"id":"job-1","score":112,"reason":"Strong RAG + MLOps overlap"},{"n":1,"id":"job-2","score":35.6,"reason":"Mostly frontend"}]}' } }]
      });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
function ok(obj) { return { ok: true, status: 200, json: async () => obj }; }
function gmailMsg(id, subject, from, body) {
  return {
    id,
    snippet: body,
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        { name: 'Date', value: 'Sun, 11 Oct 2026 01:00:00 +0000' }
      ],
      parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64') } }]
    }
  };
}

const ls = makeLS();
const sandbox = {
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  decodeURIComponent, encodeURIComponent, console, setTimeout,
  localStorage: ls,
  fetch: makeMockFetch(),
  URLSearchParams,
  window: {},
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }), head: { appendChild() {} } }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const load = (f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
vm.runInContext(
  load('util.js') + load('portfolio.js') + load('storage.js') +
  load('matcher.js') + load('llm.js') + load('gmail.js') +
  ';globalThis.__U=Util;globalThis.__P=PORTFOLIO_PROFILE;globalThis.__S=Store;' +
  'globalThis.__M=Matcher;globalThis.__L=LLM;globalThis.__G=GmailClient;',
  sandbox
);
const U = sandbox.__U, P = sandbox.__P, Store = sandbox.__S,
      Matcher = sandbox.__M, LLM = sandbox.__L, G = sandbox.__G;

/* ================= A. STORAGE & PROVIDER SWITCHING ================= */
section('A. Storage, settings & per-provider AI configs');
const s0 = Store.settings();
check('default provider is groq', s0.aiProvider === 'groq');
check('all 5 providers preconfigured', ['groq', 'openrouter', 'nvidia', 'deepseek', 'custom'].every(k => s0.aiConfigs[k] && s0.aiConfigs[k].base !== undefined));
check('groq base correct', s0.aiConfigs.groq.base === 'https://api.groq.com/openai/v1');
check('openrouter base correct', s0.aiConfigs.openrouter.base === 'https://openrouter.ai/api/v1');
check('nvidia base correct', s0.aiConfigs.nvidia.base === 'https://integrate.api.nvidia.com/v1');
check('deepseek base correct', s0.aiConfigs.deepseek.base === 'https://api.deepseek.com/v1');
check('gmail client id key present in defaults (empty until user fills)', 'gmailClientId' in s0);

/* per-provider independence: save key for groq, switch, verify isolation */
s0.aiConfigs.groq.key = 'gsk_groq_test_key';
s0.aiProvider = 'groq';
Store.saveSettings(s0);
const s1 = Store.settings();
s1.aiProvider = 'openrouter';
s1.aiConfigs.openrouter.key = 'sk-or-test';
Store.saveSettings(s1);
const s2 = Store.settings();
check('provider switch persisted (openrouter active)', s2.aiProvider === 'openrouter');
check('openrouter key stored separately', s2.aiConfigs.openrouter.key === 'sk-or-test');
check('groq key NOT leaked into openrouter', s2.aiConfigs.openrouter.key !== s2.aiConfigs.groq.key);
check('groq key retained after switch', s2.aiConfigs.groq.key === 'gsk_groq_test_key');
check('nvidia/deepseek untouched', !s2.aiConfigs.nvidia.key && !s2.aiConfigs.deepseek.key);

/* saved / dismissed persistence */
const demoJob = { id: 't-1', source: 'demo', title: 'AI Engineer', company: 'X', url: '', description: '', postedAt: Date.now(), remote: true };
check('toggleSaved saves', Store.toggleSaved(demoJob) === true && Store.isSaved('t-1'));
check('toggleSaved un-saves', Store.toggleSaved(demoJob) === false && !Store.isSaved('t-1'));
Store.dismiss('j-9');
check('dismiss persists', Store.dismissed().includes('j-9'));

/* gmail account list persistence */
Store.addGmailAccount('satyabhan@gmail.com');
Store.addGmailAccount('satyabhan.work@gmail.com');
Store.addGmailAccount('satyabhan@gmail.com'); // dup ignored
check('gmail account list persisted, dup ignored', Store.gmailAccounts().length === 2);
Store.removeGmailAccount('satyabhan.work@gmail.com');
check('gmail account removal works', Store.gmailAccounts().length === 1);

/* ================= B. MULTI-GMAIL ACCOUNTS ================= */
section('B. Multi-Gmail account manager (mocked API)');
check('GmailClient starts disconnected', G.isConnected() === false && G.accounts.size === 0);
/* simulate tokens as GIS would after connect() */
G.accounts.set('satyabhan@gmail.com', { token: 'tok_a', expiry: Date.now() + 3600e3 });
G.accounts.set('work@othermail.com', { token: 'tok_b', expiry: Date.now() - 1 });
check('two accounts registered', G.accounts.size === 2);
check('connectedEmails lists only VALID token account (expired excluded by design)', JSON.stringify(G.connectedEmails()) === JSON.stringify(['satyabhan@gmail.com']));
check('isConnected true with a valid account', G.isConnected() === true);
check('tokenFor returns valid token', G.tokenFor('satyabhan@gmail.com') === 'tok_a');
check('tokenFor returns null for EXPIRED account', G.tokenFor('work@othermail.com') === null);
check('tokenFor unknown account → null', G.tokenFor('ghost@x.com') === null);

fetchCalls = [];
const leads = await G.scanInbox(45, 50, (email, n) => {});
check('scanInbox merged results from valid accounts (expired skipped)', leads.length === 2, leads.length + ' leads');
const perAcct = {};
leads.forEach(l => { perAcct[l.accountEmail] = (perAcct[l.accountEmail] || 0) + 1; });
check('valid account scanned with its leads', perAcct['satyabhan@gmail.com'] === 2, JSON.stringify(perAcct));
const gmailUrls = [...new Set(fetchCalls.map(c => c.url.split('?')[0]))];
check('gmail API base URL correct', gmailUrls.every(u => u.startsWith('https://gmail.googleapis.com/gmail/v1/users/me')));
check('auth bearer header on every call', fetchCalls.every(c => (c.opts.headers || {}).Authorization === 'Bearer tok_a' || (c.opts.headers || {}).Authorization === 'Bearer tok_b'));

const l1 = leads.find(l => l.id === 'gmail-m1');
check('lead parsed: company from corp domain', l1.company === 'Quantiphi', l1.company);
check('lead parsed: title cleaned', /Senior AI Engineer/.test(l1.title), l1.title);
check('lead parsed: remote detected', l1.remote === true);
check('lead parsed: accountEmail tagged', l1.accountEmail === 'satyabhan@gmail.com');
check('lead parsed: apply link extracted', /quantiphi\.com\/careers/.test(l1.url));
check('lead parsed: source+type', l1.source === 'gmail' && l1.type === 'lead');
const l2 = leads.find(l => l.id === 'gmail-m2');
check('lead 2: corp domain company (Sarvam)', l2.company === 'Sarvam', l2.company);

G.disconnect('satyabhan@gmail.com');
check('disconnect removes one account', G.accounts.size === 1 && !G.accounts.has('satyabhan@gmail.com'));
G.disconnectAll();
check('disconnectAll clears all', G.accounts.size === 0 && G.isConnected() === false);
let threw = false;
try { await G.scanInbox(45, 50); } catch (e) { threw = /No Gmail accounts connected/.test(e.message); }
check('scanInbox with 0 accounts throws friendly error', threw);

/* ================= C. AI PROVIDER ROUTER ================= */
section('C. Multi-provider AI router (mocked endpoint)');
const profile = Store.profile();
const jobs = [
  { job: { id: 'job-1', title: 'Senior AI Engineer', company: 'Quantiphi', location: 'Remote', description: 'RAG MLOps LangChain' } },
  { job: { id: 'job-2', title: 'Frontend Dev', company: 'Y', location: 'Pune', description: 'CSS React' } }
];
const st = Store.settings();
st.aiProvider = 'groq';
st.aiConfigs.groq = { base: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', key: 'gsk_groq_test_key' };
Store.saveSettings(st);

/* error paths first */
await (async () => {
  const bad1 = JSON.parse(JSON.stringify(st)); bad1.aiConfigs = {}; bad1.aiProvider = 'nvidia';
  let e1 = ''; try { await LLM.rerank(profile, jobs, bad1); } catch (e) { e1 = e.message; }
  check('missing provider config → friendly error', /configuration missing/.test(e1), e1);
  const bad2 = JSON.parse(JSON.stringify(st)); bad2.aiConfigs.groq.key = '';
  let e2 = ''; try { await LLM.rerank(profile, jobs, bad2); } catch (e) { e2 = e.message; }
  check('missing API key → friendly error', /Add your API key/.test(e2), e2);
  const bad3 = JSON.parse(JSON.stringify(st)); bad3.aiConfigs.groq.base = '';
  let e3 = ''; try { await LLM.rerank(profile, jobs, bad3); } catch (e) { e3 = e.message; }
  check('missing base URL → friendly error', /API base URL/.test(e3), e3);
})();

/* happy path: request formation + response parsing */
fetchCalls = [];
const ranked = await LLM.rerank(profile, jobs, st);
const llmCall = fetchCalls.find(c => c.url.includes('/chat/completions'));
check('LLM call hits provider /chat/completions', !!llmCall && llmCall.url === 'https://api.groq.com/openai/v1/chat/completions');
check('Bearer auth header sent', llmCall.opts.headers.Authorization === 'Bearer gsk_groq_test_key');
const body = JSON.parse(llmCall.opts.body);
check('correct model sent for provider', body.model === 'llama-3.1-8b-instant');
check('profile AI context included in prompt', /RAG|LLM|GenAI|MLOps|AI/.test(body.messages[1].content));
check('all jobs listed in prompt JSON', body.messages[1].content.includes('job-1') && body.messages[1].content.includes('job-2'));
check('rerank returns 2 results', ranked.length === 2);
check('score clamped to 0-100 (112→100)', ranked[0].score === 100, ranked[0].score);
check('score rounded (35.6→36)', ranked[1].score === 36, ranked[1].score);
check('reasons carried through', /RAG/.test(ranked[0].reason));

/* provider switch changes endpoint */
for (const [prov, base, model] of [
  ['openrouter', 'https://openrouter.ai/api/v1', 'meta-llama/llama-3.1-8b-instruct:free'],
  ['nvidia', 'https://integrate.api.nvidia.com/v1', 'meta/llama-3.1-8b-instruct'],
  ['deepseek', 'https://api.deepseek.com/v1', 'deepseek-chat']
]) {
  const s = JSON.parse(JSON.stringify(Store.settings()));
  s.aiProvider = prov;
  s.aiConfigs[prov] = { base, model, key: 'key_' + prov };
  fetchCalls = [];
  await LLM.rerank(profile, jobs, s);
  const c = fetchCalls.find(x => x.url.includes('/chat/completions'));
  const b = JSON.parse(c.opts.body);
  check(`provider ${prov} → correct endpoint+model`, c.url === base + '/chat/completions' && b.model === model, b.model);
}

/* ================= D. LIVE JOB BOARDS ================= */
section('D. Live job-board APIs (real network)');
const ONLINE = await (async () => { try { const r = await fetch('https://www.arbeitnow.com/api/job-board-api', { signal: AbortSignal.timeout(8000) }); return r.ok; } catch (e) { return false; } })();
if (!ONLINE) {
  console.log('SKIP: network unavailable — live board tests skipped (offline logic already covered above)');
} else {
  const jobsSrc = await (async () => {
    const sb2 = { console, fetch, AbortSignal, URLSearchParams };
    sb2.globalThis = sb2;
    vm.createContext(sb2);
    vm.runInContext(load('util.js') + load('jobs.js') + ';globalThis.__J=JobSources.sources;', sb2);
    return sb2.__J;
  })();
  check('6 sources registered', Array.isArray(jobsSrc) && jobsSrc.length === 6, jobsSrc.map(s => s.id).join(','));
  const liveJobs = [];
  for (const src of jobsSrc) {
    try {
      const out = await src.fetch();
      const okShape = Array.isArray(out) && out.every(j => j && j.id && j.title && j.source === src.id && typeof j.url === 'string');
      check(`[${src.id}] fetch OK, shape valid`, okShape && out.length > 0, out.length + ' jobs');
      liveJobs.push(...out.slice(0, 40));
    } catch (e) {
      check(`[${src.id}] fetch OK`, false, e.message.slice(0, 80));
    }
  }
  /* E. matcher on LIVE jobs */
  section('E. Matcher end-to-end on LIVE jobs');
  check('live corpus size usable', liveJobs.length >= 20, liveJobs.length + ' jobs');
  const prof = Store.profile();
  const scored = liveJobs.map(j => ({ job: j, score: Matcher.score(prof, j).score, reasons: Matcher.score(prof, j).reasons }));
  const top = scored.slice().sort((a, b) => b.score - a.score);
  check('scores in 0-100 range', scored.every(s => s.score >= 0 && s.score <= 100));
  check('spread of scores (not all identical)', new Set(scored.map(s => s.score)).size > 3, new Set(scored.map(s => s.score)).size + ' distinct');
  check('top live match scores ≥ 60', top[0].score >= 60, `${top[0].score} — ${top[0].job.title} @ ${top[0].job.company}`);
  check('AI/ML jobs rank above random', top[0].score > scored[Math.floor(scored.length / 2)].score);
  const withReasons = scored.filter(s => s.reasons && s.reasons.length);
  check('reasons generated for scored jobs', withReasons.length > 0, withReasons.length + ' with reasons');
  console.log('   top live match:', top[0].job.title, '@', top[0].job.company, '→', top[0].score);
  /* dedupe key sanity across sources */
  const keys = new Set(liveJobs.map(j => U.dedupeKey(j.title, j.company)));
  check('dedupe keys unique enough', keys.size >= liveJobs.length * 0.9, keys.size + '/' + liveJobs.length);
}

/* ================= F. ANDROID ASSETS SYNC ================= */
section('F. Android APK assets in sync with web app');
const www = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www');
const assetsToCheck = ['index.html', 'css/styles.css', 'js/app.js', 'js/demo.js', 'js/gmail.js', 'js/jobs.js', 'js/llm.js', 'js/matcher.js', 'js/portfolio.js', 'js/storage.js', 'js/util.js'];
for (const a of assetsToCheck) {
  const web = fs.readFileSync(path.join(ROOT, a), 'utf8');
  let and = '';
  try { and = fs.readFileSync(path.join(www, a), 'utf8'); } catch (e) {}
  check(`android asset in sync: ${a}`, web === and, web === and ? '' : 'DIFFERS (' + a + ')');
}
check('android APK built', fs.existsSync(path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')));

/* ---------- summary ---------- */
console.log('\n=========================================');
console.log(`RESULT: ${passes} passed, ${fails} failed`);
console.log('=========================================');
process.exit(fails ? 1 : 0);
})();
