/**
 * Convert an E.164 phone number ("+15551234567") to a Baileys JID
 * ("15551234567@s.whatsapp.net"). The trusted phone is stored as the
 * E.164 string the user typed; outbound sends require the JID form.
 *
 * Strips the leading "+" and any non-digit characters, then appends
 * the standard individual-user suffix. Multi-device suffixes (":0",
 * ":1") are not added — sendReply works against the bare JID and the
 * gateway resolves the active device internally.
 *
 * Returns null for empty / invalid input so callers can short-circuit
 * instead of sending to a malformed JID.
 */
export function phoneToJid(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.trim().replace(/^\+/, "").replace(/\D/g, "");
  if (digits.length < 8) return null; // E.164 minimum is 8 digits
  return `${digits}@s.whatsapp.net`;
}
