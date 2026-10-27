// "Call now" alerts: matches a webhook event (website visit, email open, click, reply) to a champion
// who recently moved, and tells their rep to call while they're warm.
// Pure functions: tested in test/, inlined into the engagement webhook's Code node.

// @node-only-start
const { clean, lower, normDomain } = require('./shared');
// @node-only-end

// Accepts the payload shapes most tools send. Unknown shapes still work if they contain an email or a company domain.
function normalizeEvent(body) {
  const b = body && typeof body === 'object' ? (body.body && typeof body.body === 'object' ? body.body : body) : {};
  const pick = (...paths) => {
    for (const p of paths) {
      const v = p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), b);
      if (v !== undefined && v !== null && clean(v) !== '' && typeof v !== 'object') return clean(v);
    }
    return '';
  };
  let email = lower(pick('email', 'email_address', 'work_email', 'recipient_email', 'recipient', 'to', 'person.email', 'person.email_address', 'contact.email', 'lead.email', 'visitor.email', 'data.email', 'data.email_address'));
  if (!email) {
    // Fall back to the first email-looking string anywhere in the payload.
    const m = JSON.stringify(b).match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    email = m ? m[0].toLowerCase() : '';
  }
  const domain = normDomain(pick('domain', 'company_domain', 'website', 'company_website', 'company.domain', 'company.website', 'organization.domain', 'organization.website', 'account.domain', 'account.website', 'visitor.company_domain', 'data.domain', 'data.company_domain'));
  const rawType = lower(pick('event_type', 'event', 'type', 'action', 'activity_type', 'data.event_type'));
  let type = 'web_visit';
  // Website events first, so "page_view" or "site_visit" are never mistaken for email opens.
  if (/page|visit|session|web|site|identified|reveal/.test(rawType) || !rawType) type = 'web_visit';
  else if (/repl/.test(rawType)) type = 'reply';
  else if (/click/.test(rawType)) type = 'email_click';
  else if (/open|view/.test(rawType)) type = 'email_open';
  return {
    type,
    raw_type: rawType,
    email,
    domain: domain || (email ? normDomain(email) : ''),
    company: pick('company', 'company_name', 'company.name', 'organization.name', 'account.name', 'visitor.company'),
    page: pick('page', 'page_url', 'url', 'pageUrl', 'page.url', 'data.page_url', 'subject', 'email_subject'),
    occurred_at: pick('occurred_at', 'timestamp', 'time', 'created_at', 'date', 'data.occurred_at') || new Date().toISOString(),
    source: pick('source', 'tool', 'provider'),
  };
}

function matchEngagement(cfg, event, stateRows, nowInput) {
  const now = nowInput ? new Date(nowInput) : new Date();
  const windowDays = Number(cfg.engagement_window_days) || 90;
  const cooldownHours = Number(cfg.engagement_cooldown_hours) || 24;
  const label = { web_visit: 'visited your website', email_open: 'opened your email', email_click: 'clicked a link in your email', reply: 'replied to your email' }[event.type];
  const out = [];
  for (const s of stateRows || []) {
    if (lower(s.status) !== 'moved') continue;
    const byEmail = event.email && lower(s.new_email) && lower(s.new_email) === event.email;
    const byDomain = !byEmail && event.domain && normDomain(s.new_company_domain) === event.domain;
    if (!byEmail && !byDomain) continue;
    // Domain-only matches are account-level: someone at their new company, maybe not them.
    if (byDomain && event.type !== 'web_visit') continue;
    const moved = new Date(clean(s.moved_at));
    if (!isNaN(moved.getTime()) && (now - moved) / 86400000 > windowDays) continue;
    const last = new Date(clean(s.last_engagement_alert_at));
    if (!isNaN(last.getTime()) && (now - last) / 3600000 < cooldownHours) continue;

    const name = clean(s.full_name) || clean(s.new_email);
    const who = byEmail ? name : `Someone from ${clean(s.current_company) || event.domain} (where ${name} works now)`;
    const days = isNaN(moved.getTime()) ? '' : Math.max(0, Math.floor((now - moved) / 86400000));
    const ago = days === '' ? '' : days === 0 ? ' today' : days === 1 ? ' yesterday' : ` ${days} days ago`;
    const mention = clean(s.owner_ae_slack_id) ? `<@${clean(s.owner_ae_slack_id)}>` : clean(s.owner_ae) || 'Team';
    const page = event.page ? ` (${event.page.slice(0, 120)})` : '';
    const md = [
      `:telephone_receiver: *Call now: ${who} just ${label}*${page}`,
      `${mention}, ${name} moved to *${clean(s.current_company)}*${clean(s.current_title) ? ` as ${clean(s.current_title)}` : ''}${ago}. They're warm right now.`,
      clean(s.new_email) ? `Email: ${clean(s.new_email)}` : '',
      clean(s.linkedin_url) ? `<${clean(s.linkedin_url)}|Open LinkedIn>` : '',
    ].filter(Boolean).join('\n');
    const esc = (v) => clean(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = [
      `<p><b>Call now: ${esc(who)} just ${label}</b>${esc(page)}</p>`,
      `<p>${esc(name)} moved to <b>${esc(s.current_company)}</b>${clean(s.current_title) ? ` as ${esc(s.current_title)}` : ''}${ago}. They're warm right now.</p>`,
      clean(s.new_email) ? `<p>Email: ${esc(s.new_email)}</p>` : '',
      clean(s.linkedin_url) ? `<p><a href="${esc(s.linkedin_url)}">Open LinkedIn</a></p>` : '',
    ].filter(Boolean).join('\n');
    out.push({
      alert: {
        action: 'alert',
        kind: 'call_now',
        contact_id: clean(s.contact_id),
        subject: `Call now: ${who} just ${label}`,
        text_md: md,
        html,
        text_plain: html.replace(/<[^>]+>/g, '').trim(),
        to_name: clean(s.owner_ae), to_email: clean(s.owner_ae_email), to_slack_id: clean(s.owner_ae_slack_id),
        cc_name: '', cc_email: '', cc_slack_id: '',
        priority: 'Hot',
      },
      state_update: { contact_id: clean(s.contact_id), last_engagement_alert_at: now.toISOString() },
      match: byEmail ? 'person' : 'account',
    });
  }
  return out;
}

// @node-only-start
module.exports = { normalizeEvent, matchEngagement };
// @node-only-end
