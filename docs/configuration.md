# Configuration

Everything is set in the **Config** node at the start of each core workflow. Connector settings live in each connector's own **Config** node.

## Daily Run

### Connectors

| Field | Required | What it is |
|---|---|---|
| `crm_connector_id` | yes | Watchlist, accounts and CRM write-back (e.g. Salesforce or Google Sheets). |
| `lookup_1_connector_id` | yes | First lookup tool (e.g. Apollo). Up to three, see below. |
| `alert_connector_id` | yes | Where alerts go (e.g. Slack or Gmail). |
| `lookup_2_connector_id`, `lookup_3_connector_id` | optional | Second and third lookup tools (e.g. Clay, People Data Labs). |
| `signals_connector_id` | recommended | Bounce and auto-reply detection (e.g. Gmail). Without it, only rechecks and the monthly sweep run. |
| `product_users_connector_id` | optional | A second watchlist of product users (e.g. a Google Sheets connector pointed at a product export). Merged with the CRM list by email. |
| `email_finder_connector_id` | optional | Finds the new work email (e.g. Hunter). |
| `sequence_connector_id` | optional | Enrolls confirmed switchers in a sequence (e.g. Salesloft). Needs an email finder. |

Paste each connector's workflow ID, which is the last part of its URL: `/workflow/<ID>`. Leave optional ones blank to skip that step.

### Lookup waterfall and credit budgets

| Field | Default | What it does |
|---|---|---|
| `lookup_1_name` … `lookup_3_name` | `apollo`, `clay`, `people_data_labs` | Name of the tool in each slot. Used for budgets, the cache and the "source" shown to reps. |
| `lookup_1_monthly_budget` … `lookup_3_monthly_budget` | `500`, `200`, `100` | Credits each tool may use per calendar month. At the limit the tool pauses and the next one is used. Blank means no limit; `0` switches the tool off. |
| `budget_warning_percent` | `80` | Sends one alert per tool per month when its usage crosses this share of its budget. |
| `lookup_cache_days` | `14` | Reuse a lookup result for this long instead of paying again. |
| `lookup_repeat_days` | `30` | Don't ask a tool about the same person again within this many days after it found nothing (or while it's still working on them). |

Usage is tracked per month in the `valari_usage` data table, and results in `valari_lookups` (with the signal that started each lookup, so a Clay answer that arrives later is judged against the same bounce or auto-reply).

### Behavior

| Field | Default | What it does |
|---|---|---|
| `crm_name` | `Salesforce` | Label used in alerts. |
| `crm_write_back` | `true` | Create the new contact (or lead) and a task in the CRM for confirmed moves. |
| `product_description` | | One or two sentences about your product. Used for the draft opener. |
| `icp_description` | | Your ideal customer. The agent judges the new company's fit against it. |
| `personas` | `[]` | Who you care about most. See below. |
| `scoring` | `{}` | Overrides for any scoring weight. See below. |
| `team_directory` | `{}` | Maps owners to names, emails, Slack IDs and sequence user IDs. See below. |
| `opener_guidelines` | warm, short | House style for the draft opener, so every rep's first message sounds the same. |
| `enroll_min_score` | `45` | Only moves scoring at least this much are enrolled in a sequence. |
| `max_lookups_per_run` | `40` | Safety cap on how many people are investigated per run. |
| `sweep_day_of_month` | `1` | The day the monthly sweep runs. Each sweep checks a third of the list, so everyone is checked once a quarter. |
| `recheck_after_days` | `30` | How long before a [VERIFY] case is checked again. |

### Personas

Persona points reward the kinds of people who matter most to you, whatever their seniority. Keywords are matched against the new job title (or the old one if the new one is unknown). Plurals and "-er" forms match too ("research" matches "Researcher"), but "product" does not match "Production".

Example for a research tool:

```json
[
  { "name": "Researcher", "keywords": ["ux research", "user research", "research"], "points": 25 },
  { "name": "Designer",   "keywords": ["ux design", "product design", "designer"], "points": 20 },
  { "name": "Product",    "keywords": ["product manager", "product"], "points": 15 }
]
```

### Scoring

Only confirmed moves are scored, from 0 to 100.

| Factor | Default points |
|---|---|
| `role`: role at the old company | buyer 30 · champion 25 · user 15 |
| `persona`: best matching persona | from `personas` |
| `seniority`: new title | executive 15 · director 10 · manager 5 |
| `bucket`: the new company | open_deal 20 · net_new 15 · lost_deal 15 · customer 10 |
| `icp`: agent's ICP judgment | strong 15 · partial 8 · unknown 5 · weak 0 |
| `recency`: started the new role | within 3 months 10 · within 6 months 5 |
| `confidence` multiplier | high ×1 · medium ×0.85 · low ×0.6 |
| `thresholds` | Hot ≥ 70 · Warm ≥ 45 · otherwise Cool |

Override any part with `scoring`. For example, to ignore seniority completely and raise the Hot bar:

```json
{ "seniority": { "executive": 0, "director": 0, "manager": 0 }, "thresholds": { "hot": 80 } }
```

### Team directory

Fills in owner details the CRM doesn't have, such as Slack member IDs for @mentions. Keys can be an owner's email, CRM user ID or name. The `default` entry is used for people with no owner, such as product users who aren't in the CRM.

```json
{
  "priya@yourcompany.example": { "name": "Priya Shah", "slack_id": "U01ABCDEF", "salesloft_user_id": "1234" },
  "005Dn000001XyZq":       { "name": "Marcus Lee", "email": "marcus@yourcompany.example", "slack_id": "U02GHIJKL" },
  "default":               { "name": "SDR queue", "email": "sdr@yourcompany.example", "slack_id": "S03MNOPQR" }
}
```

To find a Slack member ID: open the person's profile, click **⋮**, then **Copy member ID**. A user-group ID (starting with `S`) works for @mentioning a team.

## Digest

| Field | Default | What it does |
|---|---|---|
| `alert_connector_id` | | Where the digest goes. Slack posts it to the channel; Gmail emails the connector's `digest_recipients`. |
| `digest_lookback_days` | `14` | How far back the digest looks. |
| `digest_title` | `Champion moves` | Heading and subject line. |

Runs every other Monday at 9am in your n8n instance's timezone. Change the schedule on the trigger node.

## Call Now Webhook

| Field | Default | What it does |
|---|---|---|
| `alert_connector_id` | | Where "call now" alerts go. |
| `engagement_window_days` | `90` | Only champions who moved within this many days trigger alerts. |
| `engagement_cooldown_hours` | `24` | At most one alert per person in this window. |

Send it any JSON with an email or company domain. Field names it understands:

- **Email:** `email`, `email_address`, `work_email`, `recipient_email`, `recipient`, `to`, `person.email`, `person.email_address`, `contact.email`, `lead.email`, `visitor.email`. As a fallback, any email address anywhere in the payload.
- **Domain:** `domain`, `company_domain`, `website`, `company.domain`, `company.website`, `organization.domain`, `account.domain`, `visitor.company_domain`.
- **Event type:** `event_type`, `event`, `type`, `action`. Values containing "open", "click" or "repl" become email events. Anything else is treated as a website visit.
- **Page:** `page`, `page_url`, `url`, `subject`.

Email events only match by person. Website visits can match by company domain, since visitor tools usually identify the company rather than the person. The alert then says "someone from Acme" rather than naming the champion.
