// Build & harden the extension.
// - Rewrites API_BASE
// - Runs javascript-obfuscator on background.js + popup.js
// - Computes SHA-256 of the obfuscated background.js and injects it back as
//   the __INTEGRITY_BG__ constant (self-integrity check on load).
// - Zips the result to public/AI-Infinity-Hardened.zip
//
// Usage:  API_BASE=https://your-project.lovable.app node scripts/build-extension.mjs

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "extension/src");
const OUT = join(ROOT, "extension/dist");
const ZIP = join(ROOT, "public/AI-Infinity-Hardened.zip");

const API_BASE = process.env.API_BASE ?? "https://id-preview--e1e099e5-ccdc-41ee-a7f2-492f7a2f6638.lovable.app";
console.log("→ API_BASE =", API_BASE);

// Clean
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

// Rewrite API base + inject integrity placeholder
const bgPath = join(OUT, "background.js");
let bg = readFileSync(bgPath, "utf8").replace(/__API_BASE__/g, API_BASE);
writeFileSync(bgPath, bg);

// Obfuscate (if available)
let JsObf = null;
try { JsObf = (await import("javascript-obfuscator")).default; } catch { console.warn("javascript-obfuscator not installed — skipping obfuscation. Run: bun add -d javascript-obfuscator"); }

if (JsObf) {
  const opts = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: true,
    debugProtectionInterval: 4000,
    disableConsoleOutput: false,
    identifierNamesGenerator: "hexadecimal",
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 6,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.9,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    target: "browser",
  };
  for (const f of ["background.js", "popup.js"]) {
    const p = join(OUT, f);
    const code = readFileSync(p, "utf8");
    const obf = JsObf.obfuscate(code, opts).getObfuscatedCode();
    writeFileSync(p, obf);
    console.log(`✓ obfuscated ${f}`);
  }
}

// Compute integrity hash of the final background.js and inject
const finalBg = readFileSync(bgPath, "utf8");
const integrity = createHash("sha256").update(finalBg).digest("hex");
const withIntegrity = finalBg.replace(/__INTEGRITY_BG__/g, integrity);
writeFileSync(bgPath, withIntegrity);
console.log("✓ integrity hash injected:", integrity.slice(0, 16), "…");

// Icon fallback
const iconPath = join(OUT, "icon.png");
if (!existsSync(iconPath)) {
  // 1x1 transparent PNG placeholder
  const px = Buffer.from(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082",
    "hex",
  );
  writeFileSync(iconPath, px);
}

// Zip
mkdirSync(dirname(ZIP), { recursive: true });
if (existsSync(ZIP)) rmSync(ZIP);
const r = spawnSync("zip", ["-r", ZIP, "."], { cwd: OUT, stdio: "inherit" });
if (r.status !== 0) {
  console.error("zip failed. Install: nix run nixpkgs#zip -- -r ...");
  process.exit(1);
}
console.log("✓ wrote", ZIP);
