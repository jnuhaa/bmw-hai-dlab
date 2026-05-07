import fs from "node:fs";
import path from "node:path";

const defaultStateDir = process.env.VERCEL ? "/tmp/bmw-hai-dlab-state" : ".runtime";
const stateDir = process.env.SERVER_STATE_DIR
  ? path.resolve(process.cwd(), process.env.SERVER_STATE_DIR)
  : path.resolve(process.cwd(), defaultStateDir);

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
}

function statePath(name) {
  ensureStateDir();
  return path.join(stateDir, `${name}.json`);
}

export function readJsonState(name, fallbackValue) {
  try {
    const raw = fs.readFileSync(statePath(name), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

export function writeJsonState(name, value) {
  try {
    const outputPath = statePath(name);
    const tmpPath = `${outputPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(value));
    fs.renameSync(tmpPath, outputPath);
  } catch (error) {
    console.error(`[state] Failed to persist ${name}`, error);
  }
}
