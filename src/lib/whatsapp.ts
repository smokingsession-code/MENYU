/**
 * wa.me links open WhatsApp (app or web) with a chat to `phone` and the
 * message typed in, ready to send. `phone` is international digits.
 */
export function waLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
