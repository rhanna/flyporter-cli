import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultSessionPath, loadSession, saveSession } from "../src/session.js";

test("uses the macOS user application support directory", () => {
  assert.equal(
    getDefaultSessionPath({ platform: "darwin", env: {}, home: "/Users/test" }),
    "/Users/test/Library/Application Support/flyporter/session.json",
  );
});

test("round-trips session data with owner-only permissions", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "flyporter-session-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sessionPath = path.join(directory, "session.json");
  const session = { version: 1, cookieJar: { cookies: [] } };

  await saveSession(session, sessionPath);
  assert.deepEqual(await loadSession(sessionPath), session);
  if (process.platform !== "win32") {
    const stat = await fs.stat(sessionPath);
    assert.equal(stat.mode & 0o777, 0o600);
  }
});
