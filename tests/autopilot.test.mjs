// Scene Radar autopilot checks (functions/api/autopilot-core.js) · node tests/autopilot.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const A = await import(new URL("../functions/api/autopilot-core.js", import.meta.url));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok", name); };

const SOURCE = {
  title: "Knocked Loose announce new album 'Hollow Signal' and North American tour",
  summary: "Kentucky hardcore band Knocked Loose will release Hollow Signal on March 6, 2027 via Pure Noise Records.",
  text: `Knocked Loose have announced their new album Hollow Signal, out March 6, 2027 via Pure Noise Records.
The Kentucky band also shared the first single "Static Prayer" and its music video.
Vocalist Bryan Garris said: "This record is the heaviest thing we have ever made, and we needed it."
The band will tour North America in April with support from Show Me The Body and Kublai Khan TX.
The tour starts on April 2 in Louisville and ends on April 28 in Seattle.`,
  source: "ThePRP"
};
const GOOD = {
  band: "Knocked Loose", release: "Hollow Signal", genre: "Metallic Hardcore",
  title: "Knocked Loose announce Hollow Signal and a North American tour",
  excerpt: "The Kentucky band's new album arrives in 2027, with a spring tour across North America.",
  content: `Kentucky's Knocked Loose have a new album on the way. As ThePRP reported, Hollow Signal arrives on March 6, 2027 through Pure Noise Records.

## A first taste

Alongside the announcement, the band shared "Static Prayer", the opening single, together with a music video. Singer Bryan Garris called it "the heaviest thing we have ever made" in a statement.

## On the road

The group will spend April on a North American run, joined by Show Me The Body and Kublai Khan TX. The dates begin on April 2 in Louisville and wrap up on April 28 in Seattle, giving fans plenty of chances to hear the new songs live before and after the release. For a band that built its name on the stage, the tour is as much a part of this new chapter as the record itself, and the support line-up keeps the bill heavy from start to finish.`
};

ok("a correct article passes the gate", () => {
  const g = A.factGate(GOOD, SOURCE, { minWords: 100 });
  assert.equal(g.ok, true, g.problems.join(" | "));
});
ok("an invented band member is caught", () => {
  const bad = { ...GOOD, content: GOOD.content.replace("Singer Bryan Garris", "Guitarist Isaac Hale") };
  const g = A.factGate(bad, SOURCE, { minWords: 100, nameTolerance: 0 });
  assert.equal(g.ok, false); assert.match(g.problems.join(" "), /Isaac|Hale/);
});
ok("an invented record label and city are caught", () => {
  const bad = { ...GOOD, content: GOOD.content.replace("Pure Noise Records", "Epitaph Records").replace("in Seattle", "in Portland") };
  const g = A.factGate(bad, SOURCE, { minWords: 100 });
  assert.equal(g.ok, false); assert.match(g.problems.join(" "), /Epitaph|Portland/);
});
ok("a wrong year or date is caught", () => {
  const g = A.factGate({ ...GOOD, content: GOOD.content.replace("2027", "2026") }, SOURCE, { minWords: 100 });
  assert.equal(g.ok, false); assert.match(g.problems.join(" "), /2026/);
  const g2 = A.factGate({ ...GOOD, content: GOOD.content.replace("April 28", "April 30") }, SOURCE, { minWords: 100 });
  assert.equal(g2.ok, false); assert.match(g2.problems.join(" "), /30/);
});
ok("an invented quote is caught", () => {
  const g = A.factGate({ ...GOOD, content: GOOD.content.replace("the heaviest thing we have ever made", "our angriest record by far, no question") }, SOURCE, { minWords: 100 });
  assert.equal(g.ok, false); assert.match(g.problems.join(" "), /quote/);
});
ok("a wrong band or release name is caught", () => {
  assert.equal(A.factGate({ ...GOOD, band: "Knocked Lose" }, SOURCE, { minWords: 100 }).ok, false);
  assert.equal(A.factGate({ ...GOOD, release: "Hollow Signals Deluxe" }, SOURCE, { minWords: 100 }).ok, false);
});
ok("copying the source is caught", () => {
  const copy = { ...GOOD, content: GOOD.content + "\n\nThe tour starts on April 2 in Louisville and ends on April 28 in Seattle with support from Show Me The Body and Kublai Khan TX and more." };
  assert.ok(A.longestCopiedRun("the tour starts on april 2 in louisville and ends on april 28 in seattle", SOURCE.text) >= 14);
  const g = A.factGate({ ...copy, content: copy.content.replace(GOOD.content, "") + "\n\n" + GOOD.content }, { ...SOURCE, text: SOURCE.text + " The tour starts on April 2 in Louisville and ends on April 28 in Seattle with support from Show Me The Body and Kublai Khan TX and more." }, { minWords: 100 });
  assert.equal(g.ok, false); assert.match(g.problems.join(" "), /copied/);
  assert.match(g.problems.join(" "), /"the tour starts on april 2 in louisville/); // the writer is shown the passage
});
ok("too short and AI talk are caught", () => {
  assert.equal(A.factGate({ ...GOOD, content: "Knocked Loose have news." }, SOURCE).ok, false);
  assert.equal(A.factGate({ ...GOOD, content: GOOD.content + "\nThe source does not say more." }, SOURCE, { minWords: 100 }).ok, false);
});
ok("checker verdicts are parsed strictly", () => {
  assert.deepEqual(A.parseVerdict('{"verdict":"pass","problems":[]}'), { pass: true, problems: [] });
  assert.equal(A.parseVerdict('Sure! ```json\n{"verdict":"fail","problems":["Epitaph is not in the source"]}\n```').pass, false);
  assert.equal(A.parseVerdict("Looks good to me").pass, false);
  assert.equal(A.parseVerdict('{"verdict":"pass","problems":["date wrong"]}').pass, false);
  assert.equal(A.parseVerdict('{"verdict":"fail"}').problems.length, 1);
  // production case: the checker listed facts the article left out; leaving facts out is allowed
  const om = A.parseVerdict('{"verdict":"fail","problems":["The band is from San Diego, California — The ARTICLE does not mention this fact.","The band has released three full-length albums — The ARTICLE does not mention this fact."]}');
  assert.equal(om.pass, true);
  const mixed = A.parseVerdict('{"verdict":"fail","problems":["The article does not mention the label.","The release date 2026 is wrong; the source says 2027"]}');
  assert.equal(mixed.pass, false); assert.equal(mixed.problems.length, 1);
});
ok("writer and checker come from different companies", () => {
  const r = A.pickRoles(["gemini", "workersai", "groq", "claude"]);
  assert.deepEqual(r.writers, ["gemini", "groq", "claude", "workersai"]);
  assert.deepEqual(r.checkersFor("gemini"), ["workersai", "groq", "claude"]);
  assert.deepEqual(r.checkersFor("groq"), ["claude", "gemini"]);
  assert.deepEqual(A.pickRoles(["groq", "workersai"]).checkersFor("groq"), []);
  // Today's situation: Gemini over quota, Claude without credit -> Llama writes, Mistral/Qwen on Cloudflare check
  const cf = A.pickRoles(["gemini", "workersai", "groq", "claude", "cfmistral", "cfqwen", "cfgemma"]);
  assert.deepEqual(cf.checkersFor("workersai"), ["cfmistral", "cfqwen", "claude", "cfgemma", "gemini"]);
  for (const w of cf.writers) for (const c of cf.checkersFor(w)) assert.notEqual(A.COMPANY[w], A.COMPANY[c]);
});
ok("source text extraction keeps paragraphs and drops boilerplate", () => {
  const html = `<html><head><script>var x=1</script></head><body><nav><p>Home News Reviews</p></nav>
    <article><h1>T</h1><p>Knocked Loose have announced their new album Hollow Signal, out March 6, 2027.</p>
    <p>Subscribe to our newsletter!</p><p>The Kentucky band also shared &ldquo;Static Prayer&rdquo; &amp; a video.</p>
    ${"<p>filler paragraph that is long enough to count for the article body text here.</p>".repeat(12)}</article>
    <footer><p>© 2026 Site. All rights reserved.</p></footer></body></html>`;
  const t = A.extractText(html);
  assert.match(t, /Hollow Signal/); assert.match(t, /“Static Prayer” & a video/);
  assert.doesNotMatch(t, /Subscribe|Home News|rights reserved|var x/);
});
ok("YouTube video must name the band (and release)", () => {
  assert.equal(A.youtubeMatches("Knocked Loose - Static Prayer (Official Video)", "Knocked Loose", ""), true);
  assert.equal(A.youtubeMatches("Knocked Loose - Hollow Signal (Full Album)", "Knocked Loose", "Hollow Signal"), true);
  assert.equal(A.youtubeMatches("Some Other Band - Live", "Knocked Loose", ""), false);
  assert.equal(A.youtubeMatches("Knocked Loose live 2019", "Knocked Loose", "Hollow Signal"), false);
});
ok("daily limit counts from midnight in Jayapura", () => {
  assert.equal(A.startOfDayWIT(new Date("2026-11-19T00:30:00Z")), "2026-11-18T15:00:00.000Z");
  assert.equal(A.startOfDayWIT(new Date("2026-11-18T14:59:00Z")), "2026-11-17T15:00:00.000Z");
});
ok("prompts forbid outside knowledge and carry the source", () => {
  const p = A.writerPrompt({ ...SOURCE }, SOURCE.text, "Metalcore: Metalcore");
  assert.match(p, /ONLY facts that are written in the SOURCE/); assert.match(p, /Do not use your own knowledge/); assert.match(p, /Pure Noise Records/);
  const c = A.checkerPrompt(SOURCE, SOURCE.text, GOOD);
  assert.match(c, /never against your own knowledge/); assert.match(c, /Hollow Signal/);
  const rv = A.reviserPrompt(SOURCE, SOURCE.text, "x", GOOD, ["Epitaph is wrong"]);
  assert.match(rv, /1\. Epitaph is wrong/);
});
ok("the bot can only unpublish autopilot articles", () => {
  const w = readFileSync(new URL("../functions/api/telegram/webhook.js", import.meta.url), "utf8");
  const u = w.slice(w.indexOf('if (act === "u")'), w.indexOf('if (act === "x")'));
  assert.match(u, /item->auto->>result=eq\.published/);
  assert.match(u, /status: "draft"/);
  assert.doesNotMatch(u, /DELETE/);
});
ok("autopilot respects the switch, the token and the daily limit", () => {
  const s = readFileSync(new URL("../functions/api/telegram/autopilot.js", import.meta.url), "utf8");
  assert.match(s, /AUTOPILOT \|\| "on"\)\.toLowerCase\(\) === "off"/);
  assert.match(s, /same\(auth, env\.AUTODRAFT_TOKEN\)/);
  assert.match(s, /publishedToday >= daily/);
  assert.match(s, /AUTOPILOT_DAILY \|\| 5/);
});
console.log(`\n${n} autopilot tests passed`);
