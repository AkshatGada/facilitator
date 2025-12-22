/**
 * @daydreamsai/facilitator/elysia - Elysia middleware for x402 payments
 *
 * Provides a plug-and-play Elysia plugin that handles payment verification,
 * optional upto tracking, and settlement headers for x402-protected routes.
 *
 * @example
 * ```typescript
 * import { createElysiaPaymentMiddleware } from "@daydreamsai/facilitator/elysia";
 *
 * app.use(
 *   createElysiaPaymentMiddleware({
 *     resourceServer,
 *     routes,
 *     upto: { store },
 *   })
 * );
 * ```
 */

export {
  createElysiaPaymentMiddleware,
  type ElysiaPaymentState,
  type ElysiaPaymentMiddlewareConfig,
} from "./middleware.js";
