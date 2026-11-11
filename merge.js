// Encoded Query Merger: combine two ServiceNow encoded queries with a top-level OR.
//
// Why not just `A^ORB`? In an encoded query, `^OR` binds only to the condition
// right before it, so `a^b^ORc^d` means `a AND (b OR c) AND d`. Gluing two
// queries together with `^OR` silently changes their meaning. `^NQ` ("new
// query") is the only operator that ORs whole queries, so the merged result is
// every NQ block of A followed by every NQ block of B, with sort clauses moved
// to the end.

const SORT_PREFIXES = ["ORDERBYDESC", "ORDERBY", "GROUPBY"];

// Split on `^`, keeping `^^` (an escaped caret inside a value) intact.
function tokenize(query) {
  const tokens = [];
  let current = "";
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (ch === "^" && query[i + 1] === "^") {
      current += "^^";
      i++;
    } else if (ch === "^") {
      tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  tokens.push(current);
  return tokens.map((t) => t.trim()).filter((t) => t !== "");
}

// Accept a raw query, a URL-encoded query, or a full list URL containing sysparm_query.
export function normalize(input) {
  let q = String(input ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const match = q.match(/[?&]sysparm_query=([^&#]*)/);
  if (match) q = match[1];
  if (/%5E|%3D|%40/i.test(q)) {
    try {
      q = decodeURIComponent(q.replace(/\+/g, " "));
    } catch {
      // Not valid percent-encoding; use as-is.
    }
  }
  return q.trim();
}

function sortField(clause) {
  const prefix = SORT_PREFIXES.find((p) => clause.startsWith(p));
  return prefix === "GROUPBY" ? clause : clause.slice(prefix.length);
}

export function parse(input) {
  const query = normalize(input);
  const blocks = [[]];
  const sort = [];
  const errors = [];
  const warnings = [];

  const tokens = tokenize(query);
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];

    if (token === "EQ") continue;

    if (SORT_PREFIXES.some((p) => token.startsWith(p))) {
      if (token === "ORDERBY" || token === "ORDERBYDESC" || token === "GROUPBY") {
        errors.push(`"${token}" is missing a field name.`);
      } else {
        sort.push(token);
      }
      continue;
    }

    if (token.startsWith("NQ")) {
      blocks.push([]);
      token = token.slice(2);
      if (token === "") continue;
    }

    // Related-list conditions span several tokens: RLQUERY...^...^ENDRLQUERY
    if (token.startsWith("RLQUERY")) {
      const parts = [token];
      while (i + 1 < tokens.length && parts[parts.length - 1] !== "ENDRLQUERY") {
        parts.push(tokens[++i]);
      }
      if (parts[parts.length - 1] !== "ENDRLQUERY") {
        errors.push(`"${token}" has no matching ^ENDRLQUERY.`);
      }
      token = parts.join("^");
      if (!warnings.length) {
        warnings.push("Contains related-list conditions (RLQUERY). Double-check the merged result in your instance.");
      }
    } else if (token === "ENDRLQUERY") {
      errors.push("^ENDRLQUERY without a matching RLQUERY.");
      continue;
    }

    const block = blocks[blocks.length - 1];
    const isOr = token.startsWith("OR");
    const condition = isOr ? token.slice(2) : token;

    if (isOr && block.length === 0) {
      errors.push(`"^${token}" has no condition before it to OR with.`);
    } else if (condition === "") {
      errors.push(`Empty condition after "^${token}".`);
    } else if (!/^[A-Za-z0-9_$]/.test(condition)) {
      errors.push(`"${condition}" doesn't look like a condition (expected a field name).`);
    }
    block.push(token);
  }

  return {
    query,
    blocks: blocks.filter((b) => b.length > 0),
    sort,
    errors,
    warnings,
  };
}

function render(blocks, sort) {
  return [blocks.map((b) => b.join("^")).join("^NQ"), ...sort].filter((s) => s !== "").join("^");
}

export function merge(a, b) {
  const left = parse(a);
  const right = parse(b);
  const errors = [
    ...left.errors.map((e) => `Query A: ${e}`),
    ...right.errors.map((e) => `Query B: ${e}`),
  ];
  const notes = [...new Set([...left.warnings, ...right.warnings])];

  if (errors.length) return { result: null, errors, notes, blocks: [] };

  // Keep the first sort clause per field; A wins over B on conflicts.
  const sort = [];
  const seenFields = new Set();
  for (const clause of [...left.sort, ...right.sort]) {
    const field = sortField(clause);
    if (seenFields.has(field)) {
      if (!sort.includes(clause)) notes.push(`Dropped "${clause}": "${field}" is already sorted by an earlier clause.`);
      continue;
    }
    seenFields.add(field);
    sort.push(clause);
  }

  for (const [name, side] of [["A", left], ["B", right]]) {
    if (side.blocks.length === 0) {
      notes.push(`Query ${name} has no conditions, so it matches every record — and so does the merged query.`);
      return { result: render([], sort), errors, notes, blocks: [] };
    }
  }

  const blocks = [];
  const seen = new Set();
  for (const block of [...left.blocks, ...right.blocks]) {
    const key = block.join("^");
    if (seen.has(key)) {
      notes.push(`Removed duplicate block "${key}".`);
      continue;
    }
    seen.add(key);
    blocks.push(block);
  }

  return { result: render(blocks, sort), errors, notes, blocks: blocks.map((b) => b.join("^")) };
}
