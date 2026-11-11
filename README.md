# Encoded Query Merger

Combine two or more ServiceNow encoded queries into one query that matches any record any of them matches. Add as many query fields as you need.

**Use it:** https://jessems.github.io/encoded-query-merger/

## Why not just `A^ORB`?

In an encoded query, `^OR` only applies to the condition right before it. `a^b^ORc^d` means `a AND (b OR c) AND d`, so joining queries with `^OR` changes what they match.

The operator that ORs whole queries is `^NQ` (new query). The merger:

1. splits each query into its `^NQ` blocks,
2. puts all blocks one after another and drops exact duplicates,
3. moves `ORDERBY` / `ORDERBYDESC` / `GROUPBY` clauses to the end (the first query wins if several sort on the same field),
4. removes a trailing `^EQ` and keeps escaped carets (`^^`) inside values.

```
A:      active=true^priority=1^ORpriority=2^ORDERBYnumber
B:      assigned_to=javascript:gs.getUserID()^NQopened_by=javascript:gs.getUserID()
Merged: active=true^priority=1^ORpriority=2^NQassigned_to=javascript:gs.getUserID()^NQopened_by=javascript:gs.getUserID()^ORDERBYnumber
```

It also accepts URL-encoded queries and full list URLs containing `sysparm_query=`. Empty fields on the page are ignored. In `merge()` itself, an empty query matches every record, so the merged query does too.

## Development

No build step. `index.html` loads `merge.js` directly.

```sh
npm test
```
