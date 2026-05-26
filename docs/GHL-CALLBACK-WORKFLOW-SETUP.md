# GHL Workflow: Callback Request Handoff

Manual setup steps for the GoHighLevel side of the chatbot "Talk to a
human" feature. The AHDD website POSTs to `/api/callback` which proxies
to the GHL inbound webhook URL created in step 1 below.

**Why manual:** GHL renders the workflow builder in a cross-origin
iframe (`client-app-automation-workflows.leadconnectorhq.com`). Both
Chrome-extension automation and OS-level clicks are blocked there, so
this part of the build can't be driven by the agent. The whole setup
takes about 10 minutes once you have the page open.

---

## 1. Create custom fields (if missing)

**Path:** Settings → Custom Fields → Contact

Reuse if it already exists (it does for the Smile Analysis flow):

- `source_page` — Single Line

Create these new fields if not present:

| Field name              | Type             | Notes                                  |
| ----------------------- | ---------------- | -------------------------------------- |
| `best_time_to_call`     | Single Line      | Value comes straight from the chatbot. |
| `reason_for_call`       | Multi Line       | Optional free-text from patient.       |
| `callback_requested_at` | Single Line      | ISO 8601 timestamp string.             |

(Single Line for `callback_requested_at` is more forgiving than the
Date type since the value is an ISO 8601 string with timezone — Date
fields strip the time component on some plan tiers.)

## 2. Create the workflow

**Path:** Automation → Workflows → **+ Create Workflow** → **Start from
scratch**.

Name it: **Callback Request Handoff**

## 3. Add the Inbound Webhook trigger

1. In the new workflow, click **+ Add New Workflow Trigger**.
2. Choose **Inbound Webhook**.
3. Name the trigger: `Chatbot callback request`.
4. Click **Save Trigger**. GHL generates a unique webhook URL — copy it.
5. **Paste the URL into the AHDD project** in two places (server-only,
   never exposed to the browser):
   - **Vercel** → Project: `ahdd-website` → Settings → Environment
     Variables → add `GHL_CALLBACK_WEBHOOK_URL` for Production, Preview,
     and Development. Redeploy after saving.
   - **Local dev** → `~/Documents/ahdd-website/.env.local` (gitignored)
     → add the same line.

Sample payload (for the **Sample Request** field in GHL — paste this
before mapping fields so GHL discovers the keys):

```json
{
  "firstName": "Sarah",
  "phone": "+18187066077",
  "bestTimeToCall": "Afternoon",
  "reasonForCall": "Want to ask about veneers pricing",
  "sourcePage": "/veneers",
  "requestedAt": "2026-05-26T15:30:00.000Z",
  "tags": ["callback_requested"]
}
```

Click **Test Trigger** after pasting — GHL will populate the field
picker with the keys above.

## 4. Action: Create / Update Contact

Click **+** below the trigger → **Contact** → **Create / Update
Contact**.

Field mapping:

| GHL contact field          | Source                                          |
| -------------------------- | ----------------------------------------------- |
| First Name                 | `{{inboundWebhookRequest.firstName}}`           |
| Phone                      | `{{inboundWebhookRequest.phone}}`               |
| Source                     | Static: `Website Chatbot — Callback Request`    |
| Tags                       | Static: `callback_requested` (one tag)          |
| `best_time_to_call`        | `{{inboundWebhookRequest.bestTimeToCall}}`      |
| `reason_for_call`          | `{{inboundWebhookRequest.reasonForCall}}`       |
| `callback_requested_at`    | `{{inboundWebhookRequest.requestedAt}}`         |
| `source_page`              | `{{inboundWebhookRequest.sourcePage}}`          |

Save the action.

## 5. Action: Email staff at emailus@agourahillsdentaldesigns.com

Click **+** below Create Contact → **Send Email**.

- **To:** `emailus@agourahillsdentaldesigns.com`
- **From name:** `AHDD Website`
- **From email:** the default sending address (use whatever the Smile
  Analysis workflow uses — keeps deliverability consistent)
- **Subject:** `Callback requested: {{contact.first_name}} — {{contact.best_time_to_call}}`

Body (HTML — paste verbatim):

```html
<p><strong>{{contact.first_name}}</strong> requested a callback from the website chatbot.</p>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Name</td><td style="padding:4px 0;"><strong>{{contact.first_name}}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Phone</td><td style="padding:4px 0;"><a href="tel:{{contact.phone}}"><strong>{{contact.phone}}</strong></a></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Best time</td><td style="padding:4px 0;"><strong>{{contact.best_time_to_call}}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Reason</td><td style="padding:4px 0;">{{contact.reason_for_call}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Page</td><td style="padding:4px 0;">{{contact.source_page}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Requested</td><td style="padding:4px 0;">{{contact.callback_requested_at}}</td></tr>
</table>
<p style="margin-top:14px;color:#1D3E5C;"><a href="https://app.gohighlevel.com/v2/location/ZctCFusr5pyeEBo9FLH4/contacts/detail/{{contact.id}}">Open contact in GHL</a></p>
```

Save the action.

## 6. (Optional, only if SMS is configured) Action: Patient ack SMS

This step is **conditional** — only add it if the GHL account has SMS
sending enabled. To check: Settings → Phone Numbers → confirm at least
one number is provisioned and active for outbound SMS.

If yes:

Click **+** below the Email action → **Send SMS**.

- **To:** `{{contact.phone}}`
- **Message:**

  ```
  Hi {{contact.first_name}}, this is Agoura Hills Dental Designs. We received
  your callback request and someone from our team will reach out during
  {{contact.best_time_to_call}}. — AHDD
  ```

Keep it under 160 chars to stay single-segment. Save.

## 7. Publish

Top right → toggle **Draft → Published**.

## 8. Verify end-to-end

After Vercel redeploys with `GHL_CALLBACK_WEBHOOK_URL` set:

1. Open the live site, open the chatbot, click **Talk to a human**.
2. Walk through: First name → real phone you can monitor → time pick →
   short reason (or Skip).
3. In GHL Contacts → confirm new contact with the tag `callback_requested`
   and all custom fields populated.
4. Check `emailus@agourahillsdentaldesigns.com` for the staff email.
5. (If SMS step added) Confirm SMS arrives at the phone you entered.

## Phase 2 (not yet built)

- **Staff SMS notification** — Catalina hasn't confirmed a destination
  number for internal alerts. When she does, add a parallel SMS action
  to step 5 routed to that number.
- **Reminder safety net** — Wait 4 hours → if tag `callback_completed`
  isn't on the contact, send a second notification. Skipped for now —
  add only if callbacks start slipping.
