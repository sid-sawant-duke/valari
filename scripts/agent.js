// The Investigator agent and its sub-nodes, shared by the core Daily Run and the single-workflow template.
const { read } = require('./lib');

const agentText = `=Investigate this person.

Name: {{ $json.full_name }}
Email at last company: {{ $json.work_email }}
LinkedIn: {{ $json.linkedin_url || 'not on file' }}
Last known company: {{ $json.last_company }} ({{ $json.last_company_domain || 'domain unknown' }})
Last known title: {{ $json.last_title || 'unknown' }}
Relationship with us: {{ $json.role_type }}. {{ $json.notes }}
Why we are checking: {{ $json.trigger }}. {{ $json.signal_evidence }}
Today: {{ $now.toISODate() }}

Our product: {{ $('Config').first().json.product_description }}
Our ICP: {{ $('Config').first().json.icp_description }}
Personas we care most about: {{ (() => { try { return JSON.parse($('Config').first().json.personas || '[]').map(p => p.name).join(', ') || 'not set'; } catch (e) { return 'not set'; } })() }}
Opener guidelines: {{ $('Config').first().json.opener_guidelines }}

Lookup result:
{{ $json.lookup_json }}`;

const verdictSchema = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['confirmed', 'verify', 'no_change'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    new_company: { type: 'string', description: 'Empty unless confirmed' },
    new_company_domain: { type: 'string', description: 'Website domain of the new company, e.g. acme.com' },
    new_title: { type: 'string' },
    started_new_role: { type: 'string', description: 'YYYY-MM if known, else empty' },
    side_role: { type: 'boolean' },
    icp_fit: { type: 'string', enum: ['strong', 'partial', 'weak', 'unknown'] },
    evidence: { type: 'string', description: '1 to 4 lines, each starting with "- "' },
    draft_opener: { type: 'string', description: 'Only when confirmed, else empty' },
  },
  required: ['outcome', 'confidence', 'new_company', 'new_company_domain', 'new_title', 'started_new_role', 'side_role', 'icp_fit', 'evidence', 'draft_opener'],
  additionalProperties: false,
};

// Adds the agent at [ax, ay] with its sub-nodes in a row below, and wires `from` into it.
function addInvestigator(b, from, ax, ay) {
  b.add('Investigator', '@n8n/n8n-nodes-langchain.agent', 2.2, [ax, ay], {
    promptType: 'define', text: agentText, hasOutputParser: true,
    options: { systemMessage: read('prompts/investigator-system.md'), maxIterations: 6 },
  }, { onError: 'continueRegularOutput' });
  b.add('Chat Model', '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.3, [ax - 160, ay + 260], { model: { __rl: true, mode: 'id', value: 'claude-haiku-5-5' }, options: { temperature: 0.1 } });
  b.add('Think', '@n8n/n8n-nodes-langchain.toolThink', 1, [ax - 20, ay + 260], { description: 'A scratchpad. Use it to reason through conflicting evidence before you decide the outcome. It does not look anything up.' });
  b.add('web_search', '@n8n/n8n-nodes-langchain.toolSerpApi', 1, [ax + 120, ay + 260], { options: {} }, { disabled: true, notes: 'Optional. Add a SerpApi credential and enable this node to let the agent search the web. Then set require_lookup_match to false in Config, or moves found only on the web stay [VERIFY].' });
  b.add('Verdict Format', '@n8n/n8n-nodes-langchain.outputParserStructured', 1.2, [ax + 260, ay + 260], { schemaType: 'manual', inputSchema: JSON.stringify(verdictSchema, null, 2) });
  b.connect(from, 'Investigator');
  b.connect('Chat Model', 'Investigator', { kind: 'ai_languageModel' });
  b.connect('Think', 'Investigator', { kind: 'ai_tool' });
  b.connect('web_search', 'Investigator', { kind: 'ai_tool' });
  b.connect('Verdict Format', 'Investigator', { kind: 'ai_outputParser' });
}

module.exports = { agentText, verdictSchema, addInvestigator };
