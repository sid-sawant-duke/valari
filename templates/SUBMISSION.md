# n8n template submission

Everything to paste into the n8n Creator Portal (**creators.n8n.io > Share new template**).

## Title

**Track champion job changes with Gmail bounces, Apollo, AI and Slack alerts**

Alternatives:
- Detect when past customers change jobs using email bounces, Apollo and AI
- Alert sales reps when product champions move to a new company

## Template code

Paste the contents of `valari-template.json`.

## Description

### Who's it for

This is the template edition of **Valari**, an open source champion job-change tracker for n8n.

B2B sales, customer success and GTM teams who want to know when people who used their product move to a new company, without paying for a job-change tool. A champion who switches jobs already knows your product, which makes them one of the warmest leads you can get.

### How it works

1. **Every morning** the workflow reads your champions from Google Sheets and scans Gmail for bounced emails and "no longer with the company" auto-replies. A monthly sweep also checks a third of the list, so everyone is checked once a quarter.
2. Each person with a signal is looked up in **Apollo**, within a **monthly credit budget** you set. A Slack warning goes out at 80%, results are reused for 14 days, and phone numbers are never requested.
3. An **AI agent** weighs the evidence and decides: **confirmed move**, **[VERIFY]** (a signal, but no new role yet) or **no change**. It also writes a short draft opener.
4. Confirmed moves are **scored** on the person's role, the personas you care about, seniority, whether the new company is a customer, open deal or lost deal, ICP fit and how recently they started.
5. Each move is posted to **Slack**, @mentioning the account owner (and cc'ing the champion's old rep), with the evidence, score and draft opener. Their new work email comes from Apollo when it has one; optionally **Hunter** fills the gaps.
6. **Every other Monday** a digest of confirmed moves and open [VERIFY] cases goes to Slack.
7. A **webhook** turns email opens, clicks, replies and website visits from a moved champion's new company into **"call now"** alerts.

[VERIFY] cases are rechecked every 30 days. Tracker state lives in two n8n Data Tables, created on the first run. Nothing is ever sent to a champion automatically.

### How to set up

1. Create a Google Sheet with a **Champions** tab (contact_id, full_name, work_email, linkedin_url, last_company, last_company_domain, last_title, role_type, owner_ae, owner_ae_email, owner_ae_slack_id, do_not_contact, notes) and a **Customers** tab (domain, company_name, relationship, owner_ae, owner_ae_email, owner_ae_slack_id). A ready-made template is linked in the main sticky note.
2. Add credentials: Google Sheets, Gmail, Slack, your AI model, and a Header Auth credential for Apollo (name `x-api-key`).
3. Fill in the **Config** node: sheet ID, Slack channel, Apollo monthly budget, a short description of your product and ideal customer, your personas, and a team directory with Slack member IDs for @mentions.
4. Put a contact ID in **Test Contact**, run **Test One Person**, and check Slack.
5. Activate the workflow. For "call now" alerts, add a Header Auth credential to the webhook and point your sequencing and website visitor tools at its URL.

### Requirements

- A recent n8n version with Data Tables (built and tested on n8n 2.44)
- Apollo account with API access (it only charges a credit when it finds someone)
- Google Sheets, Gmail and Slack
- An AI model that supports tool calling (Anthropic by default; OpenAI, Gemini, Mistral, Ollama and others work)
- Optional: Hunter for new work emails

### How to customize

- **Personas:** reward the roles that matter to you. For example, give UX researchers more points than a VP who never logged in.
- **Scoring:** every weight and the Hot / Warm thresholds can be changed in Config.
- **Opener style:** set house guidelines so every draft sounds the same.
- **AI model:** swap the Chat Model node for any provider.
- **Full version:** the full Valari project adds a lookup waterfall (Apollo, Clay, People Data Labs), Salesforce, Salesloft and plug-in connectors for any CRM, sequencing or alert tool: https://github.com/sid-sawant-duke/valari

## Categories and tags

Sales, Lead Generation, AI, CRM. Tags: job change, champion tracking, Slack, Gmail, Apollo, AI agent.

## Pre-submission checklist

- [x] Main yellow sticky note: who it's for, how it works, setup
- [x] Section sticky notes group each stage; warning notes only for setup steps
- [x] Every node has a descriptive name
- [x] No credentials, tokens or personal data in the JSON (API keys go in n8n credentials)
- [x] Placeholders are clearly marked (`PASTE_...`, `REPLACE: ...`)
- [x] Re-test inside n8n after the Apollo switch (daily run, one-person test, digest, webhook)
- [x] Retake the canvas screenshot after the Apollo switch
- [ ] GitHub repo is public, so the links in the sticky note and description work
