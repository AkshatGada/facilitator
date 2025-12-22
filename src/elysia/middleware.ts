import { Elysia } from "elysia";
import {
  x402HTTPResourceServer,
  type HTTPAdapter,
  type HTTPProcessResult,
  type PaywallConfig,
  type PaywallProvider,
  type RoutesConfig,
} from "@x402/core/http";
import type { x402ResourceServer, FacilitatorClient } from "@x402/core/server";

import {
  trackUptoPayment,
  TRACKING_ERROR_MESSAGES,
  TRACKING_ERROR_STATUS,
  type TrackingResult,
  type UptoSessionStore,
} from "../upto/lib.js";
import {
  createResourceServer,
  type ResourceServerConfig,
} from "../server.js";

export interface ElysiaPaymentState {
  result: HTTPProcessResult;
  tracking?: TrackingResult;
}

export interface ElysiaPaymentMiddlewareConfig {
  httpServer?: x402HTTPResourceServer;
  resourceServer?: x402ResourceServer;
  facilitatorClient?: FacilitatorClient;
  routes?: RoutesConfig;
  serverConfig?: ResourceServerConfig;
  paywallConfig?:
    | PaywallConfig
    | ((ctx: { request: Request }) => PaywallConfig | Promise<PaywallConfig>);
  paywallProvider?: PaywallProvider;
  paymentHeaderAliases?: Array<string>;
  autoSettle?: boolean;
  syncFacilitatorOnStart?: boolean;
  upto?: {
    store: UptoSessionStore;
    autoTrack?: boolean;
  };
}

const DEFAULT_PAYMENT_HEADER_ALIASES = ["x-payment"];
const DEBUG_ENV_KEY = "X402_DEBUG";
const debugEnabled =
  process.env[DEBUG_ENV_KEY] === "1" ||
  process.env[DEBUG_ENV_KEY]?.toLowerCase() === "true";

function debugLog(message: string, meta?: Record<string, unknown>): void {
  if (!debugEnabled) return;
  if (meta) {
    // eslint-disable-next-line no-console
    console.log("[x402][elysia]", message, meta);
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[x402][elysia]", message);
}

function mergeHeaders(
  current: Record<string, string> | undefined,
  next: Record<string, string>
): Record<string, string> {
  return { ...(current ?? {}), ...next };
}

type ElysiaRequestContext = {
  request: Request;
  body: unknown;
  path?: string;
  route?: string;
};

function normalizePathCandidate(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizePrefix(value: string): string {
  if (value === "/") return "";
  return value.replace(/\/+$/, "");
}

function getStaticPrefix(routePath: string): string {
  const match = routePath.search(/\/(\*|\[)/);
  const staticPath = match === -1 ? routePath : routePath.slice(0, match);
  const normalized = normalizePathCandidate(staticPath).replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash <= 0) return "";
  return normalized.slice(0, lastSlash);
}

function getRoutePatternPaths(routes?: RoutesConfig): string[] {
  if (!routes) return [];

  if ("accepts" in routes) {
    return ["*"];
  }

  return Object.keys(routes).map((pattern) => {
    const [, rawPath] = pattern.includes(" ")
      ? pattern.split(/\s+/)
      : ["*", pattern];
    return normalizePathCandidate(rawPath);
  });
}

function expandPathCandidates(
  baseCandidates: string[],
  routePatterns: string[]
): string[] {
  const candidates = new Set(baseCandidates);
  const prefixes = new Set<string>();

  for (const pattern of routePatterns) {
    if (pattern === "*") continue;
    const prefix = normalizePrefix(getStaticPrefix(pattern));
    if (prefix) {
      prefixes.add(prefix);
    }
  }

  for (const prefix of prefixes) {
    for (const candidate of baseCandidates) {
      if (!candidate.startsWith(prefix)) {
        candidates.add(normalizePathCandidate(`${prefix}${candidate}`));
      }

      if (candidate.startsWith(prefix)) {
        const stripped = candidate.slice(prefix.length) || "/";
        candidates.add(normalizePathCandidate(stripped));
      }
    }
  }

  return Array.from(candidates);
}

function getPathCandidates(ctx: ElysiaRequestContext, fallback: string): string[] {
  const candidates = new Set<string>();
  candidates.add(normalizePathCandidate(resolveUrl(ctx.request).pathname));
  candidates.add(normalizePathCandidate(fallback));

  if (typeof ctx.path === "string" && ctx.path.length > 0) {
    candidates.add(normalizePathCandidate(ctx.path));
  }

  if (typeof ctx.route === "string" && ctx.route.length > 0) {
    candidates.add(normalizePathCandidate(ctx.route));
  }

  return Array.from(candidates);
}

function resolveUrl(request: Request): URL {
  if (request.url.startsWith("http://") || request.url.startsWith("https://")) {
    return new URL(request.url);
  }
  return new URL(request.url, "http://localhost");
}

function createAdapter(
  ctx: ElysiaRequestContext,
  paymentHeaderAliases: Array<string>
): HTTPAdapter {
  const url = resolveUrl(ctx.request);
  const adapterPath =
    typeof ctx.path === "string" && ctx.path.length > 0
      ? normalizePathCandidate(ctx.path)
      : url.pathname;
  const queryParams: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams.entries()) {
    const existing = queryParams[key];
    if (existing === undefined) {
      queryParams[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      queryParams[key] = [existing, value];
    }
  }

  return {
    getHeader: (name) => {
      const direct = ctx.request.headers.get(name);
      if (direct !== null) return direct;

      if (name.toLowerCase() === "payment-signature") {
        for (const alias of paymentHeaderAliases) {
          const aliasValue = ctx.request.headers.get(alias);
          if (aliasValue !== null) return aliasValue;
        }
      }

      return undefined;
    },
    getMethod: () => ctx.request.method,
    getPath: () => adapterPath,
    getUrl: () => ctx.request.url,
    getAcceptHeader: () => ctx.request.headers.get("accept") ?? "",
    getUserAgent: () => ctx.request.headers.get("user-agent") ?? "",
    getQueryParams: () => queryParams,
    getQueryParam: (name) => queryParams[name],
    getBody: () => ctx.body,
  };
}

async function resolvePaywallConfig(
  source:
    | PaywallConfig
    | ((ctx: { request: Request }) => PaywallConfig | Promise<PaywallConfig>)
    | undefined,
  ctx: { request: Request }
): Promise<PaywallConfig | undefined> {
  if (!source) return undefined;
  if (typeof source === "function") {
    return source(ctx);
  }
  return source;
}

function resolveHttpServer(
  config: ElysiaPaymentMiddlewareConfig
): x402HTTPResourceServer {
  if (config.httpServer) return config.httpServer;

  if (!config.routes) {
    throw new Error("Elysia payment middleware requires routes.");
  }

  const resourceServer =
    config.resourceServer ??
    (config.facilitatorClient
      ? createResourceServer(config.facilitatorClient, config.serverConfig)
      : undefined);

  if (!resourceServer) {
    throw new Error(
      "Elysia payment middleware requires a resourceServer or facilitatorClient."
    );
  }

  return new x402HTTPResourceServer(resourceServer, config.routes);
}

export function createElysiaPaymentMiddleware(
  config: ElysiaPaymentMiddlewareConfig
): (app: Elysia) => Elysia {
  const httpServer = resolveHttpServer(config);
  const paymentHeaderAliases =
    config.paymentHeaderAliases ?? DEFAULT_PAYMENT_HEADER_ALIASES;
  const autoSettle = config.autoSettle ?? true;
  const autoTrack = config.upto?.autoTrack ?? true;
  const routePatterns = getRoutePatternPaths(config.routes);

  if (config.paywallProvider) {
    httpServer.registerPaywallProvider(config.paywallProvider);
  }

  debugLog("initialized", {
    routes: routePatterns,
    autoSettle,
    autoTrack,
  });

  return (app: Elysia) => {
    if (config.syncFacilitatorOnStart ?? true) {
      app.onStart(async () => {
        await httpServer.initialize();
      });
    }

    app.onBeforeHandle({ as: "global" }, async (ctx) => {
    const adapter = createAdapter(ctx, paymentHeaderAliases);
    const paywallConfig = await resolvePaywallConfig(config.paywallConfig, ctx);
    const requestUrl = resolveUrl(ctx.request);
    const paymentHeader = adapter.getHeader("payment-signature");

    const pathCandidates = expandPathCandidates(
      getPathCandidates(ctx, adapter.getPath()),
      routePatterns
    );

    debugLog("request", {
      method: adapter.getMethod(),
      adapterPath: adapter.getPath(),
      urlPathname: requestUrl.pathname,
      ctxPath: ctx.path,
      ctxRoute: ctx.route,
      hasPaymentHeader: Boolean(paymentHeader),
    });
    debugLog("pathCandidates", { candidates: pathCandidates });

    let result: HTTPProcessResult = { type: "no-payment-required" };

    for (const candidate of pathCandidates) {
      const attempt = await httpServer.processHTTPRequest(
        {
          adapter,
          path: candidate,
          method: adapter.getMethod(),
        },
        paywallConfig
      );

      debugLog("processAttempt", { path: candidate, result: attempt.type });
      result = attempt;
      if (attempt.type !== "no-payment-required") {
        break;
      }
    }

    const ctxState = ctx as { x402?: ElysiaPaymentState };
    ctxState.x402 = { result };

    if (result.type === "payment-error") {
      ctx.set.status = result.response.status;
      ctx.set.headers = mergeHeaders(ctx.set.headers, result.response.headers);
      return result.response.body;
    }

    if (
      result.type === "payment-verified" &&
      result.paymentRequirements.scheme === "upto" &&
      config.upto &&
      autoTrack
    ) {
      const tracking = trackUptoPayment(
        config.upto.store,
        result.paymentPayload,
        result.paymentRequirements
      );

      ctxState.x402 = { result, tracking };

      if (!tracking.success) {
        ctx.set.status = TRACKING_ERROR_STATUS[tracking.error];
        ctx.set.headers = mergeHeaders(ctx.set.headers, {
          "content-type": "application/json",
        });
        return {
          error: tracking.error,
          message: TRACKING_ERROR_MESSAGES[tracking.error],
          sessionId: tracking.sessionId,
        };
      }

      ctx.set.headers = mergeHeaders(ctx.set.headers, {
        "x-upto-session-id": tracking.sessionId,
      });
    }
  });

    app.onAfterHandle({ as: "global" }, async (ctx) => {
    const ctxState = ctx as { x402?: ElysiaPaymentState };
    const state = ctxState.x402;

    if (!state || state.result.type !== "payment-verified") return;

    if (state.result.paymentRequirements.scheme === "upto") {
      if (state.tracking?.success) {
        ctx.set.headers = mergeHeaders(ctx.set.headers, {
          "x-upto-session-id": state.tracking.sessionId,
        });
      }
      return;
    }

    if (!autoSettle) return;

    const settlement = await httpServer.processSettlement(
      state.result.paymentPayload,
      state.result.paymentRequirements
    );

    if (settlement.success) {
      ctx.set.headers = mergeHeaders(ctx.set.headers, settlement.headers);
    }
  });

    return app;
  };
}
