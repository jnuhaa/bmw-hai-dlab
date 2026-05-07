import { checkApiKey, checkRateLimit, logApiRequest } from "../../server/shared/apiSafety.mjs";

function normalizePathSegments(pathValue) {
  if (Array.isArray(pathValue)) {
    return pathValue.filter((segment) => typeof segment === "string" && segment.length > 0);
  }
  if (typeof pathValue === "string" && pathValue.length > 0) {
    return [pathValue];
  }
  return [];
}

function buildApiUrl(prefix, pathSegments, query = {}) {
  const pathname = pathSegments.length > 0 ? `${prefix}/${pathSegments.join("/")}` : prefix;
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (key === "path" || value == null) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry != null) {
          params.append(key, String(entry));
        }
      });
      return;
    }
    params.set(key, String(value));
  });

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function prepareApiRequestUrl(req, prefix) {
  const pathSegments = normalizePathSegments(req.query?.path);
  req.url = buildApiUrl(prefix, pathSegments, req.query ?? {});
}

export function runWithApiSafety(req, res, routeHandler) {
  const startedAtMs = Date.now();
  const finishLogger = () => logApiRequest(req, res.statusCode || 200, startedAtMs);
  res.once("finish", finishLogger);

  const keyCheck = checkApiKey(req);
  if (!keyCheck.ok) {
    res.statusCode = keyCheck.statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(keyCheck.payload));
    return;
  }

  const rateCheck = checkRateLimit(req);
  if (!rateCheck.ok) {
    res.statusCode = rateCheck.statusCode;
    if (rateCheck.headers) {
      Object.entries(rateCheck.headers).forEach(([headerKey, headerValue]) => {
        res.setHeader(headerKey, headerValue);
      });
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(rateCheck.payload));
    return;
  }

  routeHandler();
}
