/**
 * Smooth traffic/quota display calculation for the FoxNG Telegram bot.
 *
 * Context
 * -------
 * Plans are sold by a *purchased* (title) quota but the VPN panel enforces a
 * slightly smaller *actual* quota:
 *
 *   10 -> 8, 20 -> 17, 30 -> 27, 50 -> 47, 100 -> 95 (GB)
 *
 * This module is PURELY presentational:
 * - It NEVER changes the panel quota, expiry, payments, or enforcement.
 * - It only computes what number the bot should SHOW the user.
 * - All inputs/outputs are in GB (decimals allowed).
 * - Rounding happens only at format time, never inside the calculation.
 */

/** Below (or at) this actual-remaining value we show the real value directly. */
export const DISPLAY_TRAFFIC_FLOOR_GB = 5;

/**
 * Generic smooth display mapping.
 *
 * Formula:
 *   diff     = purchasedTraffic - actualTrafficLimit
 *   fraction = (actualTrafficRemaining - FLOOR) / (actualTrafficLimit - FLOOR)
 *              clamped to [0, 1]
 *   displayed = actualTrafficRemaining + diff * fraction
 *
 * Boundary behaviour:
 * - actualRemaining >= actualLimit (fresh account) -> purchasedTraffic
 * - actualRemaining <= FLOOR (5GB)                 -> actualTrafficRemaining
 * - in between                                     -> linear fade of the bonus
 *
 * The function is continuous (no multi-GB jumps): it is a straight line in
 * `actualTrafficRemaining` with slope `1 + diff / (actualLimit - FLOOR)`,
 * pinned to `purchasedTraffic` at full quota and to `FLOOR` at the floor.
 *
 * Safety clamps:
 * - never negative, never greater than `purchasedTraffic`
 * - non-finite / negative inputs degrade to 0 instead of NaN
 */
export function calculateDisplayedTraffic(
  purchasedTraffic: number,
  actualTrafficLimit: number,
  actualTrafficRemaining: number,
): number {
  const purchased = Number(purchasedTraffic);
  const limit = Number(actualTrafficLimit);
  const remaining = Number(actualTrafficRemaining);

  if (!Number.isFinite(purchased) || purchased <= 0) return 0;
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return 0;

  const safeRemaining = Math.min(Math.max(0, remaining), purchased);

  // At/below the floor the user sees the real value (also covers the
  // degenerate case where the panel limit itself is <= FLOOR and no
  // interpolation interval exists).
  if (safeRemaining <= DISPLAY_TRAFFIC_FLOOR_GB) return safeRemaining;
  if (limit <= DISPLAY_TRAFFIC_FLOOR_GB) return safeRemaining;

  const bonus = Math.max(0, purchased - limit);
  if (bonus === 0) return safeRemaining;

  // Fraction of the "fade zone" still left: 1 at full quota, 0 at the floor.
  // Clamped so over-reported counters (remaining > limit) pin to purchased
  // instead of overshooting it.
  const rawFraction =
    (safeRemaining - DISPLAY_TRAFFIC_FLOOR_GB) / (limit - DISPLAY_TRAFFIC_FLOOR_GB);
  const fraction = Math.min(1, Math.max(0, rawFraction));

  const displayed = safeRemaining + bonus * fraction;

  // Final safety net: keep the presentation inside [0, purchased].
  // `displayed` is already >= safeRemaining >= 0 by construction, so this
  // only trims float overshoot above `purchased`.
  return Math.min(purchased, Math.max(0, displayed));
}

/**
 * Format a GB value for Telegram display, rounded to 2 decimals.
 * Internal calculations must stay unrounded; call this only at the end.
 *
 *   7.846 -> "7.85", 5.034 -> "5.03", 10 -> "10", 5.1 -> "5.1"
 */
export function formatDisplayedTrafficGB(gb: number): string {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return "0";
  const rounded = Math.round(n * 100) / 100;
  return `${rounded}`;
}
