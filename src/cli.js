import process from "node:process";
import { Command } from "commander";
import dotenv from "dotenv";
import { authenticateInteractively } from "./auth.js";
import { ChromeBrowser, getDefaultChromeProfilePath } from "./browser.js";
import { FlyPorterError, UnsupportedCommandError, ValidationError } from "./errors.js";
import { renderSearchTable } from "./output.js";
import { searchPorter } from "./search.js";
import { runKeepAlive } from "./session.js";
import { validateAirportCode, validateDate } from "./validation.js";

dotenv.config({ quiet: true });

export async function run(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const program = createProgram(io);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof FlyPorterError) {
      io.stderr.write(`Error [${error.code}]: ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

export function createProgram(io) {
  const program = new Command();
  program
    .name("flyporter")
    .description("Porter staff-travel availability and standby CLI")
    .version("0.1.0")
    .showHelpAfterError();

  program
    .command("auth")
    .description("Authenticate in Chrome and keep the session running")
    .option("--timeout <seconds>", "Authentication timeout in seconds", "600")
    .option("--interval <seconds>", "Heartbeat interval in seconds", "240")
    .action(async (options) => {
      const profilePath = getDefaultChromeProfilePath();
      const intervalSeconds = parsePositiveNumber(options.interval, "interval");
      if (intervalSeconds < 30) {
        throw new ValidationError("Keep-alive interval must be at least 30 seconds.");
      }
      const browser = await ChromeBrowser.launch({ profilePath });
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        await authenticateInteractively(browser, {
          timeoutMs: parsePositiveNumber(options.timeout, "timeout") * 1000,
          onWaiting: () =>
            io.stdout.write(
              "Complete Cloudflare verification and sign in using the opened Chrome window.\n",
            ),
        });
        io.stdout.write(
          `Authenticated successfully. Session is running from ${profilePath}.\n` +
            "Leave this command and Chrome open; run searches from another terminal. Press Ctrl-C to stop.\n",
        );
        await runKeepAlive(browser, {
          intervalMs: intervalSeconds * 1000,
          signal: controller.signal,
          onHeartbeat: () => io.stdout.write(`Session refreshed at ${new Date().toISOString()}\n`),
          onExpired: (error) =>
            io.stderr.write(`Session needs authentication: ${error.message}\n`),
          reauthenticate: () =>
            authenticateInteractively(browser, {
              timeoutMs: parsePositiveNumber(options.timeout, "timeout") * 1000,
              onWaiting: () =>
                io.stdout.write("Complete sign-in again using the Chrome window.\n"),
            }),
        });
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        await browser.close();
      }
    });

  const session = program.command("session").description("Manage the persistent Chrome session");
  session
    .command("keep-alive")
    .description("Keep Chrome open and periodically refresh the authenticated staff session")
    .option("--interval <seconds>", "Heartbeat interval in seconds", "240")
    .option("--auth-timeout <seconds>", "Interactive authentication timeout in seconds", "600")
    .action(async (options) => {
      const intervalSeconds = parsePositiveNumber(options.interval, "interval");
      if (intervalSeconds < 30) {
        throw new ValidationError("Keep-alive interval must be at least 30 seconds.");
      }

      const browser = await ChromeBrowser.connectOrLaunch();
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        await authenticateInteractively(browser, {
          timeoutMs: parsePositiveNumber(options.authTimeout, "auth-timeout") * 1000,
          onWaiting: () =>
            io.stdout.write(
              "Complete Cloudflare verification and sign in using the opened Chrome window.\n",
            ),
        });
        io.stdout.write(
          `Session keep-alive is running every ${intervalSeconds} seconds. Leave this process and Chrome open; press Ctrl-C to stop.\n`,
        );
        await runKeepAlive(browser, {
          intervalMs: intervalSeconds * 1000,
          signal: controller.signal,
          onHeartbeat: () => io.stdout.write(`Session refreshed at ${new Date().toISOString()}\n`),
          onExpired: (error) =>
            io.stderr.write(`Session needs authentication: ${error.message}\n`),
          reauthenticate: () =>
            authenticateInteractively(browser, {
              timeoutMs: parsePositiveNumber(options.authTimeout, "auth-timeout") * 1000,
              onWaiting: () =>
                io.stdout.write(
                  "Complete sign-in again using the keep-alive Chrome window.\n",
                ),
            }),
        });
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        await browser.close();
      }
    });

  const search = program.command("search").description("Search staff-travel availability");
  search
    .command("porter <origin> <destination> <date>")
    .description("Search Porter flights")
    .option("--json", "Print machine-readable JSON")
    .action(async (origin, destination, date, options) => {
      const normalizedArgs = {
        origin: validateAirportCode(origin, "Origin"),
        destination: validateAirportCode(destination, "Destination"),
        date: validateDate(date),
      };
      const browser = await ChromeBrowser.connectRequired();
      try {
        const result = await searchPorter(browser, normalizedArgs);
        io.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderSearchTable(result)}\n`);
      } finally {
        await browser.close();
      }
    });

  search
    .command("other-airline <origin> <destination> <date>")
    .description("Search other-airline staff travel")
    .action((origin, destination, date) => {
      validateAirportCode(origin, "Origin");
      validateAirportCode(destination, "Destination");
      validateDate(date);
      throw new UnsupportedCommandError(
        "Other-airline search requires the MyIDTravel request flow, which is not present in the supplied recording.",
      );
    });

  return program;
}

function parsePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new ValidationError(`${label} must be a positive number.`);
  }
  return number;
}
