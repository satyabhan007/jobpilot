/* ===== Optional AI re-ranking via any OpenAI-compatible chat API ===== */
/* Works with OpenAI, DeepSeek, Groq, Together, Ollama(/v1)… The key lives in
   this browser only and requests go directly from your browser to the endpoint. */

const LLM = {

  /** True when the active provider has a base URL + key configured. */
  hasKey(settings) {
    const cfg = LLM.cfg(settings);
    return !!(cfg && cfg.base && cfg.key);
  },

  /** Resolved provider config {provider, base, key, model} or null. */
  cfg(settings) {
    const provider = (settings && settings.aiProvider) || 'groq';
    const cfg = settings && settings.aiConfigs ? settings.aiConfigs[provider] : null;
    if (!cfg) return null;
    return {
      provider,
      base: String(cfg.base || '').replace(/\/+$/, ''),
      key: cfg.key || '',
      model: cfg.model || ''
    };
  },

  /** Generic OpenAI-compatible chat call. Resolves to the message content string. */
  async chat(messages, settings, opts) {
    const cfg = LLM.cfg(settings);
    if (!cfg) throw new Error('AI provider configuration missing');
    if (!cfg.base) throw new Error('Set the API base URL (e.g. https://api.groq.com/openai/v1)');
    if (!cfg.key) throw new Error('Add your API key first');

    const body = {
      model: cfg.model,
      temperature: (opts && opts.temperature) != null ? opts.temperature : 0.2,
      messages
    };

    let res;
    try {
      res = await fetch(cfg.base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.key
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error('Network error reaching ' + cfg.base + ' — check the URL / CORS / key');
    }

    if (!res.ok) {
      let detail = '';
      try { const err = await res.json(); detail = err.error && err.error.message ? ' — ' + err.error.message : ''; } catch (e) {}
      throw new Error('API error ' + res.status + detail);
    }

    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  },

  /**
   * profile: user profile; jobs: already locally-scored matches (top N);
   * settings: full Store.settings() object including aiProvider and aiConfigs
   * Returns [{id, score, reason}] or throws with a friendly message.
   */
  async rerank(profile, jobs, settings) {
    const profileSummary =
      (profile.aiContext || PORTFOLIO_PROFILE.aiContext || '') + '\n' +
      'Skills: ' + (profile.skills || []).join(', ') + '. ' +
      'Target roles: ' + (profile.roles || []).join(', ') + '. ' +
      'Experience: ' + (profile.years != null ? profile.years + ' years' : 'unspecified') + '. ' +
      'Locations: ' + (profile.locations || []).join(', ') + '. ' +
      'Open to remote: ' + (profile.remoteOk ? 'yes' : 'no') + '.';

    const list = jobs.map((m, i) => ({
      n: i,
      id: m.job.id,
      title: m.job.title,
      company: m.job.company,
      location: m.job.location || (m.job.remote ? 'remote' : 'unspecified'),
      snippet: Util.truncate(Util.stripHtml(m.job.description || ''), 350)
    }));

    const prompt =
      'You are a precise job-matching assistant. Score how well each job fits this candidate.\n\n' +
      'CANDIDATE: ' + profileSummary + '\n\n' +
      'JOBS (JSON):\n' + JSON.stringify(list, null, 1) + '\n\n' +
      'For EVERY job return a fit score 0-100 and one short reason (max 20 words) written to the candidate, ' +
      'mentioning the single strongest fit or the main gap. ' +
      'Respond with ONLY valid JSON, no markdown: {"results":[{"n":0,"score":85,"reason":"..."}]}';

    const content = await LLM.chat([
      { role: 'system', content: 'You are a precise job matching assistant. Respond with valid JSON only.' },
      { role: 'user', content: prompt }
    ], settings);

    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('AI returned no parsable JSON');
    let parsed;
    try { parsed = JSON.parse(content.slice(start, end + 1)); }
    catch (e) { throw new Error('AI JSON was malformed — try again'); }

    const results = Array.isArray(parsed.results) ? parsed.results : [];
    return results
      .filter(r => r && typeof r.id === 'string')
      .map(r => ({
        id: r.id,
        score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
        reason: String(r.reason || '').slice(0, 200)
      }));
  }
};
