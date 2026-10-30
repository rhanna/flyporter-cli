import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReporter } from "../src/diagnostics.js";

test("disabled diagnostics perform no browser, stderr or filesystem work, even on failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "porter-debug-off-"));
  try {
    for (const debug of [undefined, false]) {
      const report = await createReporter(
        { artifactsDir: root, debug },
        () => {
          throw new Error("Browser must not be accessed");
        },
        {
          write: () => {
            throw new Error("stderr must not be written");
          },
        },
      );
      await report.event("failed", { error: "secret" });
      await report.capture("99-failure");
      assert.equal(report.directory, null);
    }
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enabled diagnostics mask before screenshots, restore afterward and redact metadata/events", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "porter-debug-on-"));
  const calls = [];
  let stderr = "";
  try {
    const report = await createReporter(
      { debug: true, artifactsDir: root, password: "private-password" },
      () => ({
        evaluate: async (expression) => {
          if (expression.includes("return 'masked'")) {
            calls.push("mask");
            return "masked";
          }
          if (expression.includes("JSON.stringify")) {
            calls.push("metadata");
            return JSON.stringify({ text: "private-password" });
          }
          calls.push("restore");
        },
        screenshot: async () => {
          calls.push("screenshot");
          return Buffer.from("image");
        },
      }),
      {
        write: (line) => {
          stderr += line;
        },
      },
    );
    await report.event("test", { error: "private-password" });
    await report.capture("99-failure");
    assert.deepEqual(calls, ["mask", "screenshot", "restore", "metadata"]);
    assert.deepEqual((await readdir(report.directory)).sort(), [
      "99-failure.json",
      "99-failure.png",
      "events.jsonl",
    ]);
    const events = await readFile(
      path.join(report.directory, "events.jsonl"),
      "utf8",
    );
    const metadata = await readFile(
      path.join(report.directory, "99-failure.json"),
      "utf8",
    );
    assert.ok(!`${events}${metadata}${stderr}`.includes("private-password"));
    assert.equal(
      typeof JSON.parse(events.trim().split("\n").at(-1)).screenshotMs,
      "number",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
