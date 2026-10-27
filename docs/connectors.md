# Connectors

Valari's core never talks to a vendor. It calls **connectors**: small n8n workflows, one per tool, that translate between the core and Salesforce, Gmail, Slack and so on. To support a new tool, you write one connector. The core doesn't change.

## How the core calls a connector

- Each connector starts with an **Execute Workflow Trigger** set to **Accept all data**.
- The core sends a batch of items with an `action` field and waits for the result.
- A batch always holds **one action type**. A connector can route on `$json.action` with a Switch node.
- **The last node that runs is the result.** If your connector branches, end the branches in a Merge (append) node so nothing is lost.
- Return nothing (or an empty list) for actions you don't support.
- For per-person actions, **always return `contact_id`**. The core joins results back by it, so order doesn't matter.
- Don't throw on a single bad record. Use **On Error: Continue** on vendor nodes and return an `error` field on that person's result instead.

The core picks connectors by workflow ID from its **Config** node, so one n8n instance can run several (for example a CRM connector and a second Google Sheets connector for product users).

## Connector types

### CRM (`crm_connector_id`)

Also used for product-user lists (`product_users_connector_id`), which only need `list_champions`.

**`list_champions`**: input is one item `{ action }`. Return one item per champion:

| Field | Required | Notes |
|---|---|---|
| `contact_id` | yes* | Stable ID. *Product lists can omit it; the email is used instead. |
| `work_email` | yes | Email at the old company. Signals are matched on it. |
| `full_name` or `first_name` + `last_name` | yes | |
| `linkedin_url` | recommended | Best key for lookups. |
| `last_company`, `last_company_domain`, `last_title` | recommended | |
| `role_type` | | `buyer`, `champion` or `user` (anything else counts as `user`). |
| `owner_ae`, `owner_ae_email`, `owner_ae_slack_id`, `owner_crm_id` | | Missing values are filled from the team directory. |
| `do_not_contact` | | `TRUE` skips the person entirely. |
| `notes` | | Shown to the agent and in alerts ("History with us"). |

**`list_accounts`**: return one item per company you already have a relationship with:

| Field | Notes |
|---|---|
| `domain` | Website domain, e.g. `acme.com`. Matching key. |
| `relationship` | `customer`, `open_deal` or `lost_deal`. |
| `company_name`, `crm_account_id` | `crm_account_id` lets `record_move` attach the new contact to the account. |
| `owner_ae`, `owner_ae_email`, `owner_ae_slack_id`, `owner_crm_id` | The account owner gets the alert for moves into this account. |

**`record_move`**: one item per confirmed move. Input fields: `contact_id`, `first_name`, `last_name`, `full_name`, `new_email`, `new_title`, `new_company`, `new_company_domain`, `crm_account_id`, `owner_crm_id`, `old_company`, `old_crm_contact_id`, `task_subject`, `task_body`.

Return `{ contact_id, crm_record_id, crm_record_type, crm_record_url, task_id, error }`.

### Signals (`signals_connector_id`)

**`get_signals`**: return recent messages that might be bounces or "I've left" auto-replies:

`{ id, subject, from, text, date, headers }`

The core does the classification. Return anything that might be a signal; false positives are filtered out.

### Lookup (`lookup_connector_id`)

**`lookup_person`**: input `{ contact_id, full_name, first_name, last_name, work_email, linkedin_url, last_company, last_company_domain }`.

Return `{ contact_id, found, ... }` with whatever the source knows. The agent reads it as JSON. Fields it understands best: `job_title`, `job_company_name`, `job_company_website`, `job_start_date`, `job_last_verified`, and `experience: [{ company, company_website, title, start_date, end_date, is_primary }]`. Keep it small: the whole result goes into the prompt. For "not found", return `{ contact_id, found: false, note }`.

### Email finder (`email_finder_connector_id`)

**`find_email`**: input `{ contact_id, first_name, last_name, full_name, domain, company }`.

Return `{ contact_id, email, status, confidence, source }`, where `status` is `valid`, `risky`, `invalid` or `unknown` and `confidence` is 0 to 100. Return an empty `email` when nothing was found.

### Sequence (`sequence_connector_id`)

**`enroll`**: input `{ contact_id, email, first_name, last_name, title, company, company_domain, cadence_key, persona, priority, owner_email, owner_sequence_user_id, note }`. `cadence_key` is the account bucket (`net_new`, `lost_deal`, `open_deal`, `customer`), so connectors can map each bucket to its own sequence.

Return `{ contact_id, enrolled, cadence_id, cadence_name, message }`. `message` explains a skip or an error.

**Rule:** never send an email directly. Enroll into a sequence whose first step a person reviews.

### Alerts (`alert_connector_id`)

**`alert`**: one item per alert. Fields: `kind` (`move`, `verify` or `call_now`), `contact_id`, `subject`, `text_md` (Slack markdown with `<@SLACKID>` mentions), `html`, `text_plain`, `to_name`, `to_email`, `to_slack_id`, `cc_name`, `cc_email`, `cc_slack_id`, `priority`. Use whichever rendering fits your tool.

**`digest`**: one item with `subject`, `html` and `text_md`.

## Writing a new connector

1. Copy the closest existing connector from `workflows/connectors/` (for example `crm-salesforce.json` for HubSpot).
2. Keep the trigger, **Config** and **Route** nodes. Replace the vendor nodes.
3. Map the vendor's fields to the standard fields above in a Set node, so users can fix mappings without code.
4. Test it on its own: pin some input on the trigger (`{ "action": "list_champions" }`) and click **Execute workflow**.
5. Open a pull request with the exported JSON in `workflows/connectors/` and a line in the README's connector table. If it has Code nodes with real logic, put that logic in `src/connectors/` with a test, as the existing ones do.

Connectors people have asked for are tracked as issues labelled `connector`.
