// packages/node-daemon/src/commands/service.js
//
// Wraps `start` as a native background service so the daemon survives reboots/logouts
// without the operator babysitting a terminal window -- Docker was explicitly ruled out for
// this project (most operators are on Windows, and Docker Desktop is a heavier ask than a
// native service), so this uses each OS's own service manager instead:
//   - Windows: node-windows (installed as a real Windows Service via sc.exe under the hood)
//   - Linux:   node-linux   (installed as a systemd unit)
//   - macOS:   node-mac     (installed as a launchd agent)
// Only node-windows ships as a hard dependency of this package, since that's the platform
// this project is explicitly prioritizing; node-linux/node-mac are loaded dynamically and,
// if missing, this prints the one-line install command rather than failing silently.
//
// The daemon needs the password on every unattended restart to decrypt the stored key -- there's
// no terminal to prompt on a service restart. On Windows this is baked directly into the Windows
// Service's own config (node-windows), which node-windows stores via the OS service manager --
// readable only by Administrators/SYSTEM, the same trust boundary any CI secret store uses. On
// Linux/macOS it is NOT baked into the service definition itself: node-linux renders a systemd
// unit file, and unit files under /etc/systemd/system/ are world-readable by default
// (`systemctl cat` needs no privilege) -- any local user could recover the password that decrypts
// the stored wallet key straight out of the unit file. Instead the password is written to its own
// file (SERVICE_PASSWORD_FILE, mode 0600, same convention as config.js's CONFIG_PATH) and only
// that FILE PATH -- not the secret itself -- goes into the unit via INAYA_DAEMON_PASSWORD_FILE
// (see resolveWallet.js's resolvePassword()). macOS launchd plists don't have systemd's exact
// world-readable-by-default behavior, but there's no reason to trust node-mac's template any more
// than node-linux's, so it gets the same treatment for consistency.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { promptHidden } from "../prompt.js";
import { requireConfig, CONFIG_DIR } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const START_SCRIPT = path.join(__dirname, "..", "..", "bin", "inaya-node-daemon.js");
const SERVICE_NAME = "InayaNodeDaemon";
const SERVICE_PASSWORD_FILE = path.join(CONFIG_DIR, "daemon-password");

function writePasswordFile(password) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SERVICE_PASSWORD_FILE, password, { mode: 0o600 });
  fs.chmodSync(SERVICE_PASSWORD_FILE, 0o600); // writeFileSync's mode is subject to umask; chmod after is the reliable way to actually get 0600
  return SERVICE_PASSWORD_FILE;
}

export async function serviceInstallCommand() {
  requireConfig(); // fail early with a clear message if "login" hasn't run yet

  const password = process.env.INAYA_DAEMON_PASSWORD || (await promptHidden("Daemon password (stored in the service config so it can restart unattended): "));
  if (!password) {
    console.error("A daemon password is required.");
    process.exit(1);
  }

  if (process.platform === "win32") {
    const { default: Service } = await import("node-windows").catch(() => ({ default: null }));
    if (!Service) {
      console.error('node-windows is not installed. Run "npm install node-windows" in this package and try again.');
      process.exit(1);
    }
    const svc = new Service({
      name: SERVICE_NAME,
      description: "Inaya Network node operator daemon -- on-chain registration + heartbeat telemetry only, no shard storage.",
      script: START_SCRIPT,
      scriptOptions: "start",
      env: [{ name: "INAYA_DAEMON_PASSWORD", value: password }],
    });
    svc.on("install", () => {
      console.log(`Service "${SERVICE_NAME}" installed and starting.`);
      svc.start();
    });
    svc.on("alreadyinstalled", () => console.log(`Service "${SERVICE_NAME}" is already installed.`));
    svc.install();
    return;
  }

  if (process.platform === "linux") {
    const mod = await import("node-linux").catch(() => null);
    if (!mod) {
      console.error('node-linux is not installed. Run "npm install node-linux" in this package and try again.');
      process.exit(1);
    }
    const passwordFile = writePasswordFile(password);
    const svc = new mod.Service({
      name: SERVICE_NAME,
      description: "Inaya Network node operator daemon",
      script: START_SCRIPT,
      scriptOptions: "start",
      envVars: [{ name: "INAYA_DAEMON_PASSWORD_FILE", value: passwordFile }],
    });
    svc.on("install", () => {
      console.log(`Service "${SERVICE_NAME}" installed and starting. Daemon password stored at ${passwordFile} (mode 0600), referenced by path only -- not baked into the systemd unit itself.`);
      svc.start();
    });
    svc.install();
    return;
  }

  if (process.platform === "darwin") {
    const mod = await import("node-mac").catch(() => null);
    if (!mod) {
      console.error('node-mac is not installed. Run "npm install node-mac" in this package and try again.');
      process.exit(1);
    }
    const passwordFile = writePasswordFile(password);
    const svc = new mod.Service({
      name: SERVICE_NAME,
      description: "Inaya Network node operator daemon",
      script: START_SCRIPT,
      scriptOptions: "start",
      env: [{ name: "INAYA_DAEMON_PASSWORD_FILE", value: passwordFile }],
    });
    svc.on("install", () => {
      console.log(`Service "${SERVICE_NAME}" installed and starting. Daemon password stored at ${passwordFile} (mode 0600), referenced by path only.`);
      svc.start();
    });
    svc.install();
    return;
  }

  console.error(`Unsupported platform: ${process.platform}. Run "inaya-node-daemon start" in the foreground instead.`);
  process.exit(1);
}

export async function serviceUninstallCommand() {
  if (process.platform === "win32") {
    const { default: Service } = await import("node-windows").catch(() => ({ default: null }));
    if (!Service) {
      console.error("node-windows is not installed.");
      process.exit(1);
    }
    const svc = new Service({ name: SERVICE_NAME, script: START_SCRIPT });
    svc.on("uninstall", () => console.log(`Service "${SERVICE_NAME}" uninstalled.`));
    svc.uninstall();
    return;
  }

  if (process.platform === "linux") {
    const mod = await import("node-linux").catch(() => null);
    if (!mod) {
      console.error("node-linux is not installed.");
      process.exit(1);
    }
    const svc = new mod.Service({ name: SERVICE_NAME, script: START_SCRIPT });
    svc.on("uninstall", () => {
      fs.rmSync(SERVICE_PASSWORD_FILE, { force: true });
      console.log(`Service "${SERVICE_NAME}" uninstalled.`);
    });
    svc.uninstall();
    return;
  }

  if (process.platform === "darwin") {
    const mod = await import("node-mac").catch(() => null);
    if (!mod) {
      console.error("node-mac is not installed.");
      process.exit(1);
    }
    const svc = new mod.Service({ name: SERVICE_NAME, script: START_SCRIPT });
    svc.on("uninstall", () => {
      fs.rmSync(SERVICE_PASSWORD_FILE, { force: true });
      console.log(`Service "${SERVICE_NAME}" uninstalled.`);
    });
    svc.uninstall();
    return;
  }

  console.error(`Unsupported platform: ${process.platform}.`);
  process.exit(1);
}
