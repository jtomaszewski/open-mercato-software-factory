---
kind: research
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "changedFiles"],
  "properties": {
    "summary": { "type": "string", "minLength": 1 },
    "changedFiles": { "type": "array", "items": { "type": "string", "minLength": 1 } }
  }
}
```

`summary` — 2–4 sentences in Polish describing the change, with no preamble or heading; it becomes the pull request description. When nothing could be changed, say why.

`changedFiles` — repository-relative paths of every file you created, edited or deleted; an empty array when you changed nothing. Pass this whole object as the `outcome` argument of the submit_outcome tool (an object, not a string).
