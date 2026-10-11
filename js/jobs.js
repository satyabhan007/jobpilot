/* ===== Job board sources — worldwide remote, AI/ML focused ===== */
/* Sources chosen for: remote-worldwide scope, free public API (no key), AI/tech relevance.
 * All results are pre-filtered for relevance to Satyabhan's AI/ML/GenAI/DevOps profile.
 * Add your own source by following the same shape and adding an <option> in index.html. */

/* ── Relevance pre-filter ──────────────────────────────────────────────────────────────
 * These keywords gate which jobs we keep from general boards.
 * If a job title or tags match ANY of these → include. Otherwise discard.
 * Keeps noise low on high-volume general boards (Arbeitnow, The Muse). */
const AI_KEYWORDS = [
  'ai', 'ml', 'machine learning', 'deep learning', 'genai', 'generative',
  'llm', 'large language', 'nlp', 'rag', 'retrieval', 'langchain', 'langgraph',
  'mlops', 'llmops', 'data science', 'data engineer', 'python', 'pytorch',
  'tensorflow', 'hugging face', 'transformers', 'vllm', 'vertex', 'gemini',
  'gpt', 'openai', 'vector', 'embedding', 'fine-tun', 'model', 'inference',
  'platform engineer', 'devops', 'cloud', 'backend', 'api', 'docker', 'kubernetes',
  'architect', 'full stack', 'fullstack', 'typescript', 'node', 'fastapi'
];

/** Returns true if title or tags text contain any AI_KEYWORDS */
function isRelevant(title, tags, desc) {
  const hay = (title + ' ' + (Array.isArray(tags) ? tags.join(' ') : '') + ' ' + (desc || '')).toLowerCase();
  return AI_KEYWORDS.some(kw => hay.includes(kw));
}

const JobSources = {

  sources: [

    /* ── 1. Remotive — remote-first, worldwide, tech/AI ── */
    {
      id: 'remotive',
      name: 'Remotive',
      note: 'remote-first • worldwide',
      fetch: async () => {
        // Fetch software + data categories for max AI relevance
        const cats = ['software-dev', 'data'];
        const allJobs = [];
        for (const cat of cats) {
          try {
            const res = await fetch(`https://remotive.com/api/remote-jobs?category=${cat}&limit=80`);
            if (!res.ok) continue;
            const data = await res.json();
            allJobs.push(...(data.jobs || []));
          } catch (e) { /* skip category on error */ }
        }
        // Also fetch uncategorized bulk
        try {
          const res2 = await fetch('https://remotive.com/api/remote-jobs?limit=80');
          if (res2.ok) { const d = await res2.json(); allJobs.push(...(d.jobs || [])); }
        } catch (e) {}

        // Dedupe by id + filter relevance
        const seen = new Set();
        return allJobs
          .filter(j => {
            if (seen.has(j.id)) return false;
            seen.add(j.id);
            return isRelevant(j.title, j.tags, j.description);
          })
          .slice(0, 100)
          .map(j => ({
            id: 'remotive-' + j.id,
            source: 'remotive',
            title: j.title || 'Untitled role',
            company: j.company_name || 'Unknown company',
            location: j.candidate_required_location || 'Worldwide',
            remote: true,
            url: j.url || '',
            postedAt: j.publication_date ? new Date(j.publication_date).getTime() : Date.now(),
            tags: Array.isArray(j.tags) ? j.tags.slice(0, 8) : [],
            description: j.description || ''
          }));
      }
    },

    /* ── 2. RemoteOK — tech/AI focused, worldwide remote ── */
    {
      id: 'remoteok',
      name: 'RemoteOK',
      note: 'tech remote • worldwide',
      fetch: async () => {
        const res = await fetch('https://remoteok.com/api', {
          headers: { 'User-Agent': 'JobPilot/1.0' }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        // first item is metadata, skip it
        const jobs = Array.isArray(data) ? data.slice(1) : [];
        return jobs
          .filter(j => j && j.position && isRelevant(j.position, j.tags, j.description))
          .slice(0, 80)
          .map(j => ({
            id: 'remoteok-' + (j.id || j.slug || Util.uid()),
            source: 'remoteok',
            title: j.position || 'Untitled role',
            company: j.company || 'Unknown company',
            location: 'Worldwide Remote',
            remote: true,
            url: j.url || ('https://remoteok.com/remote-jobs/' + (j.id || '')),
            postedAt: j.date ? new Date(j.date).getTime() : Date.now(),
            tags: Array.isArray(j.tags) ? j.tags.slice(0, 8) : [],
            description: (j.description || '') + ' ' + (Array.isArray(j.tags) ? j.tags.join(', ') : '')
          }));
      }
    },

    /* ── 3. Jobicy — remote jobs, category=engineering ── */
    {
      id: 'jobicy',
      name: 'Jobicy',
      note: 'remote engineering • worldwide',
      fetch: async () => {
        const res = await fetch('https://jobicy.com/api/v2/remote-jobs?count=80&tag=engineering');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const jobs = data.jobs || [];
        return jobs
          .filter(j => isRelevant(j.jobTitle, j.jobIndustry, j.jobDescription))
          .slice(0, 80)
          .map(j => ({
            id: 'jobicy-' + (j.id || Util.uid()),
            source: 'jobicy',
            title: j.jobTitle || 'Untitled role',
            company: j.companyName || 'Unknown company',
            location: j.jobGeo || 'Worldwide',
            remote: true,
            url: j.url || '',
            postedAt: j.pubDate ? new Date(j.pubDate).getTime() : Date.now(),
            tags: Array.isArray(j.jobIndustry) ? j.jobIndustry.slice(0, 6) : [],
            description: j.jobDescription || ''
          }));
      }
    },

    /* ── 4. Himalayas — curated worldwide remote ── */
    {
      id: 'himalayas',
      name: 'Himalayas',
      note: 'curated remote • worldwide',
      fetch: async () => {
        const res = await fetch('https://himalayas.app/jobs/api?limit=100');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const jobs = data.jobs || [];
        return jobs
          .filter(j => isRelevant(j.title, j.skills, j.description))
          .slice(0, 80)
          .map(j => ({
            id: 'himalayas-' + (j.id || Util.uid()),
            source: 'himalayas',
            title: j.title || 'Untitled role',
            company: (j.company && j.company.name) || 'Unknown company',
            location: (j.locationRestrictions && j.locationRestrictions.join(', ')) || 'Worldwide',
            remote: true,
            url: j.applicationLink || j.url || '',
            postedAt: j.createdAt ? new Date(j.createdAt).getTime() : Date.now(),
            tags: Array.isArray(j.skills) ? j.skills.slice(0, 8) : [],
            description: j.description || ''
          }));
      }
    },

    /* ── 5. Arbeitnow — global + EU board (AI-filtered) ── */
    {
      id: 'arbeitnow',
      name: 'Arbeitnow',
      note: 'global + EU • AI-filtered',
      fetch: async () => {
        const res = await fetch('https://www.arbeitnow.com/api/job-board-api');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const arr = Array.isArray(data) ? data : (data.data || []);
        return arr
          .filter(j => isRelevant(j.title, j.tags, j.description))
          .slice(0, 80)
          .map(j => ({
            id: 'arbeitnow-' + (j.slug || Util.uid()),
            source: 'arbeitnow',
            title: j.title || 'Untitled role',
            company: j.company_name || 'Unknown company',
            location: j.location || '',
            remote: !!j.remote,
            url: j.url || '',
            postedAt: j.created_at ? j.created_at * 1000 : Date.now(),
            tags: Array.isArray(j.tags) ? j.tags.slice(0, 8) : [],
            description: j.description || ''
          }));
      }
    },

    /* ── 6. Hacker News — "Who is hiring?" (AI-filtered) ── */
    {
      id: 'hn',
      name: 'Hacker News',
      note: '"Who is hiring?" • AI-filtered',
      fetch: async () => {
        const sres = await fetch('https://hn.algolia.com/api/v1/search_by_date?tags=story&query=' +
          encodeURIComponent('"Ask HN: Who is hiring?"') + '&hitsPerPage=1');
        if (!sres.ok) throw new Error('HTTP ' + sres.status);
        const sdata = await sres.json();
        const story = sdata.hits && sdata.hits[0];
        if (!story) throw new Error('No hiring thread found');

        const ires = await fetch('https://hn.algolia.com/api/v1/items/' + story.objectID);
        if (!ires.ok) throw new Error('HTTP ' + ires.status);
        const item = await ires.json();
        const comments = (item.children || []).slice(0, 100);

        return comments
          .map(c => {
            const text = Util.stripHtml(c.text || '');
            const parts = text.split('\n')[0].split('|').map(s => s.trim());
            const company = parts.length >= 2 ? parts[0].slice(0, 60) : (c.author || 'HN poster');
            const title = parts.length >= 2 ? parts.slice(1).join(' — ') : Util.truncate(text, 80);
            const location = parts.length >= 3 ? parts[2] : '';
            const lower = (title + ' ' + text).toLowerCase();
            return {
              id: 'hn-' + (c.id || Util.uid()),
              source: 'hn',
              title: title || 'HN job post',
              company,
              location,
              remote: /remote|anywhere|worldwide|distributed|global/.test(lower),
              url: 'https://news.ycombinator.com/item?id=' + (c.id || story.objectID),
              postedAt: c.created_at ? new Date(c.created_at).getTime() : Date.now(),
              tags: [],
              description: text
            };
          })
          .filter(j => isRelevant(j.title, j.tags, j.description));
      }
    }

  ],

  /** Fetch one source; returns {ok, jobs|error, ts} */
  async fetchOne(src) {
    try {
      const jobs = await src.fetch();
      return { ok: true, jobs, ts: Date.now() };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'failed', jobs: [], ts: Date.now() };
    }
  },

  /** Fetch every source in parallel. onResult(src, result) called as each lands. */
  async fetchAll(onResult) {
    const jobs = [];
    await Promise.all(JobSources.sources.map(async (src) => {
      const result = await JobSources.fetchOne(src);
      if (result.ok) jobs.push(...result.jobs);
      if (onResult) onResult(src, result);
    }));
    return jobs;
  }
};
