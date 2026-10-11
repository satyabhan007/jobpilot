/* Profile integration test (run with: node tests/profile.test.js)
 * Verifies the portfolio profile (js/portfolio.js) flows into storage
 * defaults, the profile summary card data, and the matcher.
 */
const fs = require('fs');
const vm = require('vm');

/* minimal localStorage stub */
function makeLS() {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }
  };
}

const sandbox = {
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  decodeURIComponent, encodeURIComponent, console,
  localStorage: makeLS()
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(__dirname + '/../js/util.js', 'utf8') +
  fs.readFileSync(__dirname + '/../js/portfolio.js', 'utf8') +
  fs.readFileSync(__dirname + '/../js/storage.js', 'utf8') +
  fs.readFileSync(__dirname + '/../js/matcher.js', 'utf8') +
  '; globalThis.__P = PORTFOLIO_PROFILE; globalThis.__S = Store; globalThis.__M = Matcher;',
  sandbox
);
const P = sandbox.__P, Store = sandbox.__S, Matcher = sandbox.__M;

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (extra != null ? ' (' + extra + ')' : ''));
  if (!cond) fails++;
}

/* ---- portfolio data sanity ---- */
check('profile has a name', !!P.name);
check('name matches portfolio', P.name === 'Satyabhan Umed Bhadoriya', P.name);
check('8+ years', P.years >= 8, P.years);
check('skills list substantial', P.skills.length >= 20, P.skills.length + ' skills');
check('roles are AI-focused', P.roles.some(r => /ai|genai|llm|ml|mlops/i.test(r)));
check('location includes pune', P.locations.map(l => l.toLowerCase()).includes('pune'));
check('contact links present', !!(P.links && P.links.github && P.links.linkedin && P.links.email));
check('github handle correct', P.links.github.includes('github.com/satyabhan007'));
check('aiContext exists for LLM prompt', typeof P.aiContext === 'string' && P.aiContext.length > 50);

/* ---- storage defaults ---- */
const prof = Store.profile();
check('Store defaults to portfolio profile', prof.name === P.name && prof.years === P.years);
check('Store.profile keeps links', prof.links && prof.links.github === P.links.github);

/* stored overrides win, portfolio extras survive */
Store.saveProfile(Object.assign({}, prof, { years: 9 }));
check('saved override wins', Store.profile().years === 9);
check('override keeps portfolio links', Store.profile().links.github === P.links.github);
Store.resetToPortfolio();
check('reset restores portfolio', Store.profile().years === P.years);

/* ---- matcher vs his profile ---- */
const aiJob = {
  id: 'p1', source: 'test', title: 'Senior AI Engineer (GenAI / RAG)',
  company: 'Quantiphi', location: 'Pune / Hybrid', remote: false,
  postedAt: Date.now(), url: '', tags: [],
  description: 'Build RAG pipelines and multi-agent workflows with LangChain and LangGraph on GCP Vertex AI. Requires 6+ years of experience with Python, LLMs, vector databases like Qdrant, Docker and Kubernetes.'
};
const r = Matcher.score(Store.profile(), aiJob);
console.log('AI job score:', r.score);
console.log('reasons:', r.reasons.join(' | '));
check('AI job scores strong (>=80)', r.score >= 80, r.score);
check('rag matched as whole word', r.matchedSkills.includes('rag'));
check('genai role matched via synonym', r.reasons.some(x => x.includes('genai engineer') || x.includes('ai engineer')));

/* word-boundary guard: "storage" must not count as a "rag" hit */
const trapJob = {
  id: 'p2', title: 'Storage Administrator', company: 'Acme', location: 'Pune', remote: false,
  postedAt: Date.now(), url: '', tags: [],
  description: 'Manage storage arrays and backups. 5+ years of experience with SAN and NAS systems.'
};
const rTrap = Matcher.score(Store.profile(), trapJob);
console.log('storage-trap score:', rTrap.score);
check('storage does not fake-match rag', !rTrap.matchedSkills.includes('rag'));

/* synonym: "Generative AI Engineer" title matches 'genai engineer' target role */
const genJob = {
  id: 'p3', title: 'Generative AI Engineer', company: 'X', location: 'Remote', remote: true,
  postedAt: Date.now(), url: '', tags: [], description: 'LLM applications, 3+ years of experience.'
};
const rGen = Matcher.score(Store.profile(), genJob);
check('Generative AI Engineer title scores role points', rGen.score >= 25, rGen.score);

/* irrelevant job stays low */
const nurseJob = {
  id: 'p4', title: 'Registered Nurse', company: 'Hospital', location: 'Delhi', remote: false,
  postedAt: Date.now(), url: '', tags: [],
  description: 'Patient care, 2+ years nursing experience required.'
};
const rNurse = Matcher.score(Store.profile(), nurseJob);
console.log('irrelevant score:', rNurse.score);
check('irrelevant scores low (<25)', rNurse.score < 25, rNurse.score);

process.exit(fails ? 1 : 0);
