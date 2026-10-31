// Run: node tests/tools.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dir = path.join(__dirname, "..", "..", "frontend");
const ctx = { console: { log() {}, warn() {}, error() {} }, fetch: null };
vm.createContext(ctx);
// `class` declarations are not context properties, so expose them after loading.
const src = ["geminilive.js", "tools.js"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
vm.runInContext(src + "\nthis.T = { LookupKnowledgeTool, ShowPromptsTool };", ctx);
const { LookupKnowledgeTool, ShowPromptsTool } = ctx.T;

const long = "detail ".repeat(400);
const six = Array.from({ length: 6 }, (_, i) => ({ title: `Step ${i + 1}`, prompt: long }));

(async () => {
  let got;
  const show = new ShowPromptsTool((tool, steps, meta) => (got = { tool, steps, meta }));
  assert.ok(show.functionToCall({ ai_tool: "Cursor", steps: six }).startsWith("shown"));
  assert.strictEqual(got.steps.length, 6);
  // compared as JSON: the object comes from a vm context, so deepStrictEqual would see a different prototype
  assert.strictEqual(JSON.stringify(got.meta), JSON.stringify({ title: "", summary: "", wantsCode: false }));
  // title/summary are trimmed and capped; wants_code must be exactly true
  show.functionToCall({ ai_tool: "Cursor", title: "  " + "T".repeat(80) + " ", summary: " S ", wants_code: true, steps: six });
  assert.strictEqual(got.meta.title.length, 60);
  assert.strictEqual(got.meta.summary, "S");
  assert.strictEqual(got.meta.wantsCode, true);
  assert.ok(show.functionToCall({ wants_code: true, steps: six }).includes("Code page"));
  show.functionToCall({ wants_code: "yes", steps: six });
  assert.strictEqual(got.meta.wantsCode, false);
  got = null;
  for (const bad of [{}, { steps: six.slice(0, 5) }, { steps: [...six.slice(0, 5), { title: "x", prompt: " " }] }]) {
    assert.ok(show.functionToCall(bad).startsWith("error"));
  }
  const short = six.map((s, i) => (i === 2 ? { ...s, prompt: "too short" } : s));
  assert.ok(show.functionToCall({ steps: short }).includes("detailed"));
  assert.strictEqual(got, null, "callback must not run on invalid input");

  const k = new LookupKnowledgeTool();
  ctx.fetch = async () => ({ json: async () => ({ results: [{ source: "AI tools", text: "Cursor is..." }] }) });
  assert.ok((await k.functionToCall({ query: "cursor" })).includes("[AI tools] Cursor is"));
  ctx.fetch = async () => ({ json: async () => ({ results: [] }) });
  assert.ok((await k.functionToCall({ query: "zzz" })).startsWith("no results"));
  ctx.fetch = async () => { throw new Error("down"); };
  assert.ok((await k.functionToCall({ query: "x" })).startsWith("error"));
  assert.ok((await k.functionToCall({ query: " " })).startsWith("error"));
  console.log("tools tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
