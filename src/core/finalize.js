// Combines each decision with what the connectors did (email found, CRM record, sequence)
// and produces the case row, the state row and the alert for each person.
// Pure function: tested in test/, inlined into the "Finalize" Code node.

// @node-only-start
const { clean, lower, truthy } = require('./shared');
const { byContact } = require('./actions');
// @node-only-end

const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mdEsc = (s) => clean(s).replace(/[<>]/g, '');

function finalize(cfg, decisions, emailResults, crmResults, seqResults) {
  const emails = byContact(emailResults);
  const crm = byContact(crmResults);
  const seq = byContact(seqResults);
  const minScore = Number(cfg.enroll_min_score ?? 45);
  const crmName = clean(cfg.crm_name) || 'CRM';
  // Only mention steps that are switched on.
  const emailOn = !!clean(cfg.email_finder_connector_id) || truthy(cfg.find_new_emails) || (emailResults && emailResults.length > 0);
  const seqOn = !!clean(cfg.sequence_connector_id) || (seqResults && seqResults.length > 0);

  return decisions.map((d) => {
    const c = d.candidate;
    const id = c.contact_id;
    const e = emails.get(id) || {};
    const r = crm.get(id) || {};
    const s = seq.get(id) || {};
    const name = c.full_name || c.work_email;
    const tag = (slack, nm) => (clean(slack) ? `<@${clean(slack)}>` : mdEsc(nm));

    // ---- Status lines for what the connectors did.
    let emailLine = '';
    let crmLine = '';
    let seqLine = '';
    if (d.outcome === 'confirmed') {
      emailLine = clean(e.email)
        ? `${clean(e.email)}${e.status ? ` (${lower(e.status)}${e.confidence !== undefined && e.confidence !== '' ? `, ${e.confidence}%` : ''})` : ''}`
        : (emailOn ? 'Not found' : '');
      if (r.error) crmLine = `Could not write to ${crmName}: ${clean(r.error).slice(0, 160)}`;
      else if (clean(r.crm_record_id)) crmLine = `Created ${lower(r.crm_record_type) || 'record'}${clean(r.task_id) ? ' and a task' : ''}${clean(r.crm_record_url) ? ` (${clean(r.crm_record_url)})` : ''}`;
      else if (!truthy(cfg.crm_write_back)) crmLine = '';
      else crmLine = `Not written to ${crmName}`;
      if (s.enrolled === true || lower(s.enrolled) === 'true') seqLine = `Added to cadence ${clean(s.cadence_name) || clean(s.cadence_id)}. The first email waits for your review.`;
      else if (clean(s.message)) seqLine = `Not enrolled: ${clean(s.message)}`;
      else if (!seqOn) seqLine = '';
      else if (!clean(e.email)) seqLine = 'Not enrolled: no new email';
      else if ((Number(d.score) || 0) < minScore) seqLine = `Not enrolled: score below ${minScore}`;
    }

    // ---- Alert text in three renderings: Slack markdown, HTML (email/Teams), plain text.
    let alert = null;
    if (d.notify) {
      const bucketLabel = { customer: 'Existing customer', open_deal: 'Open deal', lost_deal: 'Lost deal (second chance)', net_new: 'Net new account' }[d.bucket] || '';
      const li = c.linkedin_url;
      const ccNote = d.cc ? ` (cc ${tag(d.cc.slack_id, d.cc.name || d.cc.email)}, who worked with them at ${mdEsc(c.last_company) || 'their last company'})` : '';
      let subject; let md; let html; let plain;
      if (d.outcome === 'confirmed') {
        const fit = [d.persona ? `${d.persona} persona` : '', bucketLabel, `ICP ${d.icp_fit}`, `Confidence ${d.confidence}`, `Was a ${c.role_type}`].filter(Boolean);
        subject = `Champion move: ${name} is now at ${d.new_company} (${d.priority}, ${d.score}/100)`;
        md = [
          `:rotating_light: *Champion move: ${mdEsc(name)}* (${d.priority}, ${d.score}/100)`,
          `${mdEsc(c.last_company) || 'Previous company'} → *${mdEsc(d.new_company)}*${d.new_title ? ` as ${mdEsc(d.new_title)}` : ''}${d.started_new_role ? ` (since ${d.started_new_role})` : ''}`,
          `${tag(d.owner.slack_id, d.owner.name || d.owner.email) || 'Team'} this one is yours${ccNote}.`,
          `*Fit:* ${fit.join(' · ')}`,
          d.evidence ? `*Why we think so:*\n${mdEsc(d.evidence)}` : '',
          c.notes ? `*History with us:* ${mdEsc(c.notes)}` : '',
          emailLine ? `*New email:* ${emailLine}` : '',
          crmLine ? `*${crmName}:* ${crmLine}` : '',
          seqLine ? `*Sequence:* ${seqLine}` : '',
          d.draft_opener ? `*Draft opener (edit before sending):*\n${d.draft_opener.split('\n').map((l) => `> ${mdEsc(l)}`).join('\n')}` : '',
          li ? `<${li}|Open LinkedIn>` : '',
        ].filter(Boolean).join('\n');
        html = [
          `<p><b>Champion move: ${esc(name)}</b> (${esc(d.priority)}, ${esc(d.score)}/100)</p>`,
          `<p>${esc(c.last_company) || 'Previous company'} → <b>${esc(d.new_company)}</b>${d.new_title ? ` as ${esc(d.new_title)}` : ''}${d.started_new_role ? ` (since ${esc(d.started_new_role)})` : ''}</p>`,
          `<p><b>Fit:</b> ${esc(fit.join(' · '))}</p>`,
          d.evidence ? `<p><b>Why we think so:</b><br>${esc(d.evidence).replace(/\n/g, '<br>')}</p>` : '',
          c.notes ? `<p><b>History with us:</b> ${esc(c.notes)}</p>` : '',
          emailLine ? `<p><b>New email:</b> ${esc(emailLine)}</p>` : '',
          crmLine ? `<p><b>${esc(crmName)}:</b> ${esc(crmLine)}</p>` : '',
          seqLine ? `<p><b>Sequence:</b> ${esc(seqLine)}</p>` : '',
          d.draft_opener ? `<p><b>Draft opener (edit before sending):</b></p><blockquote>${esc(d.draft_opener).replace(/\n/g, '<br>')}</blockquote>` : '',
          li ? `<p><a href="${esc(li)}">Open LinkedIn</a></p>` : '',
        ].filter(Boolean).join('\n');
      } else {
        subject = `[VERIFY] ${name} may have left ${c.last_company || 'their company'}`;
        md = [
          `:mag: *[VERIFY] ${mdEsc(name)} may have left ${mdEsc(c.last_company) || 'their company'}*`,
          `${tag(d.owner.slack_id, d.owner.name || d.owner.email) || 'Team'} we have a signal but could not confirm a new role yet. Can you take a quick look? ${li ? `<${li}|Open LinkedIn>` : 'No LinkedIn URL on file'}`,
          d.evidence ? `*What we found:*\n${mdEsc(d.evidence)}` : '',
          `I will recheck automatically on ${d.next_check_on}.`,
        ].filter(Boolean).join('\n');
        html = [
          `<p><b>[VERIFY] ${esc(name)} may have left ${esc(c.last_company) || 'their company'}</b></p>`,
          `<p>We have a signal but could not confirm a new role yet. Can you take a quick look?${li ? ` <a href="${esc(li)}">Open LinkedIn</a>` : ''}</p>`,
          d.evidence ? `<p><b>What we found:</b><br>${esc(d.evidence).replace(/\n/g, '<br>')}</p>` : '',
          `<p>I will recheck automatically on ${esc(d.next_check_on)}.</p>`,
        ].filter(Boolean).join('\n');
      }
      plain = html.replace(/<br>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
      alert = {
        action: 'alert',
        kind: d.outcome === 'confirmed' ? 'move' : 'verify',
        contact_id: id,
        subject, text_md: md, html, text_plain: plain,
        to_name: clean(d.owner.name), to_email: clean(d.owner.email), to_slack_id: clean(d.owner.slack_id),
        cc_name: d.cc ? clean(d.cc.name) : '', cc_email: d.cc ? clean(d.cc.email) : '', cc_slack_id: d.cc ? clean(d.cc.slack_id) : '',
        priority: d.priority,
      };
    }

    const stamp = clean(d.decided_at).replace(/[-:TZ.]/g, '').slice(0, 14);
    const enrolled = s.enrolled === true || lower(s.enrolled) === 'true';
    return {
      case_row: {
        case_id: `${id}-${stamp}`,
        created_at: d.decided_at,
        contact_id: id,
        full_name: c.full_name,
        source: c.source || '',
        trigger: c.trigger,
        signal: c.signal,
        outcome: d.outcome,
        confidence: d.confidence,
        old_company: c.last_company,
        new_company: d.new_company,
        new_company_domain: d.new_company_domain,
        new_title: d.new_title,
        started_new_role: d.started_new_role,
        persona: d.persona,
        icp_fit: d.outcome === 'confirmed' ? d.icp_fit : '',
        bucket: d.bucket,
        score: d.score === '' ? '' : String(d.score),
        priority: d.priority,
        evidence: d.evidence,
        linkedin_url: c.linkedin_url,
        new_email: clean(e.email),
        crm_record_url: clean(r.crm_record_url) || clean(r.crm_record_id),
        sequence_status: d.outcome === 'confirmed' ? (enrolled ? 'enrolled' : seqLine.replace(/^Not enrolled: /, 'skipped: ')) : '',
        draft_opener: d.draft_opener,
        owner_ae: clean(d.owner.name) || clean(d.owner.email),
        notified: alert ? 'TRUE' : 'FALSE',
        ae_feedback: '',
      },
      state_row: {
        contact_id: id,
        full_name: c.full_name,
        status: d.status,
        last_checked: clean(d.decided_at).slice(0, 10),
        next_check_on: d.next_check_on,
        current_company: d.new_company,
        current_title: d.new_title,
        new_company_domain: d.new_company_domain,
        new_email: clean(e.email),
        moved_at: d.outcome === 'confirmed' ? clean(d.decided_at).slice(0, 10) : '',
        owner_ae: clean(d.owner.name),
        owner_ae_email: clean(d.owner.email),
        owner_ae_slack_id: clean(d.owner.slack_id),
        linkedin_url: c.linkedin_url,
        crm_record_url: clean(r.crm_record_url),
      },
      alert,
    };
  });
}

// @node-only-start
module.exports = { finalize };
// @node-only-end
