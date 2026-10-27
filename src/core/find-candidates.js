// Decides who to investigate on this run: inbox signals, due [verify] rechecks, failed runs, and the monthly sweep.
// Pure function: tested in test/, inlined into the "Find Candidates" Code node.

// @node-only-start
const { clean, lower, truthy, parseJson } = require('./shared');
// @node-only-end

function findCandidates(cfg, champions, messages, nowInput) {
  const now = nowInput ? new Date(nowInput) : new Date();
  const max = Number(cfg.max_lookups_per_run) || 40;
  const sweepDay = Number(cfg.sweep_day_of_month) || 1;
  const toDate = (v) => {
    const d = new Date(clean(v));
    return clean(v) && !isNaN(d.getTime()) ? d : null;
  };
  const daysSince = (d) => (now.getTime() - d.getTime()) / 86400000;
  const pack = (c, trigger, signal, evidence = '', signalDate = '') => ({ ...c, trigger, signal, signal_evidence: evidence, signal_date: signalDate });

  // 1. A teammate asked for one person (from the MCP server or another workflow).
  const requested = clean(cfg.requested_contact_id);
  if (requested) {
    const c = champions.find((p) => p.contact_id === requested || lower(p.work_email) === lower(requested));
    if (!c) return { candidates: [], skipped: [`Unknown contact ${requested}`] };
    if (truthy(c.do_not_contact)) return { candidates: [], skipped: [`${requested} is marked do_not_contact`] };
    return { candidates: [pack(c, 'manual', 'manual', 'Requested by a teammate')], skipped: [] };
  }

  const eligible = champions.filter((c) => !truthy(c.do_not_contact) && !['moved', 'inactive'].includes(c.status));
  const byEmail = new Map();
  for (const c of eligible) if (c.work_email) byEmail.set(lower(c.work_email), c);

  const chosen = new Map();
  const add = (cand) => { if (!chosen.has(cand.contact_id)) chosen.set(cand.contact_id, cand); };

  // 2. Inbox signals: bounces and "no longer with the company" auto-replies.
  const emailRe = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const bounceRe = /mailer-daemon|postmaster|undeliver|delivery status notification|delivery has failed|delivery failure|mail delivery failed|returned mail|not be delivered|address not found|recipient address rejected/i;
  const leftRe = /no longer (with|at|employed|working|part of)|has left (the company|the organization|the organisation|[a-z0-9 &.,'-]{2,40})|left the company|last day (was|at)|is no longer/i;
  for (const m of messages || []) {
    if (!m || typeof m !== 'object') continue;
    const subject = clean(m.subject || m.Subject);
    const fromBlob = typeof (m.from ?? m.From) === 'string' ? (m.from ?? m.From) : JSON.stringify(m.from ?? m.From ?? '');
    const blob = [subject, fromBlob, JSON.stringify(m.headers ?? {}), clean(m.text) || clean(m.snippet)].join('\n');
    const found = new Set((blob.match(emailRe) || []).map((e) => e.toLowerCase()));
    if (!found.size) continue;
    // A bounce must come from a mail system (mailer-daemon or postmaster), so anyone can't email
    // "Undeliverable: ..." and make Valari spend lookup credits on a person who didn't leave.
    const fromMailSystem = /mailer-daemon|postmaster/i.test(fromBlob);
    const isBounce = fromMailSystem && (bounceRe.test(subject) || bounceRe.test(fromBlob));
    const isLeft = !isBounce && leftRe.test(blob);
    if (!isBounce && !isLeft) continue;
    const fromEmails = new Set((fromBlob.match(emailRe) || []).map((e) => e.toLowerCase()));
    const day = clean(m.date).slice(0, 10);
    for (const email of found) {
      const c = byEmail.get(email);
      if (!c) continue;
      if (isLeft && !fromEmails.has(email)) continue; // only the champion's own auto-reply counts
      const evidence = `${isBounce ? 'Email bounced' : 'Auto-reply says they left'}${day ? ` on ${day}` : ''}: "${subject.slice(0, 120)}"`;
      add(pack(c, 'signal', isBounce ? 'bounce' : 'left_autoreply', evidence, day));
    }
  }

  // 3. [verify] cases due for a recheck.
  for (const c of eligible) {
    if (c.status !== 'verify') continue;
    const due = toDate(c.next_check_on);
    if (!due || daysSince(due) >= 0) add(pack(c, 'recheck', 'recheck', `Scheduled recheck (due ${c.next_check_on || 'now'})`));
  }

  // 4. Suspects left behind by a run that failed midway.
  for (const c of eligible) {
    if (c.status !== 'suspect') continue;
    const last = toDate(c.last_checked);
    if (!last || daysSince(last) >= 2) add(pack(c, 'retry', 'retry', 'Previous investigation did not finish'));
  }

  // 5. Monthly sweep: one third of the list each month, so everyone is checked once a quarter.
  if (now.getUTCDate() === sweepDay) {
    const group = String((now.getUTCMonth() % 3) + 1);
    for (const c of eligible) {
      if (c.status === 'active' && c.sweep_group === group) add(pack(c, 'sweep', 'sweep', `Quarterly sweep, group ${group}`));
    }
  }

  const all = [...chosen.values()];
  return {
    candidates: all.slice(0, max),
    skipped: all.slice(max).map((c) => `${c.contact_id} (over the ${max} lookups-per-run cap, picked up next run)`),
  };
}

// A manual run for someone whose lookup was still in progress (the Lookup Callback re-runs people this way)
// keeps the bounce or auto-reply that started it, so "nothing found" still ends as [VERIFY], not "no change".
// Only signals from the last lookup_repeat_days (default 30) count.
function restoreSignals(cfg, candidates, cacheRows, nowInput) {
  const now = nowInput ? new Date(nowInput) : new Date();
  const maxDays = Number(cfg.lookup_repeat_days ?? 30);
  return (candidates || []).map((c) => {
    if (c.trigger !== 'manual') return c;
    const row = (cacheRows || []).find((r) => r && clean(r.contact_id) === c.contact_id);
    const saved = row ? parseJson(row.signal_json, null) : null;
    if (!saved || !['signal', 'retry', 'recheck'].includes(saved.trigger)) return c;
    const at = new Date(clean(saved.signal_date) || clean(saved.saved_at));
    if (isNaN(at.getTime()) || (now - at) / 86400000 > maxDays) return c;
    return { ...c, trigger: saved.trigger, signal: saved.signal, signal_evidence: saved.signal_evidence, signal_date: saved.signal_date, requested: true };
  });
}

// People whose async lookup (Clay) answered since the last run. They are added on top of the per-run cap,
// since their lookup is already paid for, and keep the signal that started the lookup.
function readyCandidates(candidates, watchlist, cacheRows) {
  const have = new Set((candidates || []).map((c) => c.contact_id));
  const out = [...(candidates || [])];
  for (const r of cacheRows || []) {
    if (!r || lower(r.pending) !== 'ready' || have.has(clean(r.contact_id))) continue;
    const c = (watchlist || []).find((p) => p.contact_id === clean(r.contact_id));
    if (!c || truthy(c.do_not_contact) || ['moved', 'inactive'].includes(c.status)) continue;
    const saved = parseJson(r.signal_json, null) || {};
    out.push({ ...c, trigger: saved.trigger || 'retry', signal: saved.signal || 'lookup_answer', signal_evidence: clean(saved.signal_evidence), signal_date: clean(saved.signal_date) });
    have.add(c.contact_id);
  }
  return out;
}

// People marked do_not_contact who are still tracked: their state becomes "opted_out", so "call now" alerts
// (which only fire for "moved") stop too. Removing the flag later makes them eligible again.
function optOutRows(watchlist) {
  return (watchlist || [])
    .filter((c) => truthy(c.do_not_contact) && c.status && !['active', 'opted_out'].includes(c.status))
    .map((c) => ({ contact_id: c.contact_id, full_name: c.full_name, status: 'opted_out' }));
}

// @node-only-start
module.exports = { findCandidates, restoreSignals, readyCandidates, optOutRows };
// @node-only-end
