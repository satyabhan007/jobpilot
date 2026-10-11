/* ===== Small helpers shared everywhere ===== */
/* NOTE: entity strings are built via concatenation so they always survive as-is. */
const ENT_AMP  = '&' + 'amp;';
const ENT_LT   = '&' + 'lt;';
const ENT_GT   = '&' + 'gt;';
const ENT_QUOT = '&' + 'quot;';

const Util = {

  escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, ENT_AMP)
      .replace(/</g, ENT_LT)
      .replace(/>/g, ENT_GT)
      .replace(/"/g, ENT_QUOT)
      .replace(/'/g, '&#39;');
  },

  /** Gmail returns base64url; browsers only speak base64. */
  decodeBase64Url(data) {
    if (!data) return '';
    let b64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
      return decodeURIComponent(escape(atob(b64)));
    } catch (e) {
      try { return atob(b64); } catch (e2) { return ''; }
    }
  },

  /** Walk a Gmail payload tree and pull out readable text (plain first, then stripped html). */
  extractTextFromPayload(payload) {
    if (!payload) return '';
    const mime = payload.mimeType || '';
    const body = payload.body || {};
    if ((mime === 'text/plain') && body.data) return Util.decodeBase64Url(body.data);
    if (Array.isArray(payload.parts)) {
      let plain = '', html = '';
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          plain += Util.decodeBase64Url(part.body.data);
        } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
          html += Util.decodeBase64Url(part.body.data);
        } else if (Array.isArray(part.parts)) {
          plain += Util.extractTextFromPayload(part);
        }
      }
      if (plain.trim()) return plain;
      if (html.trim()) return Util.stripHtml(html);
    }
    if (mime === 'text/html' && body.data) return Util.stripHtml(Util.decodeBase64Url(body.data));
    if (body.data) return Util.stripHtml(Util.decodeBase64Url(body.data));
    return '';
  },

  stripHtml(html) {
    const s = String(html || '');
    return s
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(new RegExp(ENT_AMP + 'nbsp;', 'gi'), ' ')
      .replace(new RegExp(ENT_AMP, 'gi'), '&')
      .replace(new RegExp(ENT_LT, 'gi'), '<')
      .replace(new RegExp(ENT_GT, 'gi'), '>')
      .replace(new RegExp(ENT_QUOT, 'gi'), '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/ +([,.!?;:])/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  /** First N distinct http(s) links found in text, skipping noise. */
  extractLinks(text, limit) {
    const n = limit || 3;
    const out = [];
    const re = /https?:\/\/[^\s<>"')\]]+/g;
    let m;
    const skip = /(google|gstatic|googleapis|unsubscribe|privacy|terms|linkedin\.com\/feed|mailto)/i;
    while ((m = re.exec(String(text || ''))) !== null) {
      const url = m[0].replace(/[.,;]+$/, '');
      if (!skip.test(url) && !out.includes(url)) out.push(url);
      if (out.length >= n) break;
    }
    return out;
  },

  /** "5" -> 5, garbage -> null */
  toInt(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  },

  timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return Math.floor(days / 30) + 'mo ago';
  },

  truncate(s, n) {
    s = String(s || '');
    return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
  },

  /** stable id for a job from title+company, used for dedupe */
  dedupeKey(title, company) {
    const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return clean(company) + '|' + clean(title).slice(0, 60);
  },

  uid() {
    return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
};
