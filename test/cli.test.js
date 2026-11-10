import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createProgram } from "../src/cli.js";
// The CLI imports dotenv. Keep default-backend tests independent of the developer's .env.
const inheritedBackend = process.env.FLYPORTER_BROWSER;
const inheritedAirlines = process.env.FLYPORTER_AIRLINES;
delete process.env.FLYPORTER_BROWSER;
delete process.env.FLYPORTER_AIRLINES;
after(() => {
  if (inheritedBackend === undefined) delete process.env.FLYPORTER_BROWSER;
  else process.env.FLYPORTER_BROWSER = inheritedBackend;
  if (inheritedAirlines === undefined) delete process.env.FLYPORTER_AIRLINES;
  else process.env.FLYPORTER_AIRLINES = inheritedAirlines;
});
function fixture(overrides = {}) {
  let out = "",
    err = "";
  const calls = [];
  const config = { token: "token", username: "user", password: "password" };
  const browser = { config };
  const deps = {
    loadBapConfig: () => config,
    loadRemoteChromiumConfig: () => config,
    residentSearch: async () => null,
    openBrowser: async (backend, purpose) => {
      calls.push([backend, purpose]);
      return {
        browser,
        finish: async (success) => calls.push(["finish", success]),
      };
    },
    authenticateBrowser: async () => calls.push(["auth"]),
    searchPorter: async () => ({
      query: { origin: "YTZ", destination: "YUL", date: "2026-11-05" },
      flights: [],
    }),
    ...overrides,
  };
  const io = {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  };
  return {
    program: createProgram(io, deps),
    calls,
    output: () => out,
    error: () => err,
  };
}
test("default BAP search preserves pure JSON stdout and closes successfully", async () => {
  const f = fixture();
  await f.program.parseAsync([
    "node",
    "flyporter",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(f.output()).flights, []);
  assert.deepEqual(f.calls, [["bap", "search"], ["auth"], ["finish", true]]);
});

test("remote Chromium search works independently and reuses optional resident IPC", async () => {
  const f = fixture();
  await f.program.parseAsync([
    "node",
    "flyporter",
    "--browser",
    "remote-chromium",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(f.output()).flights, []);
  assert.deepEqual(f.calls, [
    ["remote-chromium", "search"],
    ["auth"],
    ["finish", true],
  ]);
  const g = fixture({ residentSearch: async () => ({ flights: [] }) });
  await g.program.parseAsync([
    "node",
    "flyporter",
    "--browser",
    "remote-chromium",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(g.output()).flights, []);
  assert.deepEqual(g.calls, []);
});

test("remote Chromium auth is one-shot; keep-alive rejects unsafe intervals", async () => {
  const f = fixture({
    startResident: async () => assert.fail("auth must exit"),
  });
  await f.program.parseAsync([
    "node",
    "flyporter",
    "--browser",
    "remote-chromium",
    "auth",
  ]);
  assert.deepEqual(f.calls, [
    ["remote-chromium", "auth"],
    ["auth"],
    ["finish", true],
  ]);
  const g = fixture();
  await assert.rejects(
    g.program.parseAsync([
      "node",
      "flyporter",
      "--browser",
      "remote-chromium",
      "session",
      "keep-alive",
      "--interval",
      "120",
    ]),
    /< 120/,
  );
  assert.deepEqual(g.calls, []);
});

test("remote Chromium duration expiry interrupts pending authentication and closes without starting a resident", async () => {
  let rejectLogin,
    closed = false,
    finished = false;
  const pendingLogin = new Promise((_resolve, reject) => {
    rejectLogin = reject;
  });
  const f = fixture({
    openBrowser: async () => ({
      browser: {
        close: async () => {
          closed = true;
          rejectLogin(new Error("closed"));
        },
      },
      finish: async (success, options) => {
        finished = true;
        assert.equal(success, false);
        assert.equal(options.retain, false);
      },
    }),
    authenticateBrowser: () => pendingLogin,
    startResident: async () =>
      assert.fail("Must not start resident after interrupted auth"),
  });
  await f.program.parseAsync([
    "node",
    "flyporter",
    "--browser",
    "remote-chromium",
    "session",
    "keep-alive",
    "--duration",
    "0.02",
  ]);
  assert.equal(closed, true);
  assert.equal(finished, true);
});
test("explicit local selection preserves attachment and skips automated auth", async () => {
  const f = fixture();
  await f.program.parseAsync([
    "node",
    "flyporter",
    "--browser",
    "local",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
  ]);
  assert.deepEqual(f.calls, [
    ["local", "search"],
    ["finish", true],
  ]);
});
test("BAP auth is one-shot and resident search does not open another session", async () => {
  const f = fixture();
  await f.program.parseAsync(["node", "flyporter", "auth"]);
  assert.deepEqual(f.calls, [["bap", "auth"], ["auth"], ["finish", true]]);
  const g = fixture({ residentSearch: async () => ({ flights: [] }) });
  await g.program.parseAsync([
    "node",
    "flyporter",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
    "--json",
  ]);
  assert.deepEqual(g.calls, []);
});
test("invalid intervals and durations fail before connecting", async () => {
  for (const args of [
    ["--interval", "120"],
    ["--duration", "-1"],
  ]) {
    const f = fixture();
    await assert.rejects(
      f.program.parseAsync([
        "node",
        "flyporter",
        "session",
        "keep-alive",
        ...args,
      ]),
    );
    assert.deepEqual(f.calls, []);
  }
});
test("failed search closes without retaining the session", async () => {
  const f = fixture({
    searchPorter: async () => {
      throw new Error("failed");
    },
  });
  await assert.rejects(
    f.program.parseAsync([
      "node",
      "flyporter",
      "search",
      "porter",
      "YTZ",
      "YUL",
      "2026-11-05",
    ]),
  );
  assert.deepEqual(f.calls.at(-1), ["finish", false]);
});

test("foreground BAP keep-alive honors duration, reports billing and closes without retention", async () => {
  let stopped = false,
    closed = false;
  const calls = [];
  const f = fixture({
    openBrowser: async () => ({
      browser: {
        config: {},
        keepAlive: async () => ({
          url: "https://www.flyporter.com/en-ca/staff",
          status: 200,
        }),
        close: async () => {
          closed = true;
        },
      },
      finish: async (success, options) => calls.push({ success, ...options }),
    }),
    startResident: async () => ({
      heartbeat: async () => ({
        url: "https://www.flyporter.com/en-ca/staff",
        status: 200,
      }),
      stop: async () => {
        stopped = true;
      },
    }),
  });
  await f.program.parseAsync([
    "node",
    "flyporter",
    "session",
    "keep-alive",
    "--duration",
    "0.02",
  ]);
  assert.equal(stopped, true);
  assert.equal(closed, true);
  assert.equal(calls[0].retain, false);
  assert.match(f.error(), /paid remote browser/);
});

test("remote authentication failure prevents search and resident failures are never replayed", async () => {
  for (const resident of [false, true]) {
    let submissions = 0;
    const f = fixture({
      residentSearch: async () => {
        if (resident) throw new Error("resident failed");
        return null;
      },
      authenticateBrowser: async () => {
        throw new Error("login rejected");
      },
      searchPorter: async () => {
        submissions++;
      },
    });
    await assert.rejects(
      f.program.parseAsync([
        "node",
        "flyporter",
        "--browser",
        "remote-chromium",
        "search",
        "porter",
        "YTZ",
        "YUL",
        "2026-11-05",
        "--json",
      ]),
      resident ? /resident failed/ : /login rejected/,
    );
    assert.equal(submissions, 0);
    assert.equal(f.output(), "");
    assert.deepEqual(
      f.calls,
      resident
        ? []
        : [
            ["remote-chromium", "search"],
            ["finish", false],
          ],
    );
  }
});

test("other-airline CLI validates before connecting and passes provider, details and normalized order", async () => {
  const received = [];
  const f = fixture({
    residentSearch: async (_config, query, provider) => {
      received.push({ query, provider });
      return null;
    },
    searchOtherAirline: async (_browser, query) => ({
      query,
      complete: true,
      searches: [],
      flights: [],
    }),
  });
  await f.program.parseAsync([
    "node",
    "flyporter",
    "search",
    "other-airline",
    "yyz",
    "yvr",
    "2026-11-12",
    "--airline",
    "ts,WS,ts",
    "--details",
    "--json",
  ]);
  assert.equal(received[0].provider, "other-airline");
  assert.deepEqual(received[0].query.airlines, ["TS", "WS"]);
  assert.equal(JSON.parse(f.output()).query.details, true);
  for (const airline of [undefined, "", "ALL", "WS,"]) {
    const g = fixture();
    await assert.rejects(
      g.program.parseAsync([
        "node",
        "flyporter",
        "search",
        "other-airline",
        "YYZ",
        "YVR",
        "2026-11-12",
        ...(airline === undefined ? [] : ["--airline", airline]),
      ]),
    );
    assert.deepEqual(g.calls, []);
  }
});

const otherAirlineArgs = [
  "node",
  "flyporter",
  "search",
  "other-airline",
  "YYZ",
  "YVR",
  "2026-11-12",
  "--json",
];

function setAirlines(t, value) {
  const previous = process.env.FLYPORTER_AIRLINES;
  t.after(() => {
    if (previous === undefined) delete process.env.FLYPORTER_AIRLINES;
    else process.env.FLYPORTER_AIRLINES = previous;
  });
  if (value === undefined) delete process.env.FLYPORTER_AIRLINES;
  else process.env.FLYPORTER_AIRLINES = value;
}

test("favourites and explicit replacements reach standalone and resident searches consistently", async (t) => {
  setAirlines(t, " ua,AA,ua,dl,2l ");
  for (const backend of ["bap", "remote-chromium", "local"]) {
    for (const resident of backend === "local" ? [false] : [false, true]) {
      for (const override of [undefined, " ts,WS,ts "]) {
        const queries = [];
        const result = (query) => ({
          query,
          complete: true,
          searches: [],
          flights: [],
        });
        const f = fixture({
          residentSearch: async (_config, query, provider) => {
            assert.equal(provider, "other-airline");
            queries.push(query);
            return resident ? result(query) : null;
          },
          searchOtherAirline: async (_browser, query) => {
            queries.push(query);
            return result(query);
          },
        });
        await f.program.parseAsync([
          ...otherAirlineArgs.slice(0, 2),
          "--browser",
          backend,
          ...otherAirlineArgs.slice(2),
          ...(override === undefined ? [] : ["--airline", override]),
        ]);
        const expected =
          override === undefined ? ["UA", "AA", "DL", "2L"] : ["TS", "WS"];
        for (const query of queries) assert.deepEqual(query.airlines, expected);
        assert.equal(queries.length, backend === "local" || resident ? 1 : 2);
        assert.deepEqual(JSON.parse(f.output()).query.airlines, expected);
        if (resident) assert.deepEqual(f.calls, []);
      }
    }
  }
});

test("valid explicit airlines replace malformed favourites", async (t) => {
  setAirlines(t, "ALL,,invalid");
  const f = fixture({
    residentSearch: async (_config, query) => ({
      query,
      complete: true,
      flights: [],
      searches: [],
    }),
  });
  await f.program.parseAsync([...otherAirlineArgs, "--airline", "ws"]);
  assert.deepEqual(JSON.parse(f.output()).query.airlines, ["WS"]);
});

test("invalid defaults and explicit values fail before config, IPC or browser access", async (t) => {
  setAirlines(t, undefined);
  const invalid = [
    undefined,
    "",
    "  ",
    "ALL",
    "WS,",
    ",WS",
    "WS,,TS",
    "W S",
    "W",
    "ABC",
    "WS,ALL",
  ];
  for (const source of ["env", "cli"]) {
    for (const value of invalid) {
      if (source === "env" && value === undefined)
        delete process.env.FLYPORTER_AIRLINES;
      else process.env.FLYPORTER_AIRLINES = source === "env" ? value : "UA,AA";
      // Omitted CLI input is valid with favourites; only explicit values exercise replacement.
      if (source === "cli" && value === undefined) continue;
      const unexpected = () =>
        assert.fail("Validation must precede config, IPC and browser access");
      const f = fixture({
        loadBapConfig: unexpected,
        loadRemoteChromiumConfig: unexpected,
        residentSearch: unexpected,
        openBrowser: unexpected,
      });
      await assert.rejects(
        f.program.parseAsync([
          ...otherAirlineArgs,
          ...(source === "cli" ? ["--airline", value] : []),
        ]),
        {
          code: "INVALID_ARGUMENT",
          message: /--airline or FLYPORTER_AIRLINES/,
        },
      );
      assert.equal(f.output(), "");
    }
  }
});

test("isolated dotenv favourites load without network and exported shell values win", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "flyporter-airlines-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, ".env"), "FLYPORTER_AIRLINES=ua,AA,ua,dl\n");
  const cliUrl = new URL("../src/cli.js", import.meta.url).href;
  const script = `
    const { createProgram } = await import(${JSON.stringify(cliUrl)});
    const unexpected = () => { throw new Error("Unexpected browser or network access"); };
    await createProgram({ stdout: process.stdout, stderr: process.stderr }, {
      loadBapConfig: () => ({}),
      openBrowser: unexpected,
      residentSearch: async (_config, query) => ({ query, complete: true, searches: [], flights: [] }),
    }).parseAsync(${JSON.stringify(otherAirlineArgs)});
  `;
  for (const value of [undefined, "ts,WS,ts", ""]) {
    const env = { FLYPORTER_BROWSER: "bap" };
    if (value !== undefined) env.FLYPORTER_AIRLINES = value;
    const run = promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd, env },
    );
    if (value === "") {
      await assert.rejects(run, (error) => {
        assert.match(error.stderr, /--airline or FLYPORTER_AIRLINES/);
        assert.equal(error.stdout, "");
        return true;
      });
    } else {
      const { stdout, stderr } = await run;
      assert.equal(stderr, "");
      assert.deepEqual(
        JSON.parse(stdout).query.airlines,
        value === undefined ? ["UA", "AA", "DL"] : ["TS", "WS"],
      );
    }
  }
});

test("other-airline incomplete results print JSON and exit 6, including before fatal cleanup", async () => {
  const previous = process.exitCode;
  try {
    for (const fatal of [false, true]) {
      const f = fixture({
        searchOtherAirline: async (_browser, query) => ({
          query,
          complete: false,
          fatal,
          searches: [],
          flights: [],
        }),
      });
      const run = f.program.parseAsync([
        "node",
        "flyporter",
        "search",
        "other-airline",
        "YYZ",
        "YVR",
        "2026-11-12",
        "--airline",
        "WS",
        "--json",
      ]);
      await run;
      assert.equal(JSON.parse(f.output()).complete, false);
      assert.equal(process.exitCode, 6);
      assert.deepEqual(f.calls.at(-1), ["finish", !fatal]);
    }
  } finally {
    process.exitCode = previous;
  }
});
