/* Laya decision-engine test (run with: node tests/laya.test.js) */
const fs = require('fs');
const vm = require('vm');

const sandbox = {
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  decodeURIComponent, encodeURIComponent, console
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(__dirname + '/../js/util.js', 'utf8') +
  fs.readFileSync(__dirname + '/../js/matcher.js', 'utf8') +
  fs.readFileSync(__dirname + '/../js/laya.js', 'utf8') +
  '; globalThis.__L = Laya; globalThis.__U = Util; globalThis.__M = Matcher;',
  sandbox
);
const Laya = sandbox.__L;

let fails = 0, passes = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (cond) passes++; else fails++;
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : ' — got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)));
  if (ok) passes++; else fails++;
}

const profile = {
  name: 'Satyabhan', years: 8,
  skills: ['llm', 'rag', 'langchain', 'python', 'docker', 'kubernetes', 'vertex ai', 'genai'],
  roles: ['ai engineer', 'genai engineer', 'mlops engineer'],
  locations: ['pune', 'india'], remoteOk: true,
  aiContext: 'Senior AI Engineer with 8+ years. Shipped CLINIRISE, a multi-agent WhatsApp AI CRM.'
};

const NOW = Date.now();

/* ================= salary parsing ================= */
eq('parseSalary: $120k-$180k', Laya.parseSalary('$120k - $180k a year'), { min: 120000, max: 180000, currency: 'USD' });
eq('parseSalary: INR LPA', Laya.parseSalary('Salary: ₹25-40 LPA'), { min: 2500000, max: 4000000, currency: 'INR' });
eq('parseSalary: lakhs wording', Laya.parseSalary('we pay 25 - 40 lakhs per annum'), { min: 2500000, max: 4000000, currency: 'INR' });
eq('parseSalary: INR full figures', Laya.parseSalary('₹12,00,000 - ₹18,00,000 per year'), { min: 1200000, max: 1800000, currency: 'INR' });
eq('parseSalary: EUR range', Laya.parseSalary('€60,000–80,000 depending on experience'), { min: 60000, max: 80000, currency: 'EUR' });
eq('parseSalary: single value', Laya.parseSalary('150,000+ USD annually'), { min: 150000, max: 150000, currency: 'USD' });
eq('parseSalary: none', Laya.parseSalary('We offer a great culture and growth.'), null);
eq('parseSalary: rejects $5 noise', Laya.parseSalary('it costs $5 to apply (never real)'), null);

eq('formatSalary USD', Laya.formatSalary({ min: 120000, max: 180000, currency: 'USD' }), '$120k–$180k/yr');
eq('formatSalary INR', Laya.formatSalary({ min: 2500000, max: 4000000, currency: 'INR' }), '₹25–40 LPA');
eq('formatSalary null', Laya.formatSalary(null), null);

/* ================= salary score ================= */
check('salaryScore: strong pay beats neutral', Laya.salaryScore({ min: 200000, max: 240000, currency: 'USD' }, 'senior') > 85);
check('salaryScore: weak pay below neutral', Laya.salaryScore({ min: 45000, max: 50000, currency: 'USD' }, 'senior') < 45);
eq('salaryScore: unknown = neutral 55', Laya.salaryScore(null, 'senior'), 55);
check('salaryScore: INR 40 LPA is strong in India', Laya.salaryScore({ min: 4000000, max: 4800000, currency: 'INR' }, 'senior') > 80);

/* ================= level detection ================= */
eq('detectLevel: senior', Laya.detectLevel('Senior AI Engineer', '').level, 'senior');
eq('detectLevel: junior', Laya.detectLevel('Junior Python Developer', '').level, 'junior');
eq('detectLevel: manager', Laya.detectLevel('Engineering Manager, AI Platform', '').level, 'manager');
eq('detectLevel: intern', Laya.detectLevel('AI Research Intern', '').level, 'intern');
eq('detectLevel: staff', Laya.detectLevel('Staff ML Engineer', '').level, 'staff');
eq('detectLevel: lead', Laya.detectLevel('Tech Lead — GenAI', '').level, 'lead');
const unk = Laya.detectLevel('Platform Engineer', 'build things');
check('detectLevel: unstated is flagged unknown', unk.unknown === true && unk.level === 'mid');
check('levelFit: senior 96', Laya.detectLevel('Senior AI Engineer', '').fit === 96);
check('levelFit: intern 8', Laya.detectLevel('Intern', '').fit === 8);

/* ================= signals ================= */
check('companySignals: AI company outscores generic', Laya.companySignals({
  title: 'LLM Engineer', company: 'Sarvam AI',
  description: 'We build large language models and generative AI products. Fast-paced, funded, growing team.'
}) > Laya.companySignals({
  title: 'Accountant', company: 'Local Taxes Ltd', description: 'File quarterly paperwork and maintain ledgers.'
}));
check('companySignals capped at 100', Laya.companySignals({
  title: 'AI LLM GenAI Engineer', company: 'google',
  description: 'Fortune 500 enterprise, global, 10,000+ employees, immediate, multiple openings, unicorn, AI machine learning generative NLP'
}) <= 100);

/* ================= freshness + intent ================= */
eq('freshnessScore: fresh', Laya.freshnessScore(0), 100);
eq('freshnessScore: 10d', Laya.freshnessScore(10), 74);
eq('freshnessScore: 45d', Laya.freshnessScore(45), 40);
eq('freshnessScore: unknown', Laya.freshnessScore(null), 58);
eq('freshnessLabel: 1d', Laya.freshnessLabel(1), 'fresh today');
eq('freshnessDays', Laya.freshnessDays({ postedAt: NOW - 3 * 86400000 }, NOW), 3);
eq('sourceIntent: gmail lead is top', Laya.sourceIntent({ source: 'gmail' }), 100);
check('sourceIntent: board is mid', Laya.sourceIntent({ source: 'remotive' }) > 40 && Laya.sourceIntent({ source: 'remotive' }) < 80);

/* ================= fit components ================= */
const strongJob = {
  id: 'j1', source: 'remotive', title: 'Senior GenAI Engineer (LLM + RAG)',
  company: 'Quantiphi', location: 'Remote — Worldwide', remote: true,
  postedAt: NOW - 2 * 86400000, url: 'https://x.example/j1', tags: ['llm', 'rag'],
  description: 'We are building generative AI products. You will design multi-agent LLM systems and RAG pipelines with LangChain on Vertex AI.\n\n' +
    'Requirements:\n- 7+ years of software experience\n- Strong Python and Docker skills\n- Experience with Kubernetes and LLM fine-tuning\n- Must have production GenAI experience\n\n' +
    'We offer $150k - $190k a year, health insurance, equity and flexible hours.'
};
const weakJob = {
  id: 'j2', source: 'arbeitnow', title: 'Nursing Assistant',
  company: 'City Care', location: 'Berlin, Germany', remote: false,
  postedAt: NOW - 70 * 86400000, url: 'https://x.example/j2', tags: [],
  description: 'Care for patients in a hospital ward. Requires compassion and a nursing degree. 2+ years of hospital experience needed.'
};
const strongMatch = { job: strongJob, ...sandbox.__M.score(profile, strongJob) };
const weakMatch = { job: weakJob, ...sandbox.__M.score(profile, weakJob) };

check('expFit: meets bar', Laya.expFit(strongJob, profile).pct === 100);
eq('expFit: parses 7+ yrs', Laya.expFit(strongJob, profile).required, 7);
check('expFit: near-miss (1 yr under) is 68', (() => {
  const j = { description: 'requires 9+ years experience' };
  return Laya.expFit(j, profile).pct === 68;
})());
check('expFit: 2-yr gap is 45', Laya.expFit({ description: 'requires 10+ years experience' }, profile).pct === 45);
check('roleFit: strong on target role', Laya.roleFit(strongJob, profile) >= 60);
eq('locFit: remote ok', Laya.locFit(strongJob, profile), 100);
eq('locFit: remote but profile refuses', Laya.locFit({ remote: true }, { remoteOk: false, locations: [] }), 30);
check('skillCoverage: bounded 0-100', Laya.skillCoverage(strongMatch, profile) > 30 && Laya.skillCoverage(strongMatch, profile) <= 100);

/* ================= requirements + readiness ================= */
const reqs = Laya.extractRequirements(strongJob);
check('extractRequirements finds requirement bullets', reqs.length >= 3 && reqs.some(r => /python/i.test(r)));
const read = Laya.readiness(strongMatch, strongJob, profile,
  Laya.skillCoverage(strongMatch, profile), Laya.expFit(strongJob, profile), Laya.roleFit(strongJob, profile));
check('readiness percent bounded', read.percent > 0 && read.percent <= 100);
check('readiness has strengths', read.strengths.length >= 2);
check('readiness catches a gap when skill missing', (() => {
  const p2 = Object.assign({}, profile, { skills: ['llm', 'rag', 'python'] });
  const m2 = { job: strongJob, ...sandbox.__M.score(p2, strongJob) };
  const r2 = Laya.readiness(m2, strongJob, p2,
    Laya.skillCoverage(m2, p2), Laya.expFit(strongJob, p2), Laya.roleFit(strongJob, p2));
  return r2.gaps.length >= 1;
})());

/* ================= decisions ================= */
eq('decisionOf 80', Laya.decisionOf(80).label, 'Apply now');
eq('decisionOf 65', Laya.decisionOf(65).label, 'Prepare & apply');
eq('decisionOf 50', Laya.decisionOf(50).label, 'Worth watching');
eq('decisionOf 20', Laya.decisionOf(20).label, 'Low priority');

/* ================= analyze — the composite ================= */
const a1 = Laya.analyze(strongMatch, profile, NOW);
const a2 = Laya.analyze(weakMatch, profile, NOW);
check('analyze strong: priority bounded', a1.priority > 0 && a1.priority <= 100);
check('analyze strong: lands in Apply/Prepare', a1.priority >= 62);
check('analyze strong: value healthy', a1.value >= 55);
check('analyze strong: odds healthy', a1.odds >= 50);
check('analyze strong: salary parsed', a1.salaryText && a1.salaryText.includes('$'));
check('analyze strong: level senior', a1.level === 'senior');
check('analyze strong: fresh label', a1.freshLabel === '2d fresh');
check('analyze weak: low priority', a2.priority < 45);
check('analyze weak: decision Low priority', a2.decision.label === 'Low priority');
check('analyze strong beats weak', a1.priority - a2.priority > 30);
check('analyze: aiScore blends match', (() => {
  const blend = Laya.analyze(Object.assign({}, strongMatch, { aiScore: 0 }), profile, NOW);
  return blend.match.blended < strongMatch.score && blend.match.blended > 0.6 * strongMatch.score - 2;
})());
check('analyze: readiness present', a1.readiness && typeof a1.readiness.percent === 'number');
check('analyze: requirements extracted', a1.requirements.length >= 3);

/* ================= rank ================= */
const ranked = Laya.rank([weakMatch, strongMatch], profile, NOW);
eq('rank: best first', ranked[0].m.job.id, 'j1');
check('rank: descending', ranked[0].a.priority >= ranked[1].a.priority);

/* ================= plain translation ================= */
const facts = Laya.plainSummary(strongJob, profile, a1);
check('plainSummary: has one-liner', facts[0].k === 'In one line' && /Quantiphi/.test(facts[0].v));
check('plainSummary: what you would do', facts.some(f => f.k === 'What you would do'));
check('plainSummary: must-have stack mentions LLM/RAG', (() => {
  const f = facts.find(f => f.k === 'Must-have stack');
  return f && /LLM|RAG/i.test(f.v);
})());
check('plainSummary: experience bar', facts.some(f => f.k === 'Experience bar' && /7\+/.test(f.v)));
check('plainSummary: work setup remote', facts.some(f => f.k === 'Work setup' && /Remote/.test(f.v)));
check('explain mentions odds', /odds/.test(Laya.explain(a1)));

/* ================= fingerprint + prompt + AI parsing ================= */
eq('fingerprint stable', Laya.fingerprint(profile), Laya.fingerprint(Object.assign({}, profile)));
check('fingerprint changes with skills', Laya.fingerprint(profile) !==
  Laya.fingerprint(Object.assign({}, profile, { skills: ['excel'] })));

const prompt = Laya.buildPrompt(strongJob, profile, a1, 'en');
check('buildPrompt: profile context included', /CLINIRISE/.test(prompt.user));
check('buildPrompt: strict JSON keys demanded', /readiness_percent/.test(prompt.user) && /cover_note/.test(prompt.user));
check('buildPrompt: english mode', !/HINDI/.test(prompt.user));
const promptHi = Laya.buildPrompt(strongJob, profile, a1, 'hi');
check('buildPrompt: hindi mode requested', /HINDI/.test(promptHi.user));

const aiRaw = 'Sure! Here is my analysis:\n```json\n{"readiness_percent": 128, "odds_percent": "70", ' +
  '"verdict": "Apply — your RAG work maps 1:1.", "what_it_really_means": "They want a hands-on LLM builder.", ' +
  '"strengths": ["RAG depth", "8 yrs", null], "gaps": [], "cover_note": "Hi team,", "action": "APPLY"}\n```';
const parsed = Laya.parseAIJson(aiRaw);
eq('parseAIJson: clamps readiness', parsed.readiness_percent, 100);
eq('parseAIJson: coerces odds', parsed.odds_percent, 70);
eq('parseAIJson: filters junk strengths', parsed.strengths.length, 2);
eq('parseAIJson: normalises action', parsed.action, 'apply');
check('parseAIJson: keeps verdict', /RAG/.test(parsed.verdict));
check('parseAIJson: throws on garbage', (() => {
  try { Laya.parseAIJson('I could not analyse that.'); return false; }
  catch (e) { return true; }
})());
check('parseAIJson: bad action becomes null', Laya.parseAIJson('{"action":"maybe"}').action === null);

/* ================= llm helpers ================= */
vm.runInContext(fs.readFileSync(__dirname + '/../js/llm.js', 'utf8') +
  '; globalThis.__LLM = LLM;', Object.assign(sandbox, { PORTFOLIO_PROFILE: { aiContext: 'x' } }));
const LLM = sandbox.__LLM;
check('LLM.hasKey false without key', LLM.hasKey({ aiProvider: 'groq', aiConfigs: { groq: { base: 'https://api.groq.com/openai/v1/', model: 'm', key: '' } } }) === false);
check('LLM.hasKey true with key', LLM.hasKey({ aiProvider: 'groq', aiConfigs: { groq: { base: 'https://api.groq.com/openai/v1/', model: 'm', key: 'k' } } }) === true);
eq('LLM.cfg trims trailing slash', LLM.cfg({ aiProvider: 'groq', aiConfigs: { groq: { base: 'https://api.groq.com/openai/v1/', key: 'k' } } }).base, 'https://api.groq.com/openai/v1');

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
