// Shared helpers for generating n8n workflow JSON.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Inline source files into a Code node: drops the node-only blocks (require/module.exports).
function inline(...files) {
  return files
    .map((f) => read(f).replace(/\/\/ @node-only-start[\s\S]*?\/\/ @node-only-end\n?/g, '').trim())
    .join('\n\n');
}

const uid = (seed) => {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// Data tables the core keeps its state in (created automatically on first run).
const TABLES = {
  state: {
    name: 'valari_state',
    columns: ['contact_id', 'full_name', 'status', 'last_checked', 'next_check_on', 'current_company', 'current_title', 'new_company_domain', 'new_email', 'moved_at', 'last_engagement_alert_at', 'owner_ae', 'owner_ae_email', 'owner_ae_slack_id', 'linkedin_url', 'crm_record_url'],
  },
  cases: {
    name: 'valari_cases',
    columns: ['case_id', 'created_at', 'contact_id', 'full_name', 'source', 'trigger', 'signal', 'outcome', 'confidence', 'old_company', 'new_company', 'new_company_domain', 'new_title', 'started_new_role', 'persona', 'icp_fit', 'bucket', 'score', 'priority', 'evidence', 'linkedin_url', 'new_email', 'crm_record_url', 'sequence_status', 'draft_opener', 'owner_ae', 'notified', 'ae_feedback'],
  },
};

function makeBuilder(wfKey) {
  const nodes = [];
  const connections = {};
  const add = (name, type, typeVersion, position, parameters, extra = {}) => {
    nodes.push({ parameters, id: uid(`${wfKey}/${name}`), name, type, typeVersion, position, ...extra });
    return name;
  };
  const connect = (from, to, { output = 0, input = 0, kind = 'main' } = {}) => {
    connections[from] ??= {};
    connections[from][kind] ??= [];
    while (connections[from][kind].length <= output) connections[from][kind].push([]);
    connections[from][kind][output].push({ node: to, type: kind, index: input });
  };
  const chain = (...names) => { for (let i = 0; i < names.length - 1; i++) connect(names[i], names[i + 1]); };

  const b = {
    nodes, connections, add, connect, chain,
    sticky(name, position, width, height, content, color = 7) {
      return add(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });
    },
    code(name, position, jsCode, extra = {}, mode) {
      return add(name, 'n8n-nodes-base.code', 2, position, mode ? { mode, jsCode } : { jsCode }, extra);
    },
    // Set node holding settings. includeOther keeps the incoming item fields (used inside connectors).
    config(name, position, fields, { includeOther = false } = {}) {
      const assignments = Object.entries(fields).map(([k, v]) => ({
        id: uid(`${wfKey}/${name}/${k}`), name: k, value: v, type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string',
      }));
      return add(name, 'n8n-nodes-base.set', 3.4, position, { assignments: { assignments }, ...(includeOther ? { includeOtherFields: true } : {}), options: {} });
    },
    ifTrue(name, position, expr) {
      return add(name, 'n8n-nodes-base.if', 2.2, position, {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{ id: uid(`${wfKey}/${name}/cond`), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
          combinator: 'and',
        },
        options: {},
      });
    },
    // Switch on $json[field] (default "action"), one output per value.
    route(name, position, actions, field = 'action') {
      return add(name, 'n8n-nodes-base.switch', 3.2, position, {
        rules: {
          values: actions.map((a) => ({
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
              conditions: [{ id: uid(`${wfKey}/${name}/${a}`), leftValue: `={{ $json.${field} }}`, rightValue: a, operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: a,
          })),
        },
        options: {},
      });
    },
    // Calls a connector chosen by ID in Config.
    callConnector(name, position, configKey, extra = {}) {
      return add(name, 'n8n-nodes-base.executeWorkflow', 1.2, position, {
        source: 'database',
        workflowId: { __rl: true, mode: 'id', value: `={{ $('Config').first().json.${configKey} }}` },
        mode: 'once',
        options: {},
      }, { alwaysOutputData: true, ...extra });
    },
    passthroughTrigger(name, position) {
      return add(name, 'n8n-nodes-base.executeWorkflowTrigger', 1.1, position, { inputSource: 'passthrough' });
    },
    ensureTable(name, position, table) {
      return add(name, 'n8n-nodes-base.dataTable', 1.1, position, {
        resource: 'table', operation: 'create', tableName: table.name,
        columns: { column: table.columns.map((c) => ({ name: c, type: 'string' })) },
        options: { createIfNotExists: true },
      }, { executeOnce: true });
    },
    readTable(name, position, table, extra = {}) {
      return add(name, 'n8n-nodes-base.dataTable', 1.1, position, {
        resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'name', value: table.name }, returnAll: true,
      }, { executeOnce: true, alwaysOutputData: true, ...extra });
    },
    upsertRows(name, position, table) {
      return add(name, 'n8n-nodes-base.dataTable', 1.1, position, {
        resource: 'row', operation: 'upsert', dataTableId: { __rl: true, mode: 'name', value: table.name },
        matchType: 'allConditions',
        filters: { conditions: [{ keyName: 'contact_id', condition: 'eq', keyValue: '={{ $json.contact_id }}' }] },
        columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
        options: {},
      });
    },
    insertRows(name, position, table) {
      return add(name, 'n8n-nodes-base.dataTable', 1.1, position, {
        resource: 'row', operation: 'insert', dataTableId: { __rl: true, mode: 'name', value: table.name },
        columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
        options: {},
      });
    },
    workflow(name, extra = {}) {
      return {
        name, nodes, connections, active: false,
        settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
        pinData: {}, meta: { templateCredsSetupCompleted: false }, tags: [], ...extra,
      };
    },
  };
  return b;
}

module.exports = { ROOT, read, inline, uid, TABLES, makeBuilder };
