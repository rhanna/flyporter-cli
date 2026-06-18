import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { SessionExpiredError } from "./errors.js";

export function getDefaultSessionPath({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (env.FLYPORTER_SESSION_FILE) return path.resolve(env.FLYPORTER_SESSION_FILE);
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "flyporter", "session.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "flyporter", "session.json");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "flyporter", "session.json");
}

export async function saveSession(session, sessionPath = getDefaultSessionPath()) {
  await fs.mkdir(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(sessionPath, 0o600);
  return sessionPath;
}

export async function loadSession(sessionPath = getDefaultSessionPath()) {
  let content;
  try {
    content = await fs.readFile(sessionPath, "utf8");
  } catch (cause) {
    if (cause.code === "ENOENT") {
      throw new SessionExpiredError("No saved authentication session was found. Run `flyporter auth`.");
    }
    throw cause;
  }

  try {
    const session = JSON.parse(content);
    if (session.version !== 1 || !session.cookieJar) throw new Error("Unsupported session format");
    return session;
  } catch (cause) {
    throw new SessionExpiredError("The saved authentication session is invalid. Run `flyporter auth` again.", {
      cause,
    });
  }
}
