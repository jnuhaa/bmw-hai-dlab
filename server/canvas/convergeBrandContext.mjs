/**
 * Shared Converge brand / aesthetic strings for Stylize, Gemini, and Imagen.
 * JSON: server/canvas/data/convergeBrandContext.json (override path via CONVERGE_BRAND_CONTEXT_PATH).
 * Set CONVERGE_BRAND_PROMPT_MODE=bmw_explicit to use *Explicit fields where present.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JSON = path.join(__dirname, "data", "convergeBrandContext.json");

/** @type {Record<string, string> | null} */
let cached = null;

function resolvePath() {
  const fromEnv = process.env.CONVERGE_BRAND_CONTEXT_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return DEFAULT_JSON;
}

function loadSync() {
  if (cached) {
    return cached;
  }
  const p = resolvePath();
  try {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      cached = JSON.parse(raw);
      if (!cached || typeof cached !== "object") {
        cached = {};
      }
    } else {
      cached = {};
    }
  } catch {
    cached = {};
  }
  return cached;
}

export function isBmwExplicitMode() {
  return process.env.CONVERGE_BRAND_PROMPT_MODE?.trim().toLowerCase() === "bmw_explicit";
}

/**
 * @returns {Record<string, string>}
 */
export function getConvergeBrandContextSync() {
  return loadSync();
}

/**
 * @param {"stylize"|"geminiCollab"|"geminiBrainstorm"|"imagen"} kind
 * @returns {string}
 */
export function getBrandAppendFor(kind) {
  const ctx = loadSync();
  const explicit = isBmwExplicitMode();
  const key =
    kind === "stylize"
      ? explicit
        ? "stylizeAppendExplicit"
        : "stylizeAppend"
      : kind === "geminiCollab"
        ? explicit
          ? "geminiCollabAppendExplicit"
          : "geminiCollabAppend"
        : kind === "geminiBrainstorm"
          ? explicit
            ? "geminiBrainstormAppendExplicit"
            : "geminiBrainstormAppend"
          : explicit
            ? "imagenAppendExplicit"
            : "imagenAppend";
  const s = typeof ctx[key] === "string" ? ctx[key].trim() : "";
  return s;
}
