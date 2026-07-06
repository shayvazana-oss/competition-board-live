const fs = require("fs");
const CLOSE = "</scr" + "ipt>";
const OPEN = "<scr" + "ipt>";
const BS = String.fromCharCode(92); // backslash
const ESC_LT = BS + "u003c";        // the 6-char sequence for an escaped <

const html = fs.readFileSync("index.html", "utf8");
const startTag = '<script type="__bundler/template">';
const si = html.indexOf(startTag);
if (si < 0) { console.error("no template start tag"); process.exit(1); }
const contentStart = si + startTag.length;
const ei = html.indexOf(CLOSE, contentStart);
const rawJson = html.slice(contentStart, ei);
let tpl = JSON.parse(rawJson);

// idempotent: strip any previous injection
tpl = tpl.replace(/<!-- LIVEBOARD_START -->[\s\S]*?<!-- LIVEBOARD_END -->\s*/g, "");

const mod = fs.readFileSync("_live_board.js", "utf8");
const block = "<!-- LIVEBOARD_START -->\n" + OPEN + "\n" + mod + "\n" + CLOSE + "\n<!-- LIVEBOARD_END -->\n";

// Inject as a direct <body> sibling BEFORE <x-dc> (scripts inside <x-dc> are
// treated as template text by the framework runtime and never execute).
const marker = "<x-dc>";
const mi = tpl.indexOf(marker);
if (mi < 0) { console.error("no <x-dc> marker"); process.exit(1); }
tpl = tpl.slice(0, mi) + block + tpl.slice(mi);

// re-encode exactly like the original bundler: JSON, then escape every '<' as an escaped unicode
const out = JSON.stringify(tpl).split("<").join(ESC_LT);

// verify
if (JSON.parse(out) !== tpl) { console.error("ROUND TRIP FAILED"); process.exit(1); }
if (out.indexOf(CLOSE) >= 0) { console.error("literal close tag leaked!"); process.exit(1); }
if (out.indexOf("<") >= 0) { console.error("literal < leaked!"); process.exit(1); }

const newHtml = html.slice(0, contentStart) + out + html.slice(ei);
fs.writeFileSync("index.html", newHtml, "utf8");
console.log("OK injected. template chars:", tpl.length, "json chars:", out.length);
