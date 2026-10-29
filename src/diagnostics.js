// @ts-check
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { redact } from "./config.js";

export async function createReporter(config, getPage, stderr = process.stderr) {
  const directory = path.join(
    config.artifactsDir,
    `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secrets = [config.token, config.username, config.password];
  const captures = new Map();
  const event = async (step, details = {}) => {
    const line = redact(
      JSON.stringify({ time: new Date().toISOString(), step, ...details }),
      secrets,
    );
    await appendFile(path.join(directory, "events.jsonl"), `${line}\n`, {
      mode: 0o600,
    });
    stderr.write(`${line}\n`);
  };
  const capture = async (step) => {
    const page = getPage();
    if (!page) return;
    const count = (captures.get(step) || 0) + 1;
    captures.set(step, count);
    const filename = count === 1 ? step : `${step}-${count}`;
    try {
      const masked = await page.evaluate(`(() => {
        document.getElementById('flyporter-mask')?.remove();
        const style = document.createElement('style');
        style.id = 'flyporter-mask';
        style.textContent = 'input,textarea { color:transparent!important; -webkit-text-fill-color:transparent!important; text-shadow:none!important; caret-color:transparent!important; } input[type="password"],input[data-porter-poc="username"],input[data-porter-poc="password"] { opacity:0!important; } input::selection,textarea::selection { color:transparent!important; background:transparent!important; }';
        document.documentElement.append(style);
        return 'masked';
      })()`);
      if (masked !== "masked")
        throw new Error(
          "Credential masking was not confirmed; screenshot skipped.",
        );
      const bytes = await page.screenshot({ type: "png", fullPage: true });
      await writeFile(path.join(directory, `${filename}.png`), bytes, {
        mode: 0o600,
      });
      await event(step, { screenshot: `${filename}.png` });
    } catch (error) {
      await event(step, { screenshotError: String(error.message || error) });
    } finally {
      try {
        await page.evaluate(
          "document.getElementById('flyporter-mask')?.remove()",
        );
      } catch (error) {
        await event(step, { maskCleanupError: String(error.message || error) });
      }
    }
    try {
      const controls = await page.evaluate(`(() => JSON.stringify({
        location: location.origin + location.pathname,
        controls: Array.from(document.querySelectorAll('input,select,button,label,[role]'))
          .filter(el => el.getBoundingClientRect().height > 0)
          .map(el => ({ tag:el.tagName, id:el.id, type:el.getAttribute('type'), name:el.getAttribute('name'),
            role:el.getAttribute('role'), readOnly:el.readOnly,
            text: ['INPUT','SELECT','TEXTAREA'].includes(el.tagName) ? undefined : el.textContent?.trim().slice(0,160) }))
      }))()`);
      await writeFile(
        path.join(directory, `${filename}.json`),
        redact(controls || "{}", secrets),
        { mode: 0o600 },
      );
    } catch (error) {
      await event(step, { diagnosticsError: String(error.message || error) });
    }
  };
  stderr.write(`Debug artifacts: ${directory}\n`);
  return { directory, event, capture };
}
