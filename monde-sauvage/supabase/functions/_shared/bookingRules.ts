export const BOOKING_ORIGIN_PLATFORM = "platform";
export const BOOKING_ORIGIN_GUIDE_MANUAL = "guide_manual";

export type BookingOrigin =
  | typeof BOOKING_ORIGIN_PLATFORM
  | typeof BOOKING_ORIGIN_GUIDE_MANUAL;

type BookingLike = Record<string, unknown> | null | undefined;

function coerceOrigin(value: unknown): BookingOrigin | null {
  if (value === BOOKING_ORIGIN_PLATFORM || value === BOOKING_ORIGIN_GUIDE_MANUAL) {
    return value;
  }
  return null;
}

export function getBookingOrigin(booking: BookingLike): BookingOrigin {
  const explicitOrigin = coerceOrigin(booking?.booking_origin);
  if (explicitOrigin) return explicitOrigin;

  const metadataOrigin = coerceOrigin(booking?.origin);
  if (metadataOrigin) return metadataOrigin;

  // Backward compatibility with legacy source values.
  const legacySource = booking?.source;
  if (legacySource === "system") return BOOKING_ORIGIN_GUIDE_MANUAL;

  return BOOKING_ORIGIN_PLATFORM;
}

export function isGuideManualBooking(booking: BookingLike): boolean {
  return getBookingOrigin(booking) === BOOKING_ORIGIN_GUIDE_MANUAL;
}

export function shouldApplyPlatformFee(booking: BookingLike): boolean {
  return !isGuideManualBooking(booking);
}

export function requiresPayment(booking: BookingLike): boolean {
  const paymentStatus = booking?.payment_status;
  if (paymentStatus === "paid" || paymentStatus === "refunded") {
    return false;
  }

  if (booking?.is_paid === true) {
    return false;
  }

  return true;
}

export function calculatePlatformFeeAmount(
  subtotal: number,
  booking: BookingLike,
  feePercent: number,
): number {
  if (!shouldApplyPlatformFee(booking)) {
    return 0;
  }

  return Math.round(subtotal * feePercent * 100) / 100;
}
