// @ts-check
import process from "node:process";
import { Command } from "commander";
import dotenv from "dotenv";
import {
  FlyPorterError,
  RemoteResponseError,
  ValidationError,
} from "./errors.js";
import { renderOtherAirlineTable } from "./other-airline-output.js";
import { searchOtherAirline, otherAirlineQuery } from "./other-airline.js";
import { renderSearchTable } from "./output.js";
import { searchPorter } from "./search.js";
import { runKeepAlive } from "./session.js";
import { validateAirportCode, validateDate } from "./validation.js";
import {
  selectBackend,
  loadBapConfig,
  loadRemoteChromiumConfig,
  redact,
} from "./config.js";
import { openBrowser, authenticateBrowser } from "./browser-factory.js";
import { residentSearch, startResident } from "./resident-session.js";

dotenv.config({ quiet: true });

export async function run(
  argv,
  io = { stdout: process.stdout, stderr: process.stderr },
  dependencies = {},
) {
  try {
    await createProgram(io, dependencies).parseAsync(argv);
  } catch (error) {
    const secrets = [
      "BROWSERLESS_TOKEN",
      "BROWSERLESS_API_TOKEN",
      "PORTER_USERNAME",
      "PORTER_PASSWORD",
      "FLYPORTER_USERNAME",
      "FLYPORTER_PASSWORD",
      "USERNAME",
      "PASSWORD",
    ].map((key) => process.env[key]);
    const message = redact(error.message || error, secrets);
    io.stderr.write(
      `Error [${error instanceof FlyPorterError ? error.code : "REMOTE_RESPONSE_ERROR"}]: ${message}\n`,
    );
    process.exitCode = error instanceof FlyPorterError ? error.exitCode : 6;
  }
}

export function createProgram(io, dependencies = {}) {
  const deps = {
    openBrowser,
    authenticateBrowser,
    residentSearch,
    startResident,
    searchPorter,
    searchOtherAirline,
    loadBapConfig,
    loadRemoteChromiumConfig,
    ...dependencies,
  };
  const program = new Command();
  program
    .name("flyporter")
    .description("Porter staff-travel availability and standby CLI")
    .version("0.1.0")
    .option(
      "--browser <backend>",
      "Browser backend: bap (default), local or remote-chromium",
    )
    .showHelpAfterError();
  const backend = () =>
    selectBackend(
      program.opts().browser || process.env.FLYPORTER_BROWSER || "bap",
    );
  const configFor = (name) =>
    name === "bap"
      ? deps.loadBapConfig()
      : name === "remote-chromium"
        ? deps.loadRemoteChromiumConfig()
        : undefined;

  const execute = async (name, purpose, config, options, workflow) => {
    const controller = new AbortController();
    let handle;
    let failure;
    let success = false;
    const stop = () => {
      controller.abort();
      if (handle)
        handle.browser
          .close()
          .catch((error) =>
            io.stderr.write(
              `Cleanup: ${redact(error.message, [config?.token, config?.username, config?.password])}\n`,
            ),
          );
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const timer = options.duration
      ? setTimeout(stop, positive(options.duration, "duration") * 1000)
      : undefined;
    try {
      handle = await deps.openBrowser(name, purpose, config, io.stderr);
      if (controller.signal.aborted) return;
      const completed = await workflow(handle, controller);
      success = !controller.signal.aborted && completed !== false;
    } catch (error) {
      failure = error;
      const interrupted =
        controller.signal.aborted &&
        controller.signal.reason?.name === "AbortError";
      if (handle?.report && !interrupted) {
        await handle.report.event("failed", {
          error: error.message,
          cause: error.cause?.message,
        });
        if (!handle.browser.otherAirlineActive)
          await handle.report.capture("99-failure");
      }
      // Normal signal/duration shutdown is not a remote failure.
      if (
        !controller.signal.aborted ||
        (controller.signal.reason instanceof Error &&
          controller.signal.reason.name !== "AbortError")
      )
        throw error;
    } finally {
      clearTimeout(timer);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (handle) {
        try {
          await handle.finish(success, { retain: purpose !== "resident" });
        } catch (error) {
          if (failure || controller.signal.aborted)
            io.stderr.write(
              `Cleanup: ${redact(error.message, [config?.token, config?.username, config?.password])}\n`,
            );
          else throw error;
        }
      }
    }
  };

  const maintain = async (name, handle, controller, interval, timeoutMs) => {
    const { browser } = handle;
    let resident;
    try {
      if (name !== "local")
        resident = await deps.startResident(
          handle,
          browser.config,
          controller.signal,
          (error) => {
            controller.abort(error);
            browser.close().catch(() => {});
          },
        );
      io.stdout.write(
        `Session keep-alive is running every ${interval} seconds. Press Ctrl-C to stop.\n`,
      );
      await runKeepAlive(
        {
          keepAlive: () =>
            resident ? resident.heartbeat(timeoutMs) : browser.keepAlive(),
        },
        {
          intervalMs: interval * 1000,
          signal: controller.signal,
          onHeartbeat: () =>
            io.stdout.write(
              `Session refreshed at ${new Date().toISOString()}\n`,
            ),
          onExpired: (error) =>
            io.stderr.write(
              `Session needs authentication: ${redact(error.message, [browser.config?.token, browser.config?.username, browser.config?.password])}\n`,
            ),
          reauthenticate: (error) => {
            if (name !== "local") {
              // The serialized remote heartbeat already attempted reauthentication once.
              throw error;
            }
            return deps.authenticateBrowser(name, browser, {
              timeoutMs,
              onWaiting: () =>
                io.stdout.write(
                  "Complete sign-in again using the Chrome window.\n",
                ),
            });
          },
        },
      );
      if (
        controller.signal.reason instanceof Error &&
        controller.signal.reason.name !== "AbortError"
      )
        throw controller.signal.reason;
    } finally {
      await resident?.stop();
    }
  };

  program
    .command("auth")
    .description("Authenticate; local also keeps the session running")
    .option("--timeout <seconds>", "Authentication timeout in seconds", "600")
    .option("--interval <seconds>", "Heartbeat interval (local auth only: 240)")
    .action(async (options) => {
      const name = backend();
      const timeoutMs = positive(options.timeout, "timeout") * 1000;
      const interval = heartbeat(options.interval || "240", "local");
      const config = configFor(name);
      if (name === "remote-chromium") config.authTimeout = timeoutMs;
      await execute(name, "auth", config, {}, async (handle, controller) => {
        await deps.authenticateBrowser(name, handle.browser, {
          timeoutMs,
          onWaiting: () =>
            io.stdout.write(
              "Complete Cloudflare verification and sign in using the opened Chrome window.\n",
            ),
        });
        io.stdout.write("Authenticated successfully.\n");
        if (name === "local")
          await maintain(name, handle, controller, interval, timeoutMs);
      });
    });

  program
    .command("session")
    .description("Manage the browser session")
    .command("keep-alive")
    .description("Maintain authentication in the foreground")
    .option(
      "--interval <seconds>",
      "Heartbeat interval (BAP/remote Chromium: 60; local: 240)",
    )
    .option(
      "--auth-timeout <seconds>",
      "Authentication timeout in seconds",
      "600",
    )
    .option(
      "--duration <seconds>",
      "Stop after this many seconds (default: until Ctrl-C)",
    )
    .action(async (options) => {
      const name = backend();
      const interval = heartbeat(
        options.interval || (name === "local" ? "240" : "60"),
        name,
      );
      const timeoutMs = positive(options.authTimeout, "auth-timeout") * 1000;
      if (options.duration) positive(options.duration, "duration");
      const config = configFor(name);
      if (name === "remote-chromium") config.authTimeout = timeoutMs;
      if (name === "bap")
        io.stderr.write(
          "BAP keep-alive keeps a paid remote browser running continuously until stopped; CAPTCHA/proxy charges may also apply.\n",
        );
      await execute(
        name,
        "resident",
        config,
        options,
        async (handle, controller) => {
          await deps.authenticateBrowser(name, handle.browser, {
            timeoutMs,
            onWaiting: () =>
              io.stdout.write("Complete sign-in using the Chrome window.\n"),
          });
          await maintain(name, handle, controller, interval, timeoutMs);
        },
      );
    });

  const search = program
    .command("search")
    .description("Search staff-travel availability");
  search
    .command("porter <origin> <destination> <date>")
    .description("Search Porter flights")
    .option("--json", "Print machine-readable JSON")
    .action(async (origin, destination, date, options) => {
      const query = {
        origin: validateAirportCode(origin, "Origin"),
        destination: validateAirportCode(destination, "Destination"),
        date: validateDate(date),
      };
      const name = backend();
      const config = configFor(name);
      let result =
        name !== "local" ? await deps.residentSearch(config, query) : null;
      if (!result)
        await execute(name, "search", config, {}, async (handle) => {
          if (name !== "local")
            await deps.authenticateBrowser(name, handle.browser, {});
          try {
            result = await deps.searchPorter(handle.browser, query);
          } catch (error) {
            if (error instanceof FlyPorterError) throw error;
            throw new RemoteResponseError("Porter staff search failed.", {
              cause: error,
            });
          }
        });
      if (result)
        io.stdout.write(
          options.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${renderSearchTable(result)}\n`,
        );
    });
  search
    .command("other-airline <origin> <destination> <date>")
    .description("Search every offered cabin for R2 standby travel")
    .option(
      "--airline <codes>",
      "Required explicit airline codes, comma-separated",
    )
    .option("--details", "Retrieve published load and standby details")
    .option("--json", "Print machine-readable JSON (may contain personal data)")
    .action(async (origin, destination, date, options) => {
      const query = otherAirlineQuery({
        origin,
        destination,
        date,
        airlines: options.airline,
        details: options.details,
      });
      const name = backend();
      const config = configFor(name);
      let result =
        name !== "local"
          ? await deps.residentSearch(config, query, "other-airline")
          : null;
      if (!result) {
        await execute(name, "search", config, {}, async (handle) => {
          if (name !== "local")
            await deps.authenticateBrowser(name, handle.browser, {});
          result = await deps.searchOtherAirline(handle.browser, query);
          // Deliver collected results before fatal cleanup; do not retain an unusable session.
          io.stdout.write(
            options.json
              ? `${JSON.stringify(result, null, 2)}\n`
              : `${renderOtherAirlineTable(result)}\n`,
          );
          if (!result.complete) process.exitCode = 6;
          if (result.fatal) return false;
        });
      } else {
        io.stdout.write(
          options.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${renderOtherAirlineTable(result)}\n`,
        );
        if (!result.complete) process.exitCode = 6;
      }
    });
  return program;
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new ValidationError(`${label} must be a positive number.`);
  return number;
}

export function heartbeat(value, backend) {
  const number = positive(value, "interval");
  if (number < 30 || (backend !== "local" && number >= 120))
    throw new ValidationError(
      backend !== "local"
        ? "BAP/remote Chromium keep-alive interval must be >= 30 and < 120 seconds."
        : "Keep-alive interval must be at least 30 seconds.",
    );
  return number;
}
