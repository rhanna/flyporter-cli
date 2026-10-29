// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { BapBrowser } from "./bap-browser.js";
import { createReporter } from "./diagnostics.js";
import {
  AuthenticationError,
  FlyPorterError,
  RemoteResponseError,
} from "./errors.js";
import { redact } from "./config.js";
import { searchPorter } from "./search.js";
import { verifyKeepAliveResult } from "./auth.js";

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export class SessionStore {
  constructor(directory) {
    this.directory = directory;
  }
  file(name) {
    return path.join(this.directory, name);
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.directory);
    if (
      !stat.isDirectory() ||
      (process.getuid && stat.uid !== process.getuid())
    ) {
      throw new AuthenticationError("Unsafe BAP session directory.");
    }
    await fs.chmod(this.directory, 0o700);
  }
  async read(name) {
    try {
      const stat = await fs.lstat(this.file(name));
      if (
        !stat.isFile() ||
        (process.getuid && (stat.uid !== process.getuid() || stat.mode & 0o077))
      ) {
        throw new AuthenticationError("Unsafe BAP session state file.");
      }
      return JSON.parse(await fs.readFile(this.file(name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }
  async write(name, value) {
    const temporary = this.file(`${name}.${randomBytes(8).toString("hex")}`);
    try {
      await fs.writeFile(temporary, JSON.stringify(value), {
        mode: 0o600,
        flag: "wx",
      });
      await fs.rename(temporary, this.file(name));
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  async remove(name) {
    await fs.rm(this.file(name), { force: true });
  }
  async lock() {
    await this.init();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await fs.open(this.file("lock.json"), "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
        await handle.close();
        return () => this.remove("lock.json");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const lock = await this.read("lock.json");
        if (!lock || alive(lock.pid))
          throw new AuthenticationError(
            "BAP session is busy; retry after the current command finishes.",
          );
        await this.remove("lock.json");
      }
    }
    throw new AuthenticationError("Could not acquire BAP session lock.");
  }
}

export async function openBapSession(
  config,
  stderr,
  { store = new SessionStore(config.stateDir), open = BapBrowser.open } = {},
) {
  const unlock = await store.lock();
  let browser;
  let report;
  try {
    report = await createReporter(config, () => browser?.page, stderr);
    const saved = await store.read("reconnect.json");
    await store.remove("reconnect.json");
    let endpoint;
    if (saved?.expiresAt > Date.now()) {
      try {
        const candidate = new URL(saved.endpoint);
        const base = new URL(config.endpoint);
        if (
          candidate.protocol === "wss:" &&
          candidate.host === base.host &&
          // Browserless may prefix reconnect routes with an encrypted /e/... path.
          candidate.pathname.includes(`${base.pathname}/`) &&
          !candidate.username &&
          !candidate.password &&
          !candidate.search &&
          !candidate.hash
        )
          endpoint = candidate.href;
      } catch {
        await report.event("invalid-session-reference", {
          action: "fresh-session",
        });
      }
    }
    if (endpoint) {
      try {
        browser = await open(config, report, endpoint);
        await report.event("session-resumed");
      } catch {
        await report.event("session-expired", { action: "fresh-session" });
      }
    }
    if (!browser) browser = await open(config, report);
    return {
      browser,
      report,
      store,
      async finish(success, { retain = true } = {}) {
        let failure;
        try {
          if (browser.closed) {
            // Signal/duration shutdown already closed the disarmed transport.
            await store.remove("reconnect.json");
          } else if (success && retain && config.reconnectTimeout > 0) {
            const endpoint = await browser.retain(config.reconnectTimeout);
            await store.write("reconnect.json", {
              endpoint,
              expiresAt: Date.now() + config.reconnectTimeout,
            });
            await report.event("session-retained", {
              timeoutMs: config.reconnectTimeout,
            });
          } else {
            await store.remove("reconnect.json");
            // Disarm a reconnect grace period inherited from an earlier invocation.
            await browser.page.reconnect({ timeout: 0 });
          }
        } catch (error) {
          failure = error;
          await store.remove("reconnect.json");
          try {
            await browser.page.reconnect({ timeout: 0 });
          } catch {
            /* close below is still mandatory */
          }
        } finally {
          try {
            await browser.close();
          } catch (error) {
            failure ||= error;
          }
          await unlock();
        }
        if (failure)
          throw new RemoteResponseError("Browserless session release failed.", {
            cause: failure,
          });
      },
    };
  } catch (error) {
    try {
      await browser?.close();
    } finally {
      await unlock();
    }
    throw error;
  }
}

export function serialQueue() {
  let tail = Promise.resolve();
  return (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
}

export async function startResident(handle, config, signal, onFatal) {
  const { browser, store, report } = handle;
  const secret = randomBytes(32).toString("hex");
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\flyporter-${randomBytes(12).toString("hex")}`
      : path.join(config.stateDir, "resident.sock");
  if (process.platform !== "win32") await fs.rm(socketPath, { force: true });
  const enqueue = serialQueue();
  const sockets = new Set();
  let stopped = false;
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(5000, () => socket.destroy());
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (input.length > 16384) {
        socket.destroy();
        return;
      }
      if (!input.includes("\n")) return;
      socket.removeAllListeners("data");
      let request;
      try {
        request = JSON.parse(input.split("\n")[0]);
        const received = Buffer.from(String(request.secret));
        const expected = Buffer.from(secret);
        if (
          received.length !== expected.length ||
          !timingSafeEqual(received, expected) ||
          request.action !== "search"
        )
          throw new Error("Unauthorized");
      } catch {
        socket.end(
          JSON.stringify({
            error: {
              message: "Unauthorized IPC request.",
              code: "AUTHENTICATION_FAILED",
              exitCode: 2,
            },
          }) + "\n",
        );
        return;
      }
      socket.setTimeout(0);
      enqueue(async () => {
        if (stopped || signal.aborted)
          throw new AuthenticationError("Resident session is stopping.");
        try {
          try {
            await verifyKeepAliveResult(await browser.keepAlive());
          } catch (error) {
            if (error.code !== "SESSION_EXPIRED") throw error;
            await browser.reauthenticate();
          }
          return await searchPorter(browser, request.query || {});
        } catch (error) {
          await report.capture("99-resident-search-failed");
          onFatal(error);
          throw error;
        }
      }).then(
        (result) => socket.end(JSON.stringify({ result }) + "\n"),
        (error) => {
          socket.end(
            JSON.stringify({
              error: {
                message: redact(error.message, [
                  config.token,
                  config.username,
                  config.password,
                ]),
                code: error.code || "REMOTE_RESPONSE_ERROR",
                exitCode: error.exitCode || 6,
              },
            }) + "\n",
          );
        },
      );
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve(undefined);
      });
    });
    if (process.platform !== "win32") await fs.chmod(socketPath, 0o600);
    server.on("error", onFatal);
    await store.write("resident.json", {
      pid: process.pid,
      socketPath,
      secret,
    });
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    enqueue,
    heartbeat(timeoutMs) {
      return enqueue(async () => {
        if (stopped || signal.aborted)
          throw new AuthenticationError("Resident session is stopping.");
        const result = await browser.keepAlive();
        try {
          await verifyKeepAliveResult(result);
          return result;
        } catch (error) {
          if (error.code !== "SESSION_EXPIRED") throw error;
          await browser.reauthenticate({ timeoutMs });
          const refreshed = await browser.keepAlive();
          await verifyKeepAliveResult(refreshed);
          return refreshed;
        }
      });
    },
    async stop() {
      stopped = true;
      await store.remove("resident.json");
      server.close();
      await enqueue(async () => {});
      // Let pending responses flush, then ensure disconnected clients cannot delay shutdown.
      for (const socket of sockets) socket.end();
      if (process.platform !== "win32")
        await fs.rm(socketPath, { force: true });
    },
  };
}

export async function residentSearch(config, query) {
  const store = new SessionStore(config.stateDir);
  await store.init();
  const descriptor = await store.read("resident.json");
  if (!descriptor || !alive(descriptor.pid)) return null;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(descriptor.socketPath);
    socket.setEncoding("utf8");
    let data = "";
    socket.setTimeout(config.timeout * 10, () =>
      socket.destroy(
        new Error("Resident search timed out; it was not replayed."),
      ),
    );
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({ secret: descriptor.secret, action: "search", query }) +
          "\n",
      ),
    );
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (data.length > 50 * 1024 * 1024)
        socket.destroy(new Error("Resident response too large."));
      if (!data.includes("\n")) return;
      try {
        const response = JSON.parse(data.split("\n")[0]);
        if (response.error)
          reject(new FlyPorterError(response.error.message, response.error));
        else if (response.result) resolve(response.result);
        else reject(new RemoteResponseError("Invalid resident response."));
      } catch {
        reject(new RemoteResponseError("Malformed resident response."));
      }
      socket.end();
    });
    socket.on("end", () => {
      if (!data.includes("\n"))
        reject(
          new RemoteResponseError(
            "Resident disconnected; search was not replayed.",
          ),
        );
    });
    socket.on("error", () =>
      reject(
        new RemoteResponseError(
          "Cannot reach resident session; search was not replayed.",
        ),
      ),
    );
  });
}
