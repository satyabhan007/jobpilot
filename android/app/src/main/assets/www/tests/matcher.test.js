/* Matcher smoke test (run with: node tests/matcher.test.js) */
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
  '; globalThis.__M = Matcher; globalThis.__U = Util;',
  sandbox
);
const Matcher = sandbox.__M;

const profile = {
  name: 'Test', years: 4,
  skills: ['react', 'typescript', 'node.js'],
  roles: ['frontend developer'],
  locations: ['remote', 'bangalore'],
  remoteOk: true
};

const job = {
  id: 't1', source: 'test', title: 'Senior Frontend Developer (React/TypeScript)',
  company: 'Stripe', location: 'Remote (Europe)', remote: true,
  postedAt: Date.now(), url: 'https://x.example', tags: [],
  description: 'We are looking for a Senior Frontend Developer with 4+ years of experience. Build dashboards in React and TypeScript. Remote friendly.'
};

const r = Matcher.score(profile, job);
console.log('score:', r.score);
console.log('reasons:', r.reasons.join(' | '));
console.log('matched:', r.matchedSkills.join(', '));

let fails = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (!cond) fails++;
}

check('score in range', r.score > 0 && r.score <= 100);
check('score is strong (>=70)', r.score >= 70);
check('matched react', r.matchedSkills.includes('react'));
check('has experience reason', r.reasons.some(x => x.includes('4+ yrs')));
check('has remote reason', r.reasons.some(x => x === 'Remote-friendly'));

// irrelevant job should score low
const irrelevant = { id: 't2', title: 'Registered Nurse', company: 'Hospital', location: 'Delhi', remote: false, postedAt: Date.now(), url: '', description: 'Patient care, 2+ years nursing experience required.' };
const r2 = Matcher.score(profile, irrelevant);
console.log('irrelevant score:', r2.score);
check('irrelevant scores low (<25)', r2.score < 25);

// no-profile safety
const r3 = Matcher.score({ skills: [], roles: [], locations: [], remoteOk: false, years: null }, job);
check('empty profile does not crash', typeof r3.score === 'number');

process.exit(fails ? 1 : 0);
