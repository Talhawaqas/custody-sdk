#!/usr/bin/env node
// packages/create-inaya-dapp/bin/create-inaya-dapp.js
//
// Same idea as create-next-app: copy a pre-wired template directory to a
// new project folder, substitute the project name, print next steps.
// Deliberately dependency-free (fs.cpSync/readdirSync/writeFileSync only)
// so this stays a fast, frictionless `npx create-inaya-dapp` with nothing
// extra to download first.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

const AVAILABLE_TEMPLATES = fs.readdirSync(TEMPLATES_DIR).filter((name) => fs.statSync(path.join(TEMPLATES_DIR, name)).isDirectory());

function printUsageAndExit() {
  console.error("Usage: create-inaya-dapp <project-name> [--template <name>]");
  console.error(`Available templates: ${AVAILABLE_TEMPLATES.join(", ")}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const projectName = args.find((a) => !a.startsWith("--"));
const templateFlagIndex = args.indexOf("--template");
const templateName = templateFlagIndex >= 0 ? args[templateFlagIndex + 1] : "vault";

if (!projectName) printUsageAndExit();
if (!AVAILABLE_TEMPLATES.includes(templateName)) {
  console.error(`Unknown template "${templateName}".`);
  printUsageAndExit();
}

const targetDir = path.resolve(process.cwd(), projectName);
if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
  console.error(`"${projectName}" already exists and isn't empty.`);
  process.exit(1);
}

const sourceDir = path.join(TEMPLATES_DIR, templateName);
fs.cpSync(sourceDir, targetDir, { recursive: true });

// Fill in the project name in package.json -- the only substitution this
// template set actually needs today.
const pkgPath = path.join(targetDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
pkg.name = projectName;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// .env.example -> .env.local, same convention Next.js itself expects.
const envExamplePath = path.join(targetDir, ".env.example");
if (fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, path.join(targetDir, ".env.local"));
}

console.log(`Created ${projectName} from the "${templateName}" template.\n`);
console.log("Next steps:");
console.log(`  cd ${projectName}`);
console.log("  npm install");
if (fs.existsSync(envExamplePath)) {
  console.log("  # fill in .env.local -- see that file's comments for what each template actually needs");
}
console.log("  npm run dev");
