# Setup

This walkthrough uses a common B2B stack: **Salesforce** (CRM), **Gmail** (signals and inbox), **People Data Labs** (lookup), **Hunter** (new email), **Salesloft** (sequences) and **Slack** (alerts). Swap any of them for another connector; the steps are the same.

Plan for about 45 minutes.

## 0. Before you start

- **n8n 2.44 or later.** Self-hosted Community Edition is free. n8n Cloud works too.
- **An AI model key.** Anthropic is the default. OpenAI, Gemini, Mistral, Groq, OpenRouter or a local Ollama model work just as well.
- **API access** for the tools you plug in.

## 1. Import the workflows

In n8n, go to **Workflows > Import from File** and import:

- Everything in `workflows/core/`: Daily Run, Digest, Call Now Webhook, MCP Server.
- The connectors you need from `workflows/connectors/`. For this stack: `crm-salesforce`, `signals-gmail`, `lookup-people-data-labs`, `email-hunter`, `sequence-salesloft`, `alert-slack`.

Import connectors into the same project as the core workflows, so the core is allowed to call them.

## 2. Set up each connector

Every connector has a setup note on its canvas. In short:

### Salesforce (CRM)

1. Add a Salesforce credential to each Salesforce node.
2. In Salesforce, create a **Campaign** called `Valari` and add your champions as members. Give the campaign the member statuses **Buyer**, **Champion** and **User** and set each person's status. That's how roles are set without a custom field.
3. Prefer a different selection, such as a custom field or a report? Edit `soql_champions` in the connector's **Config**, then update the expressions in **Map Champions**.
4. Optional: set `instance_url` (for example `https://yourcompany.my.salesforce.com`) so alerts link to the new record.

On a confirmed move, the connector creates a **Contact** on the account if the new company is already in Salesforce, otherwise a **Lead**, plus a **Task** for the owner with the evidence and draft opener.

### Gmail (signals)

1. Add a Gmail credential for the inbox your reps send from.
2. If each rep sends from their own inbox, either have them forward bounce notices to one shared inbox (a Gmail filter on `from:mailer-daemon`) or duplicate this connector once per inbox.

### People Data Labs (lookup)

Create a **Header Auth** credential on **PDL Request**: name `X-Api-Key`, value your API key.

### Hunter (new email)

Create a **Header Auth** credential on **Hunter Request**: name `X-API-KEY`, value your API key.

### Salesloft (sequence)

1. Create a **Header Auth** credential: name `Authorization`, value `Bearer YOUR_API_KEY`. Select it on every HTTP node.
2. Create one cadence per account bucket, for example "Job switchers: net new", "Job switchers: open deal", "Job switchers: lost deal" and "Job switchers: existing customer". Each one gets its own message. **Make step 1 a manual email** so a rep reviews it before anything is sent.
3. Put the cadence IDs in `cadence_ids` in the connector's **Config**. Buckets without a cadence are skipped.
4. Optional: map rep emails to Salesloft user IDs in `user_ids_by_email` (or `salesloft_user_id` in the team directory), so people land in the right rep's cadence.

### Slack (alerts)

Create an incoming webhook for your alerts channel and paste it into `slack_webhook_url`. Add a second one in `digest_webhook_url` if the digest should go to a different channel.

## 3. Wire the connectors into the core

Open each connector and copy its workflow ID from the URL (`/workflow/<ID>`). Paste them into the core **Config** nodes:

| Core workflow | Fields |
|---|---|
| Daily Run | `crm_connector_id`, `signals_connector_id`, `lookup_connector_id`, `email_finder_connector_id`, `sequence_connector_id`, `alert_connector_id` (plus `product_users_connector_id` if you use one) |
| Digest | `alert_connector_id` |
| Call Now Webhook | `alert_connector_id` |

## 4. Describe your business

In the Daily Run **Config**:

- `product_description` and `icp_description`
- `personas`: who matters most (see [configuration](configuration.md#personas))
- `team_directory`: Slack IDs for @mentions, and a `default` owner for unowned people
- `opener_guidelines`: your house style for first messages
- Add your model credential on **Chat Model**, or replace that node with your provider's chat model node.

## 5. Optional: product users

If some champions are product users who aren't in your CRM, export them (email, name, company, title, LinkedIn URL if you have it) into a Google Sheet using the Champions tab layout from `sheet/valari-template.xlsx`. Import the **Google Sheets** connector a second time, point it at that sheet, and paste its ID into `product_users_connector_id`. People in both lists are merged by email.

## 6. Test

1. Add yourself or a colleague to the watchlist.
2. In the Daily Run, open the **When Called** trigger, pin this test input, and execute the workflow from that trigger:
   ```json
   { "contact_id": "<their contact ID or old work email>" }
   ```
3. Check Slack, Salesforce, Salesloft and the `valari_cases` data table (**Overview > Data tables**).
4. Unpin the test input.

## 7. Switch it on

Activate **Daily Run** (every morning at 7am), **Digest** (every other Monday at 9am) and **Call Now Webhook**. Schedules use your n8n instance's timezone.

## 8. Hook up "call now"

1. On the **Webhook** node, add a Header Auth credential (any header name and secret).
2. Copy the Production URL.
3. Point your tools at it, sending the same header:
   - **Your sequencing tool's webhooks** for email opened, clicked and replied.
   - **Your website visitor tool** (RB2B, Warmly, Snitcher, Leadfeeder, Apollo and others) for identified visits.

If a tool can't send custom headers, put it behind a small relay or switch the webhook to another auth method. The [configuration docs](configuration.md#call-now-webhook) list the payload fields it understands.

## 9. Optional: MCP

1. In the MCP Server workflow, open **investigate_contact** and pick the **Valari: Daily Run** workflow. If `contact_id` shows up blank, click the AI sparkle next to it.
2. Add a Bearer Auth credential on the trigger and activate it.
3. Add the Production URL to Claude, ChatGPT, Cursor or another MCP client as a remote MCP server.
