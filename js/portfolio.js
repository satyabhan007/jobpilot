/* ===== Real profile data — sourced from https://satyabhan007.github.io =====
 * This is the single source of truth for "who is looking for a job".
 * Edit this file to update the profile everywhere (form defaults,
 * profile summary card, matching, AI re-ranking prompt).
 */

const PORTFOLIO_PROFILE = {
  /* --- core fields used by the matcher --- */
  name: 'Satyabhan Umed Bhadoriya',
  years: 8,
  skills: [
    // AI / GenAI core
    'genai', 'generative ai', 'llm', 'rag', 'langchain', 'langgraph',
    'multi-agent', 'ai agents', 'prompt engineering', 'tool calling',
    'function calling', 'vector database', 'embeddings', 'fine-tuning',
    // models + serving
    'pytorch', 'hugging face', 'transformers', 'vllm', 'quantization',
    'lora', 'kv-cache', 'model optimization',
    // platforms + inference
    'vertex ai', 'gemini', 'groq', 'ollama', 'azure stt', 'elevenlabs',
    // vector + data
    'qdrant', 'redis', 'postgresql', 'firebase', 'firestore', 'bigquery', 'looker',
    // languages + backend
    'python', 'typescript', 'node.js', 'fastapi', 'express',
    // cloud + devops + infra
    'gcp', 'cloud run', 'docker', 'kubernetes', 'terraform', 'ansible',
    'github actions', 'prometheus', 'grafana', 'linux', 'rhel',
    'vmware', 'openscap', 'stig hardening', 'mlops', 'llmops'
  ],
  roles: [
    'senior ai engineer', 'ai engineer', 'genai engineer', 'generative ai engineer',
    'llm engineer', 'ml engineer', 'machine learning engineer', 'ai ml engineer',
    'mlops engineer', 'llmops engineer', 'ai platform engineer',
    'applied ai engineer', 'rag engineer', 'nlp engineer',
    'ai solutions architect', 'python backend engineer'
  ],
  locations: ['pune', 'india', 'maharashtra'],
  remoteOk: true,

  /* --- profile summary card --- */
  headline: 'Senior AI Engineer — Production GenAI, LLMs and Agents',
  tagline: 'Open to work · Hybrid / Pune, India',
  initials: 'SB',
  summary: 'Senior AI Engineer with 8+ YOE across enterprise and AI. Creator of CLINIRISE, a production healthcare WhatsApp AI CRM on Gemini, Qdrant, Redis and GCP Cloud Run. Specialist in multi-agent system design, RAG architecture and AI model optimization. Author of 400+ chapters of CI-validated open-source engineering curricula.',
  highlights: [
    '8+ yrs — automation to Linux to AI/LLM',
    'CLINIRISE: 860+ automated tests, 2 live clinic pilots',
    '400+ curriculum chapters, 4 CI-validated curricula',
    '15+ automation projects delivered'
  ],
  education: 'B.E. Mechanical Engineering (First Class) — SPPU / DPCOE, 2014',

  /* --- links --- */
  links: {
    site: 'https://satyabhan007.github.io',
    resume: 'https://satyabhan007.github.io/resume.pdf',
    github: 'https://github.com/satyabhan007',
    linkedin: 'https://www.linkedin.com/in/satyabhan-bhadoriya-777b28239',
    email: 'satyabhan.bhadoriya@gmail.com',
    phone: '+91 79727 85226',
    clinicrise: 'https://gen-lang-client-0155046437.web.app/'
  },

  /* --- featured work (context for the AI re-ranking prompt + UI) --- */
  projects: [
    {
      name: 'CLINIRISE',
      desc: 'Autonomous healthcare WhatsApp CRM and RAG system — multi-agent topology (LangGraph-style), hybrid Qdrant retrieval, two-tier Redis caching, Gemini with INT8 quantization, 860+ automated tests, 2 live clinic pilots.'
    },
    {
      name: 'AI-ML curriculum',
      desc: '9-part, 138-chapter curriculum: from-scratch autograd, BPE tokenizers, attention, RAG + LangGraph/ReAct agents, LoRA/DPO fine-tuning, vLLM serving. 69/69 CI checks.'
    },
    {
      name: 'DevOps-Infra',
      desc: '5-part, 88-chapter IaC/platform-engineering curriculum: Terraform, Docker, Kubernetes, SLI/SLOs, incident runbooks. 4-gate CI pipeline.'
    },
    {
      name: 'linux-hpc-security',
      desc: '21 modules, 126 lessons: Linux internals, DISA STIG hardening, eBPF observability, Ansible, Slurm HPC, RDMA fabric, Splunk SIEM. 63 runnable labs.'
    },
    {
      name: 'AI Threat Defense',
      desc: 'Production-grade AI threat detection, adversarial robustness and Go gateway engineering curriculum.'
    }
  ],

  /* --- experience (for the AI prompt and reference) --- */
  experience: [
    { role: 'Independent AI Engineer', org: 'CLINIRISE (self-directed)', period: '2026 — present' },
    { role: 'Technical Support Engineer', org: 'Aman Security India (CBSE RO, Pune)', period: '2024 — 2026' },
    { role: 'Linux Administrator', org: 'Oceanic EOPS LLP', period: '2023 — 2024' },
    { role: 'Application Engineer', org: 'Precision Automation, Pune', period: '2018 — 2023' }
  ],

  /* ── Pre-configured Google OAuth Client ID ──────────────────────────────────
   * Paste your Client ID here ONCE (from console.cloud.google.com).
   * It is NOT secret — only the client_secret is secret, and GIS never needs it.
   * When set, the Gmail "Add account" button works without any UI setup step.
   * Leave as '' to keep the manual-entry input field visible.
   *
   * Steps to get one (5 min, free):
   *   1. console.cloud.google.com → Create project
   *   2. APIs & Services → Library → Gmail API → Enable
   *   3. APIs & Services → OAuth consent screen → External → add your email as Test user
   *   4. Credentials → Create credentials → OAuth client ID
   *      → Web application → Authorized JS origins: http://localhost:8000
   *   5. Copy the Client ID and paste below.
   */
  gmailClientId: '',   // e.g. '123456789-abc.apps.googleusercontent.com'

  /* ── Private-access gate (GitHub Pages lock screen) ─────────────────────────
   * When the app is hosted (GitHub Pages etc.), a lock screen asks the visitor
   * to prove they are the GitHub account holder before the app unlocks.
   *
   *   githubOwner        — the ONLY GitHub login allowed in (case-insensitive).
   *   githubClientId     — OAuth App Client ID for one-click "Sign in with
   *                        GitHub" (Device Flow — NO secret needed, it is not
   *                        a secret value). Create at:
   *                        github.com/settings/developers → New OAuth App
   *                        → any homepage/callback URL → tick "Enable Device Flow".
   *                        Leave '' to use the paste-a-token method only.
   *   gateEnabled        — true  = lock on http(s) origins (localhost included;
   *                        sign in once per browser, session is remembered).
   *                        file:// (the Android APK) is never gated — the app
   *                        is local to your device there.
   *
   * Honest limit: this gate verifies WHO is using the app in a browser; the
   * code on Pages is public, and your Gmail tokens / API keys / saved jobs
   * never leave your own browser anyway. See README → "Hosting & privacy".
   */
  githubOwner: 'satyabhan007',
  githubClientId: '',          // e.g. 'Ov23liXXXXXXXXXXXXXX'  (Device Flow enabled)
  gateEnabled: true
};

/* One-line summary injected into the LLM re-ranking prompt so the model
 * knows the seniority and story, not just the keyword list. */
PORTFOLIO_PROFILE.aiContext =
  'Senior AI Engineer with 8+ years (enterprise infrastructure then AI). ' +
  'Shipped CLINIRISE, a multi-clinic WhatsApp AI CRM (multi-agent orchestration, RAG over Qdrant, ' +
  'Gemini on GCP Cloud Run, 860+ automated tests) now piloting with 2 clinics. ' +
  'Also authored 400+ chapters of CI-validated open-source AI/DevOps/Linux curricula. ' +
  'Based in Pune, India, open to hybrid or remote.';
