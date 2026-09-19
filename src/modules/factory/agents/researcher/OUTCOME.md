---
kind: research
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "siteTitle", "description", "sourceUrl"],
  "properties": {
    "summary": { "type": "string", "minLength": 1 },
    "siteTitle": { "type": "string", "nullable": true },
    "description": { "type": "string", "minLength": 1 },
    "sourceUrl": { "type": "string", "nullable": true }
  }
}
```

`summary` — 1–2 sentences in Polish on what you fetched and found (or why nothing).

`siteTitle` — the page title of the customer's website as fetched, or `null`.

`description` — 1–2 sentences in Polish about the customer for the reference card, facts from the fetched pages only.

`sourceUrl` — the URL the description comes from, or `null` when nothing could be fetched. Pass this whole object as the `outcome` argument of the submit_outcome tool (an object, not a string).
