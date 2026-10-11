/* ===== Laya — the personal decision engine =====
 * Laya looks at every shortlisted job and answers three questions:
 *   1. MATCH — how well does it fit the profile?        (Matcher)
 *   2. VALUE — how much is the opportunity worth?       (pay, level, company, perks)
 *   3. ODDS  — how likely is the profile to land it?    (coverage, exp, freshness, intent)
 * PRIORITY = 0.42·MATCH + 0.24·VALUE + 0.34·ODDS → a decision + human reasons.
 *
 * Everything here is pure and synchronous — it runs in realtime on every
 * filter/profile change with no network. The optional LLM pass (Laya AI,
 * via llm.js) adds a plain-language translation, a readiness audit and a
 * cover note; its verdicts are cached in localStorage (see Store).
 *
 * This module must not touch the DOM.
 */

const Laya = (() => {

  /* ============================ salary ============================ */

  /** Parse a salary out of free text. Returns {min, max, currency} or null.
   *  Handles "$120k - $180k", "₹25-40 LPA", "25 - 40 lakhs", "₹12,00,000 - ₹18,00,000",
   *  "€60,000–80,000", "150,000+ USD", "up to 40 LPA". */
  function parseSalary(text) {
    const raw = String(text || '');
    if (!raw) return null;
    // join digit-grouping commas: "12,00,000" · "1,200,000" · "60,000" (keeps "costs $5, free" style commas? those aren't between digits)
    const t = raw.replace(/(\d),(\d)/g, '$1$2');
    const cur = t.match(/[$₹£€]|\bUSD\b|\bINR\b|\bLPA\b|\blakhs?\b/i);
    if (!cur) return null;
    const currency = /₹|INR|LPA|lakh/i.test(cur[0]) ? 'INR'
      : cur[0] === '£' ? 'GBP'
      : cur[0] === '€' ? 'EUR' : 'USD';
    const win = t.slice(Math.max(0, cur.index - 8), cur.index + 70).toLowerCase();
    const lakh = /lpa|lakh/.test(win);
    const toAbs = (v, hasK) => {
      const n = parseFloat(v);
      if (!isFinite(n)) return null;
      if (hasK) return Math.round(n * 1000);
      if (lakh && n <= 200) return Math.round(n * 100000); // "25 LPA" → 25,00,000/yr
      return Math.round(n);
    };
    // range: 120k-180k · 25 - 40 lpa · $120000 - $180000 · 25-40 lakhs
    let m = win.match(/(\d+(?:\.\d+)?)\s*(k)?\s*(?:-|–|—|to)\s*(?:[$₹£€]?\s*)?(\d+(?:\.\d+)?)\s*(k)?/);
    if (m) {
      const min = toAbs(m[1], !!m[2]);
      const max = toAbs(m[3], !!m[4]);
      if (min != null && max != null && max >= min && sane(min, max, currency)) {
        return { min, max, currency };
      }
    }
    // single: "$150k" · "40+ LPA" · "up to 90k"
    m = win.match(/(\d+(?:\.\d+)?)\s*(k)?/);
    if (m) {
      const v = toAbs(m[1], !!m[2]);
      if (v != null && sane(v, v, currency)) return { min: v, max: v, currency };
    }
    return null;
  }

  /** Sanity window per currency (annual figures) — rejects false hits like "$5". */
  function sane(min, max, currency) {
    if (currency === 'INR') return min >= 200000 && max <= 25000000;
    return min >= 10000 && max <= 1500000;
  }

  const BENCH = {   // rough annual medians by currency and level band
    USD: { mid: 110000, senior: 150000 },
    EUR: { mid: 65000,  senior: 85000 },
    GBP: { mid: 60000,  senior: 80000 },
    INR: { mid: 2200000, senior: 4000000 }
  };

  function formatSalary(s) {
    if (!s) return null;
    const sym = { USD: '$', EUR: '€', GBP: '£', INR: '₹' }[s.currency] || '';
    if (s.currency === 'INR') {
      const l = (v) => (v / 100000).toFixed(v % 100000 === 0 ? 0 : 1);
      return sym + (s.min === s.max ? l(s.min) : l(s.min) + '–' + l(s.max)) + ' LPA';
    }
    const k = (v) => Math.round(v / 1000) + 'k';
    return sym + (s.min === s.max ? k(s.min) : k(s.min) + '–' + sym + k(s.max)) + '/yr';
  }

  /** 0-100 pay score vs the benchmark band for this level + currency. */
  function salaryScore(salary, level) {
    if (!salary) return 55;                      // unknown → neutral, never punished hard
    const seniorish = /senior|staff|lead|principal/.test(level || '');
    const bench = (BENCH[salary.currency] || BENCH.USD)[seniorish ? 'senior' : 'mid'];
    const best = salary.max || salary.min;
    return clamp(bandScore(best / bench));
  }
  function bandScore(r) {
    if (r >= 1.45) return 100;
    if (r >= 1.0) return 78 + (r - 1.0) / 0.45 * 22;
    if (r >= 0.8) return 62 + (r - 0.8) / 0.2 * 16;
    if (r >= 0.6) return 42 + (r - 0.6) / 0.2 * 20;
    if (r >= 0.35) return 15 + (r - 0.35) / 0.25 * 27;
    return Math.max(0, Math.round((r / 0.35) * 15));
  }

  /* ============================ level ============================ */

  /** Seniority from the title (description as fallback). Returns {level, fit, unknown}. */
  function detectLevel(title, desc) {
    const t = ' ' + String(title || '').toLowerCase() + ' ';
    const d = String(desc || '').toLowerCase().slice(0, 300);
    const FIT = {
      intern: 8, junior: 30, mid: 58, senior: 96,
      lead: 90, staff: 86, principal: 68, manager: 74
    };
    const pick = (lv) => ({ level: lv, fit: FIT[lv], unknown: false });
    if (/\bintern|\btrainee/.test(t)) return pick('intern');
    if (/\b(junior|jr\.?|entry.level|graduate|associate)\b/.test(t)) return pick('junior');
    if (/\bprincipal\b|\bdistinguished\b/.test(t)) return pick('principal');
    if (/\bstaff\b/.test(t)) return pick('staff');
    if (/\b(lead|manager|head of|director|vp\b)/.test(t)) return pick(/lead/.test(t) ? 'lead' : 'manager');
    if (/\b(senior|sr\.?|snr)\b/.test(t)) return pick('senior');
    if (/\bmid\b|\bintermediate\b/.test(t)) return pick('mid');
    if (/\bsenior\b/.test(d)) return pick('senior');
    return { level: 'mid', fit: 64, unknown: true };   // unstated → gentle neutral
  }

  /* ==================== company + perks signals ==================== */

  function companySignals(job) {
    const hay = (job.title + ' ' + job.company + ' ' + String(job.description || '').slice(0, 500)).toLowerCase();
    let s = 25;
    if (/\b(ai|a\.i\.|artificial intelligence|llm|genai|generative|machine learning|\bml\b|data science|nlp|deep learning|computer vision|robotics)\b/.test(hay)) s += 38;
    if (/\b(google|microsoft|amazon web|aws\b|meta\b|openai|anthropic|nvidia|deepmind|apple|netflix|stripe|databricks|palantir|sarvam|quantiphi|fractal|haptik|infosys|tcs\b|wipro|accenture|cognizant|capgemini|zoho|freshworks|razorpay|flipkart|swiggy|paytm)\b/.test(hay)) s += 18;
    if (/series [a-e]|unicorn|funded|ipo\b|fortune|enterprise|global|billion|million users|10,?000\+|world.?s largest/.test(hay)) s += 12;
    if (/immediate|multiple (positions|openings)|grow(ing)? (the )?team|fast.paced|hyper.?growth/.test(hay)) s += 7;
    return clamp(s);
  }

  function perksScore(job) {
    const hay = (String(job.description || '').slice(0, 800) + ' ' +
      (Array.isArray(job.tags) ? job.tags.join(' ') : '')).toLowerCase();
    let hits = 0;
    const re = /remote|work from home|flexible hours|equity|esop|health insurance|insurance cover|learning budget|4-day|four.day|async|home office|relocation|visa sponsor|annual bonus|performance bonus|wellness/g;
    while (re.exec(hay) !== null) { hits++; if (hits >= 6) break; }
    return clamp(30 + hits * 14);
  }

  /* ==================== freshness + intent ==================== */

  function freshnessDays(job, now) {
    const ts = job.postedAt || job.firstSeen || null;
    if (!ts) return null;
    return Math.max(0, Math.floor(((now || Date.now()) - ts) / 86400000));
  }
  function freshnessScore(days) {
    if (days == null) return 58;
    if (days <= 2) return 100;
    if (days <= 7) return 88;
    if (days <= 14) return 74;
    if (days <= 30) return 58;
    if (days <= 60) return 40;
    return 25;
  }
  function freshnessLabel(days) {
    if (days == null) return 'age unknown';
    if (days <= 1) return 'fresh today';
    if (days <= 2) return '2d fresh';
    if (days <= 7) return 'this week';
    if (days <= 14) return '2wks old';
    if (days <= 30) return '1mo old';
    return days <= 60 ? '2mo old' : 'stale';
  }
  /** A recruiter who actually emailed you beats a random board row. */
  function sourceIntent(job) {
    if (job.source === 'gmail') return 100;
    if (job.source === 'demo') return 70;
    return 55;
  }

  /* ==================== fit components ==================== */

  function skillCoverage(match, profile) {
    const denom = Math.min(12, Math.max(4, (profile.skills || []).length));
    return clamp(Math.round(((match.matchedSkills || []).length / denom) * 100));
  }

  function expFit(job, profile) {
    const required = Matcher.requiredYears(job.description);
    const years = profile.years;
    if (required == null) return { pct: 70, required: null };
    if (years == null) return { pct: 55, required };
    if (years >= required) return { pct: 100, required };
    if (years >= required - 1) return { pct: 68, required };
    if (years >= required - 2) return { pct: 45, required };
    return { pct: 22, required };
  }

  function roleFit(job, profile) {
    const titleTokens = String(job.title || '').toLowerCase().split(/[^a-z0-9+#.]+/);
    let best = 0;
    for (const role of profile.roles || []) {
      const toks = String(role).toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean);
      if (!toks.length) continue;
      const hit = toks.filter(t => {
        const alts = (Matcher.ROLE_SYNONYMS && Matcher.ROLE_SYNONYMS[t]) || [];
        return titleTokens.includes(t) || alts.some(a => titleTokens.includes(a));
      }).length;
      best = Math.max(best, hit / toks.length);
    }
    return clamp(Math.round(best * 100));
  }

  function locFit(job, profile) {
    if (job.remote && profile.remoteOk) return 100;
    const jl = String(job.location || '').toLowerCase();
    const hit = (profile.locations || []).some(l =>
      l && l.length > 2 && (jl.includes(String(l).toLowerCase()) || String(l).toLowerCase().includes(jl)));
    if (hit) return 95;
    if (job.remote) return 30;
    return 35;
  }

  /* ==================== requirements + readiness ==================== */

  /** Pull requirement-looking lines out of a job description. */
  function extractRequirements(job) {
    const text = Util.stripHtml(job.description || '');
    const lines = text.split(/\n+/).map(s => s.trim());
    const out = [];
    const seen = {};
    const re = /(required|must have|must-have|experience|proficien|expertise|strong|solid|familiar|knowledge of|years|degree|bachelor|master|responsib|you will|nice to have|plus\b)/i;
    for (const line of lines) {
      if (line.length < 15 || line.length > 160) continue;
      const bullet = /^[-•*·]|^\d+[.)]/.test(line);
      if (!bullet && !re.test(line)) continue;
      const key = line.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(line.replace(/^[-•*·]\s*|^\d+[.)]\s*/, ''));
      if (out.length >= 10) break;
    }
    return out;
  }

  /** How ready is this profile for THIS job? Pure, instant. */
  function readiness(match, job, profile, cov, exp, role) {
    const percent = clamp(Math.round(0.5 * cov + 0.3 * exp.pct + 0.2 * role));

    const strengths = [];
    const topSkills = (match.matchedSkills || []).slice(0, 4);
    if (cov >= 40 && topSkills.length) {
      strengths.push('Stack overlap: ' + topSkills.join(', '));
    }
    if (exp.pct === 100 && exp.required != null) {
      strengths.push('Experience: clears the ' + exp.required + '+ yrs bar (you have ' + profile.years + ')');
    } else if (exp.required == null && (profile.years || 0) >= 6) {
      strengths.push('Experience: ' + profile.years + '+ yrs — above the usual bar for this space');
    }
    if (role >= 60) strengths.push('Title lines up with your target roles');
    if (job.remote && profile.remoteOk) strengths.push('Remote / worldwide — location is a non-issue');
    if (job.source === 'gmail') strengths.push('Inbound interest — a recruiter reached out to you first');

    const gaps = [];
    if (exp.required != null && exp.pct < 100) {
      gaps.push('Asks for ' + exp.required + '+ yrs' +
        (profile.years != null ? ' (you have ' + profile.years + ')' : ''));
    }
    for (const req of extractRequirements(job)) {
      const hay = req.toLowerCase();
      const hit = (profile.skills || []).some(s =>
        Matcher.textHas(hay, String(s).toLowerCase())) ||
        (profile.roles || []).some(r => {
          const toks = String(r).toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean);
          return toks.some(t => Matcher.textHas(hay, t));
        });
      if (!hit) { gaps.push(Util.truncate(req, 72)); }
      if (gaps.length >= 5) break;
    }
    return { percent, strengths, gaps };
  }

  /* ==================== the composite ==================== */

  function decisionOf(priority) {
    if (priority >= 78) return { label: 'Apply now', icon: '🚀', cls: 'good' };
    if (priority >= 62) return { label: 'Prepare & apply', icon: '🟡', cls: 'warn' };
    if (priority >= 45) return { label: 'Worth watching', icon: '👀', cls: 'info' };
    return { label: 'Low priority', icon: '💤', cls: 'off' };
  }

  /** Full local dossier for one match — pure, synchronous, realtime. */
  function analyze(match, profile, now) {
    const job = match.job || match;
    const days = freshnessDays(job, now);
    const salary = parseSalary(
      [job.salary, job.title, job.description,
        (Array.isArray(job.tags) ? job.tags.join(' ') : '')].join(' '));
    const level = detectLevel(job.title, job.description);

    const payScore = salaryScore(salary, level.level);
    const company = companySignals(job);
    const value = clamp(Math.round(
      0.40 * payScore + 0.25 * level.fit + 0.20 * company + 0.15 * perksScore(job)));

    const cov = skillCoverage(match, profile);
    const exp = expFit(job, profile);
    const role = roleFit(job, profile);
    const loc = locFit(job, profile);
    const fresh = freshnessScore(days);
    const intent = sourceIntent(job);

    let odds = Math.round(0.34 * cov + 0.20 * exp.pct + 0.16 * role +
      0.10 * loc + 0.10 * fresh + 0.10 * intent);
    if (level.fit < 40) odds = Math.round(odds * 0.92);   // seniority mismatch damps odds

    const readinessR = readiness(match, job, profile, cov, exp, role);

    // AI re-rank blends into MATCH when present (two independent judges)
    const matchBase = match.aiScore != null
      ? Math.round(0.65 * match.score + 0.35 * match.aiScore)
      : match.score;

    const priority = clamp(Math.round(0.42 * matchBase + 0.24 * value + 0.34 * odds));

    return {
      priority,
      decision: decisionOf(priority),
      match: { score: match.score, aiScore: match.aiScore != null ? match.aiScore : null, blended: matchBase },
      value,
      odds,
      parts: {
        value: { pay: payScore, level: level.fit, company, perks: perksScore(job) },
        odds: { skills: cov, exp: exp.pct, role, loc, fresh, intent }
      },
      salary,
      salaryText: formatSalary(salary),
      level: level.level,
      levelUnknown: level.unknown,
      levelFit: level.fit,
      daysOld: days,
      freshLabel: freshnessLabel(days),
      intent,
      requirements: extractRequirements(job),
      readiness: readinessR
    };
  }

  /** Rank matches by priority (returns [{m, a}] pairs, best first). */
  function rank(matches, profile, now) {
    const rows = matches.map(m => ({ m, a: analyze(m, profile, now) }));
    rows.sort((x, y) => y.a.priority - x.a.priority);
    return rows;
  }

  /* ==================== plain-language translation ==================== */

  const TECH = [   // [regex fragment, display name]
    ['python', 'python'], ['go', 'go'], ['java(?!script)', 'java'], ['typescript', 'typescript'],
    ['javascript', 'javascript'], ['react', 'react'], ['node', 'node'], ['fastapi', 'fastapi'],
    ['django', 'django'], ['pytorch', 'pytorch'], ['tensorflow', 'tensorflow'],
    ['langchain', 'langchain'], ['langgraph', 'langgraph'], ['\\bllm\\b', 'LLM'], ['\\brag\\b', 'RAG'],
    ['genai|generative ai', 'genai'], ['\\bnlp\\b', 'NLP'], ['mlops', 'mlops'],
    ['kubernetes|k8s', 'kubernetes'], ['docker', 'docker'], ['\\baws\\b', 'AWS'],
    ['\\bgcp\\b', 'GCP'], ['azure', 'azure'], ['vertex', 'vertex ai'], ['sagemaker', 'sagemaker'],
    ['openai', 'openai'], ['gemini', 'gemini'], ['\\bsql\\b', 'sql'], ['postgres', 'postgres'],
    ['redis', 'redis'], ['mongodb', 'mongodb'], ['qdrant', 'qdrant'], ['pinecone', 'pinecone'],
    ['weaviate', 'weaviate'], ['vector', 'vector db'], ['terraform', 'terraform'],
    ['linux', 'linux'], ['spark', 'spark'], ['airflow', 'airflow'], ['ci/?cd', 'CI/CD'],
    ['\\bgit\\b', 'git'], ['rest api', 'REST'], ['grpc', 'gRPC']
  ];

  /** Local (no-AI) translation of what this posting is really asking for. */
  function plainSummary(job, profile, a) {
    const out = [];
    const where = job.remote ? 'remote'
      : (job.location ? String(job.location) : 'location unstated');
    out.push({
      k: 'In one line',
      v: (a.levelUnknown ? '' : cap(a.level) + '-level ') + String(job.title || '').trim() + ' at ' + job.company +
        ' — ' + where + (a.salaryText ? ', pays ' + a.salaryText : ', pay not disclosed')
    });

    const desc = Util.stripHtml(job.description || '');
    const m = desc.match(/[^.\n]*(?:you will|responsib|build|design|develop|own|lead|architect|ship)[^.\n]*/i);
    if (m) out.push({ k: 'What you would do', v: Util.truncate(m[0].trim(), 160) });

    const hay = desc.toLowerCase() + ' ' + (Array.isArray(job.tags) ? job.tags.join(' ').toLowerCase() : '');
    const techs = [];
    for (const t of TECH) {
      if (new RegExp('(^|[^a-z])(' + t[0] + ')([^a-z]|$)').test(hay) && !techs.includes(t[1])) {
        techs.push(t[1]);
      }
      if (techs.length >= 8) break;
    }
    if (techs.length) out.push({ k: 'Must-have stack', v: techs.join(', ') });

    const required = Matcher.requiredYears(desc);
    out.push({
      k: 'Experience bar',
      v: required != null
        ? required + '+ yrs mentioned (you have ' + (profile.years != null ? profile.years : '?') +
          (profile.years != null && profile.years >= required ? ' — you clear it' : ' — gap') + ')'
        : 'not stated (typical for this level: ' + (a.level === 'senior' ? '5-8+' : '2-5') + ' yrs)'
    });
    out.push({
      k: 'Work setup',
      v: (job.remote ? 'Remote' : /hybrid/i.test(desc) ? 'Hybrid' : 'Onsite') +
        (job.location ? ' · ' + job.location : '')
    });
    const signals = [];
    if (a.daysOld != null && a.daysOld <= 2) signals.push('posted ' + (a.daysOld === 0 ? 'today' : 'yesterday'));
    if (job.source === 'gmail') signals.push('recruiter emailed you directly');
    if (/immediate|multiple (positions|openings)|hyper.?growth/.test(desc.toLowerCase())) signals.push('hiring urgently');
    if (/contract|c2c|freelance/i.test(desc + ' ' + job.title)) signals.push('contract role');
    if (/visa sponsor/i.test(desc)) signals.push('visa sponsorship mentioned');
    if (signals.length) out.push({ k: 'Signals', v: signals.join(' · ') });
    return out;
  }

  /** One-line "why is it ranked here" for decision cards. */
  function explain(a) {
    const d = a.decision;
    if (d.cls === 'good') {
      return 'Strong fit (' + a.match.blended + ' match) with ' + a.odds + '% odds' +
        (a.salaryText ? ' and ' + a.salaryText : '') + ' — act this week.';
    }
    if (d.cls === 'warn') {
      const gap = (a.readiness.gaps && a.readiness.gaps[0]) || 'a few gaps to close';
      return 'Solid ' + a.match.blended + '/100 match, ' + a.odds + '% odds — ' + gap.toLowerCase() + '.';
    }
    if (d.cls === 'info') {
      return 'Partial fit (' + a.match.blended + ' match, ' + a.odds + '% odds) — keep warm, no rush.';
    }
    return 'Weak signal for your profile (' + a.match.blended + ' match) — deprioritise.';
  }

  /* ==================== Laya AI (optional LLM pass) ==================== */

  function fingerprint(profile) {
    const s = [(profile.name || ''), profile.years, (profile.roles || []).join(','),
      (profile.skills || []).join(',')].join('|').toLowerCase();
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'f' + h.toString(36);
  }

  function buildPrompt(job, profile, a, lang) {
    const ctx = profile.aiContext || '';
    const sys = 'You are Laya, the personal AI decision-maker of the candidate. ' +
      'You judge job postings against the candidate profile like a blunt, honest mentor: ' +
      'no flattery, no filler. Respond with ONLY valid JSON, no markdown, no code fences.';
    const jobJson = {
      title: job.title, company: job.company,
      location: job.location || (job.remote ? 'remote' : 'unstated'),
      remote: !!job.remote, source: job.source,
      salary: a.salaryText || 'not disclosed',
      level: a.level,
      requirements: a.requirements.slice(0, 8),
      local_metrics: {
        match: a.match.blended, value: a.value, odds: a.odds,
        readiness_percent: a.readiness.percent,
        known_strengths: a.readiness.strengths,
        known_gaps: a.readiness.gaps
      }
    };
    const user =
      'CANDIDATE PROFILE: ' + ctx + '\n' +
      'Skills: ' + (profile.skills || []).join(', ') + '\n' +
      'Target roles: ' + (profile.roles || []).join(', ') + '\n' +
      'Experience: ' + (profile.years != null ? profile.years + ' years' : 'unspecified') +
      '. Based in ' + (profile.locations || []).join('/') + '. Open to remote: ' + (profile.remoteOk ? 'yes' : 'no') + '.\n\n' +
      'JOB (JSON): ' + JSON.stringify(jobJson) + '\n\n' +
      'TASK — judge this single job for this candidate and return JSON with EXACTLY these keys:\n' +
      '{"readiness_percent": <0-100 int>, "odds_percent": <0-100 chance of an interview call>,\n' +
      ' "verdict": "<one decisive sentence>",\n' +
      ' "what_it_really_means": "<2-3 sentences translating the posting into plain talk: what they want, what the day looks like, any catch>",\n' +
      ' "strengths": ["<max 4 short bullets why the candidate fits>"],\n' +
      ' "gaps": ["<max 4 short bullets what is missing or risky>"],\n' +
      ' "cover_note": "<a 4-6 line ready-to-send application note in first person, confident, concrete, referencing CLINIRISE and the stack>",\n' +
      ' "action": "apply" | "prepare" | "watch" | "skip"}\n' +
      (lang === 'hi'
        ? 'Write "verdict", "what_it_really_means", "strengths", "gaps" and "cover_note" in HINDI (Devanagari). Keep keys and numbers as-is.\n'
        : 'Write all narrative fields in clear simple English.\n') +
      'Judge only from the data given. Be specific, never generic.';
    return { sys, user };
  }

  /** Robustly parse the model's JSON (tolerates fences + prose). */
  function parseAIJson(text) {
    const s = String(text || '').replace(/```json|```/gi, '').trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Laya AI returned no parsable JSON');
    let v;
    try { v = JSON.parse(s.slice(start, end + 1)); }
    catch (e) { throw new Error('Laya AI JSON was malformed — try again'); }
    const num = (x, d) => {
      const n = Math.round(Number(x));
      return isFinite(n) ? clamp(n) : d;
    };
    const arr = (x, max) => Array.isArray(x)
      ? x.filter(i => i != null && String(i).trim()).map(i => String(i).slice(0, 220)).slice(0, max)
      : [];
    return {
      readiness_percent: num(v.readiness_percent, null),
      odds_percent: num(v.odds_percent, null),
      verdict: String(v.verdict || '').slice(0, 300),
      what_it_really_means: String(v.what_it_really_means || '').slice(0, 900),
      strengths: arr(v.strengths, 4),
      gaps: arr(v.gaps, 4),
      cover_note: String(v.cover_note || '').slice(0, 1200),
      action: /^(apply|prepare|watch|skip)$/i.test(String(v.action || '')) ? v.action.toLowerCase() : null
    };
  }

  /* ==================== utils ==================== */

  function clamp(n) { return Math.max(0, Math.min(100, Math.round(Number(n) || 0))); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  return {
    VERSION: 1,
    parseSalary, formatSalary, salaryScore, bandScore,
    detectLevel, companySignals, perksScore,
    freshnessDays, freshnessScore, freshnessLabel, sourceIntent,
    skillCoverage, expFit, roleFit, locFit,
    extractRequirements, readiness,
    decisionOf, analyze, rank, plainSummary, explain,
    fingerprint, buildPrompt, parseAIJson
  };
})();
