import process from "node:process";
import { Command } from "commander";
import dotenv from "dotenv";
import { authenticate } from "./auth.js";
import { FetchCookieBrowser } from "./browser.js";
import { FlyPorterError, UnsupportedCommandError } from "./errors.js";
import { renderSearchTable } from "./output.js";
import { searchPorter } from "./search.js";
import { getDefaultSessionPath, loadSession, saveSession } from "./session.js";
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
    .description("Authenticate and save a reusable session")
    .option("-u, --username <username>", "Porter username")
    .option("-p, --password <password>", "Porter password")
    .action(async (options) => {
      const username = options.username || process.env.FLYPORTER_USERNAME;
      const password = options.password || process.env.FLYPORTER_PASSWORD;
      const browser = new FetchCookieBrowser();
      await authenticate(browser, { username, password });
      const sessionPath = await saveSession(browser.serializeSession());
      io.stdout.write(`Authenticated successfully. Session saved to ${sessionPath}\n`);
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
      const sessionPath = getDefaultSessionPath();
      const session = await loadSession(sessionPath);
      const browser = FetchCookieBrowser.fromSession(session);
      try {
        const result = await searchPorter(browser, normalizedArgs);
        io.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderSearchTable(result)}\n`);
      } finally {
        await saveSession(browser.serializeSession(), sessionPath);
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
