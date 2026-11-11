import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, normalize } from "./merge.js";

const result = (a, b) => merge(a, b).result;

test("simple queries become two NQ blocks", () => {
  assert.equal(result("active=true", "priority=1"), "active=true^NQpriority=1");
});

test("AND and OR conditions stay inside their block", () => {
  assert.equal(
    result("active=true^priority=1^ORpriority=2", "state=6^assigned_toISEMPTY"),
    "active=true^priority=1^ORpriority=2^NQstate=6^assigned_toISEMPTY",
  );
});

test("existing NQ blocks are flattened into one top-level OR", () => {
  assert.equal(result("a=1^NQb=2", "c=3^NQd=4"), "a=1^NQb=2^NQc=3^NQd=4");
});

test("sort clauses move to the end, A wins conflicts", () => {
  const out = merge("active=true^ORDERBYnumber", "priority=1^ORDERBYDESCnumber^ORDERBYsys_created_on");
  assert.equal(out.result, "active=true^NQpriority=1^ORDERBYnumber^ORDERBYsys_created_on");
  assert.match(out.notes.join(), /ORDERBYDESCnumber/);
});

test("identical sort clauses are kept once", () => {
  assert.equal(result("a=1^ORDERBYnumber", "b=2^ORDERBYnumber"), "a=1^NQb=2^ORDERBYnumber");
});

test("trailing ^EQ and stray carets are dropped", () => {
  assert.equal(result("^active=true^EQ", "priority=1^"), "active=true^NQpriority=1");
});

test("escaped carets inside values are preserved", () => {
  assert.equal(result("short_descriptionLIKEa^^b", "x=1"), "short_descriptionLIKEa^^b^NQx=1");
});

test("duplicate blocks are removed", () => {
  assert.equal(result("a=1^NQb=2", "b=2"), "a=1^NQb=2");
});

test("javascript values are kept verbatim", () => {
  assert.equal(
    result("assigned_to=javascript:gs.getUserID()", "opened_byDYNAMIC90d1921e5f510100a9ad2572f2b477fe"),
    "assigned_to=javascript:gs.getUserID()^NQopened_byDYNAMIC90d1921e5f510100a9ad2572f2b477fe",
  );
});

test("related-list queries stay intact", () => {
  const rl = "RLQUERYsys_user_grmember.user,>=1^group.name=Service Desk^ENDRLQUERY";
  assert.equal(result(`active=true^${rl}`, "vip=true"), `active=true^${rl}^NQvip=true`);
});

test("an empty query matches everything", () => {
  const out = merge("", "active=true^ORDERBYnumber");
  assert.equal(out.result, "ORDERBYnumber");
  assert.match(out.notes.join(), /matches every record/);
});

test("invalid queries are rejected", () => {
  assert.equal(result("^ORactive=true", "a=1"), null);
  assert.equal(result("a=1", "b=2^OR"), null);
  assert.equal(result("a=1^ORDERBY", "b=2"), null);
  assert.equal(result("RLQUERYx.y,>=1^a=1", "b=2"), null);
  assert.equal(result("a=1", "=oops"), null);
});

test("URL-encoded queries and list URLs are accepted", () => {
  assert.equal(normalize("active%3Dtrue%5Epriority%3D1"), "active=true^priority=1");
  assert.equal(
    normalize("https://x.service-now.com/incident_list.do?sysparm_query=active%3Dtrue%5EORDERBYnumber&sysparm_view="),
    "active=true^ORDERBYnumber",
  );
});
