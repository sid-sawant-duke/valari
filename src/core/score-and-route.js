// Turns the Investigator's verdict into a scored, routed decision.
// Scoring is fully configurable (personas, weights, thresholds) through the Config node.
// Pure function: tested in test/, inlined into the "Score and Route" Code node.

// @node-only-start
const { clean, lower, parseJson, normDomain, isoDay, loadDirectory, resolveOwner } = require('./shared');
// @node-only-end

const DEFAULT_SCORING = {
  role: { buyer: 30, champion: 25, user: 15 },
  seniority: { executive: 15, director: 10, manager: 5 },
  bucket: { open_deal: 20, net_new: 15, lost_deal: 15, customer: 10 },
  icp: { strong: 15, partial: 8, unknown: 5, weak: 0 },
  recency: { within_3_months: 10, within_6_months: 5 },
  confidence: { high: 1, medium: 0.85, low: 0.6 },
  thresholds: { hot: 70, warm: 45 },
};

function scoringConfig(cfg) {
  const custom = parseJson(cfg.scoring, {}) || {};
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_SCORING)) out[k] = { ...v, ...(custom[k] || {}) };
  return out;
}

// Personas are matched against the new title (or the old one if the new title is unknown).
// cfg.personas: [{ "name": "Analyst", "keywords": ["analyst"], "points": 25 }, ...]
function matchPersona(cfg, title) {
  const personas = parseJson(cfg.personas, []) || [];
  const t = ` ${lower(title).replace(/[^a-z0-9]+/g, ' ')} `;
  // "analyst" also matches "analysts", "market" matches "marketing", but "product" does not match "production".
  const hit = (w) => new RegExp(` ${w.replace(/ /g, ' ')}(s|er|ers|ing)? `).test(t);
  let best = null;
  for (const p of Array.isArray(personas) ? personas : []) {
    const words = (p.keywords || []).map((w) => lower(w).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
    if (words.some(hit)) {
      if (!best || Number(p.points) > Number(best.points)) best = p;
    }
  }
  return best ? { name: clean(best.name), points: Number(best.points) || 0 } : { name: '', points: 0 };
}

function seniorityOf(title) {
  const t = lower(title);
  if (/\b(chief|c[eotfmipr]o|vp|svp|evp|vice president|head of|president|founder|co-founder|partner)\b/.test(t)) return 'executive';
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\b(manager|lead|principal|staff)\b/.test(t)) return 'manager';
  return '';
}

function scoreAndRoute(cfg, candidate, verdictInput, accounts, nowInput) {
  const now = nowInput ? new Date(nowInput) : new Date();
  const S = scoringConfig(cfg);
  const recheckDays = Number(cfg.recheck_after_days) || 30;

  let v = verdictInput;
  if (typeof v === 'string') v = parseJson(v, {});
  if (v && typeof v === 'object' && v.output && typeof v.output === 'object') v = v.output;
  v = v || {};

  let outcome = ['confirmed', 'verify', 'no_change'].includes(lower(v.outcome)) ? lower(v.outcome) : 'verify';
  const confidence = ['high', 'medium', 'low'].includes(lower(v.confidence)) ? lower(v.confidence) : 'low';
  const sideRole = v.side_role === true || lower(v.side_role) === 'true';
  const newCompany = clean(v.new_company);
  const newDomain = normDomain(v.new_company_domain);
  const newTitle = clean(v.new_title);
  const started = clean(v.started_new_role);
  const icp = ['strong', 'partial', 'weak', 'unknown'].includes(lower(v.icp_fit)) ? lower(v.icp_fit) : 'unknown';
  let evidence = clean(v.evidence);

  // Guard rails on top of the agent's judgment.
  const oldDomain = normDomain(candidate.last_company_domain);
  const sameCompany = (newDomain && oldDomain && newDomain === oldDomain) || (newCompany && lower(newCompany) === lower(candidate.last_company));
  if (outcome === 'confirmed' && (sideRole || sameCompany || !newCompany)) outcome = 'verify';
  // A signal the data can't confirm yet stays open as [verify] until the profile updates or an AE closes it.
  if (outcome === 'no_change' && ['signal', 'recheck', 'retry'].includes(candidate.trigger)) outcome = 'verify';
  if (candidate.signal_evidence && !evidence.includes(candidate.signal_evidence)) {
    evidence = [`- ${candidate.signal_evidence}`, evidence].filter(Boolean).join('\n');
  }

  // Which account bucket is the new company in, and who owns it?
  let bucket = '';
  let account = null;
  if (outcome === 'confirmed') {
    account = (accounts || []).find((a) => normDomain(a.domain) && normDomain(a.domain) === newDomain) || null;
    const rel = account ? lower(account.relationship) : '';
    bucket = ['customer', 'open_deal', 'lost_deal'].includes(rel) ? rel : 'net_new';
  }

  // Score.
  const persona = outcome === 'confirmed' ? matchPersona(cfg, newTitle || candidate.last_title) : { name: '', points: 0 };
  let score = 0;
  const breakdown = {};
  if (outcome === 'confirmed') {
    breakdown.role = S.role[candidate.role_type] ?? S.role.user ?? 0;
    breakdown.persona = persona.points;
    breakdown.seniority = S.seniority[seniorityOf(newTitle)] ?? 0;
    breakdown.bucket = S.bucket[bucket] ?? 0;
    breakdown.icp = S.icp[icp] ?? 0;
    breakdown.recency = 0;
    const startDate = started ? new Date(started.length === 7 ? `${started}-01` : started) : null;
    if (startDate && !isNaN(startDate.getTime())) {
      const months = (now - startDate) / (30.4 * 86400000);
      if (months <= 3) breakdown.recency = S.recency.within_3_months ?? 0;
      else if (months <= 6) breakdown.recency = S.recency.within_6_months ?? 0;
    }
    const raw = Object.values(breakdown).reduce((a, b) => a + (Number(b) || 0), 0);
    breakdown.confidence_multiplier = S.confidence[confidence] ?? 1;
    score = Math.max(0, Math.min(100, Math.round(raw * breakdown.confidence_multiplier)));
  }
  const priority = outcome !== 'confirmed' ? '' : score >= S.thresholds.hot ? 'Hot' : score >= S.thresholds.warm ? 'Warm' : 'Cool';

  // Routing: the new account's owner if we already have one, otherwise the champion's own AE (cc'd when different).
  const champOwner = {
    name: candidate.owner_ae, email: candidate.owner_ae_email, slack_id: candidate.owner_ae_slack_id,
    crm_id: candidate.owner_crm_id, sequence_user_id: candidate.owner_sequence_user_id,
  };
  const acctOwner = account && clean(account.owner_ae || account.owner_ae_email || account.owner_crm_id)
    ? resolveOwner(loadDirectory(cfg), { name: account.owner_ae, email: account.owner_ae_email, slack_id: account.owner_ae_slack_id, crm_id: account.owner_crm_id, sequence_user_id: account.owner_sequence_user_id }, false)
    : null;
  const owner = acctOwner || champOwner;
  const sameOwner = acctOwner && ((acctOwner.email && acctOwner.email === lower(champOwner.email)) || lower(acctOwner.name) === lower(champOwner.name));
  const cc = acctOwner && !sameOwner && (champOwner.name || champOwner.email) ? champOwner : null;

  let status = 'active';
  let nextCheckOn = '';
  if (outcome === 'confirmed') status = 'moved';
  if (outcome === 'verify') { status = 'verify'; nextCheckOn = isoDay(new Date(now.getTime() + recheckDays * 86400000)); }

  return {
    candidate,
    outcome, confidence, side_role: sideRole, icp_fit: icp, evidence,
    new_company: outcome === 'confirmed' ? newCompany : '',
    new_company_domain: outcome === 'confirmed' ? newDomain : '',
    new_title: outcome === 'confirmed' ? newTitle : '',
    started_new_role: outcome === 'confirmed' ? started : '',
    draft_opener: outcome === 'confirmed' ? clean(v.draft_opener) : '',
    bucket,
    crm_account_id: account ? clean(account.crm_account_id) : '',
    persona: persona.name,
    score: outcome === 'confirmed' ? score : '',
    score_breakdown: breakdown,
    priority,
    owner,
    cc,
    status,
    next_check_on: nextCheckOn,
    // Alerts: every confirmed move, and [verify] only the first time (rechecks stay quiet).
    notify: outcome === 'confirmed' || (outcome === 'verify' && candidate.trigger !== 'recheck'),
    decided_at: now.toISOString(),
  };
}

// @node-only-start
module.exports = { scoreAndRoute, matchPersona, seniorityOf, DEFAULT_SCORING };
// @node-only-end
