/* ===== Local matching engine — tuned for Satyabhan's AI/ML/GenAI profile ===== */
/* Scores each job 0-100. Components:
 *   Skills   — up to 40 pts  (title hit 9, body hit 5; priority bonus for core AI skills)
 *   Role fit — up to 30 pts  (token overlap + synonym expansion)
 *   Exp fit  — up to 20 pts  (parses "N+ years" from description)
 *   Location — up to 10 pts  (remote flag OR location match)
 *   Worldwide bonus — up to +5 pts (worldwide/global remote signal)
 * Total capped at 100.
 */

const Matcher = {

  /* ── High-value skills that deserve an extra title-hit bonus ── */
  CORE_AI_SKILLS: new Set([
    'llm', 'rag', 'genai', 'langchain', 'langgraph', 'vllm', 'qdrant',
    'vertex ai', 'gemini', 'multi-agent', 'ai agents', 'embeddings',
    'fine-tuning', 'mlops', 'llmops', 'prompt engineering', 'hugging face',
    'pytorch', 'transformers', 'vector database'
  ]),

  score(profile, job) {
    const reasons = [];
    const matchedSkills = [];

    const title = String(job.title || '').toLowerCase();
    const desc  = String(job.description || '').toLowerCase();
    const tags  = Array.isArray(job.tags) ? job.tags.join(' ').toLowerCase() : '';
    const text  = title + ' ' + desc + ' ' + tags;

    /* ──────────── 1. Skills (up to 40 pts) ──────────── */
    const skills = (profile.skills || [])
      .map(s => String(s).toLowerCase().trim())
      .filter(Boolean);

    let skillPts = 0;
    const inTitle = [], inDesc = [];

    for (const s of skills) {
      if (!s) continue;
      const hitTitle = Matcher.textHas(title, s);
      const hitTags  = !hitTitle && Matcher.textHas(tags, s);
      const hitText  = hitTitle || hitTags || Matcher.textHas(desc, s);

      if (hitTitle) {
        matchedSkills.push(s);
        inTitle.push(s);
        // Core AI skills in title score higher — they're hard to fake
        skillPts += Matcher.CORE_AI_SKILLS.has(s) ? 12 : 9;
      } else if (hitText) {
        matchedSkills.push(s);
        inDesc.push(s);
        skillPts += Matcher.CORE_AI_SKILLS.has(s) ? 7 : 5;
      }
    }
    skillPts = Math.min(40, skillPts);

    if (inTitle.length) {
      reasons.push('Your skill <b>' + Util.escapeHtml(inTitle.join(', ')) + '</b> appears in the job title');
    } else if (inDesc.length) {
      reasons.push('Matches ' + inDesc.length + ' of your skills: <b>' +
        Util.escapeHtml(inDesc.slice(0, 6).join(', ')) + '</b>');
    }

    /* ──────────── 2. Role-title fit (up to 30 pts) ──────────── */
    const roles = (profile.roles || [])
      .map(r => String(r).toLowerCase().trim())
      .filter(Boolean);

    const titleTokens = title.split(/[^a-z0-9+#.]+/).filter(Boolean);
    let roleScore = 0, bestRole = null;

    for (const role of roles) {
      const roleTokens = role.split(/[^a-z0-9+#.]+/).filter(Boolean);
      if (!roleTokens.length) continue;

      const hit = roleTokens.filter(t => {
        const alts = Matcher.ROLE_SYNONYMS[t] || [];
        return titleTokens.includes(t) || alts.some(a => titleTokens.includes(a));
      }).length;

      const frac = hit / roleTokens.length;
      if (frac > roleScore / 30) {
        roleScore = Math.round(frac * 30);
        bestRole = role;
      }
    }
    if (bestRole && roleScore >= 15) {
      reasons.push('Title matches your target role "<b>' + Util.escapeHtml(bestRole) + '</b>"');
    }

    /* ──────────── 3. Experience fit (up to 20 pts) ──────────── */
    const profileYears = Util.toInt(profile.years);
    const required = Matcher.requiredYears(desc);
    let expPts = 0;

    if (required != null && profileYears != null) {
      if (profileYears >= required) {
        expPts = 20;
        reasons.push('Requires <b>' + required + '+ yrs</b> — you have ' + profileYears);
      } else if (profileYears >= required - 1) {
        expPts = 12;
        reasons.push('Close to the <b>' + required + '+ yrs</b> requirement (you have ' + profileYears + ')');
      } else {
        reasons.push('Asks for <b>' + required + '+ yrs</b> — you have ' + profileYears);
      }
    } else if (required != null && profileYears == null) {
      reasons.push('Requires <b>' + required + '+ yrs</b> (add your years to profile)');
    }

    /* ──────────── 4. Location / remote (up to 10 pts) ──────────── */
    const jobLocation = String(job.location || '').toLowerCase();
    let locPts = 0;

    if (job.remote && profile.remoteOk) {
      locPts = 10;
      // Check if truly worldwide (not restricted to specific countries)
      const isWorldwide = /worldwide|global|anywhere|distributed|international/i.test(jobLocation) ||
        jobLocation === '' || jobLocation === 'worldwide remote';
      reasons.push(isWorldwide ? 'Worldwide remote 🌍' : 'Remote-friendly');
    } else if (profile.locations && profile.locations.length) {
      const locs = profile.locations
        .map(l => String(l).toLowerCase().trim())
        .filter(Boolean);
      const hit = locs.find(l =>
        l.length > 2 && (jobLocation.includes(l) || l.includes(jobLocation))
      );
      if (hit) {
        locPts = 10;
        reasons.push('Based in <b>' + Util.escapeHtml(hit) + '</b>');
      }
    }

    // Worldwide bonus: jobs explicitly open to India / Asia / worldwide get a nudge
    let worldwidePts = 0;
    if (/worldwide|global|anywhere|india|asia|apac/i.test(jobLocation) && profile.remoteOk) {
      worldwidePts = 5;
      if (!reasons.some(r => r.includes('Worldwide'))) {
        reasons.push('Open to India / worldwide applicants 🌏');
      }
    }

    const total = Math.max(0, Math.min(100, skillPts + roleScore + expPts + locPts + worldwidePts));
    return { score: total, reasons, matchedSkills };
  },

  /** Smallest "N+ years" requirement mentioned in a description. */
  requiredYears(desc) {
    const re = /(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:years?|yrs?)/g;
    let m, best = null;
    while ((m = re.exec(String(desc || ''))) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 0 && n <= 30 && (best === null || n < best)) best = n;
    }
    return best;
  },

  /** Whole-word match for short tokens, substring otherwise. */
  textHas(haystack, needle) {
    if (!haystack || !needle) return false;
    if (needle.length <= 4) {
      return new RegExp(
        '(^|[^a-z0-9])' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)'
      ).test(haystack);
    }
    return haystack.includes(needle);
  },

  /** Role-token aliases — expanded for AI/ML domain coverage. */
  ROLE_SYNONYMS: {
    // GenAI / LLM
    'genai':       ['generative', 'ai', 'gen-ai', 'llm'],
    'generative':  ['genai', 'gen-ai', 'ai'],
    'llm':         ['large', 'language', 'genai', 'gpt'],
    'ai':          ['artificial', 'genai', 'intelligence'],
    // ML
    'ml':          ['machine', 'learning', 'ai'],
    'machine':     ['ml', 'learning'],
    'learning':    ['ml', 'machine'],
    // MLOps / LLMOps
    'mlops':       ['ml-ops', 'devops', 'llmops', 'aiops'],
    'llmops':      ['mlops', 'ml-ops'],
    'aiops':       ['mlops', 'devops'],
    // Data / NLP
    'nlp':         ['nlu', 'language', 'text', 'llm'],
    'rag':         ['retrieval', 'augmented', 'search'],
    'data':        ['analytics', 'science', 'scientist'],
    // Platform / Infra
    'platform':    ['infrastructure', 'infra', 'engineer'],
    'backend':     ['api', 'server', 'python', 'node'],
    'senior':      ['lead', 'staff', 'sr', 'principal'],
    'engineer':    ['developer', 'dev', 'programmer', 'swe'],
    'architect':   ['architecture', 'solutions', 'lead'],
    // Applied
    'applied':     ['research', 'production', 'engineering'],
    'research':    ['applied', 'scientist', 'researcher']
  }
};
