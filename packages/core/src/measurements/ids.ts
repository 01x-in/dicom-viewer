/**
 * A random version 4 UUID. `crypto.randomUUID` only exists on secure pages, and a viewer on plain
 * `http` (a hospital intranet) must still be able to name a measurement.
 */
export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A new DICOM UID: `2.25.` and a random 128-bit number in decimal, which the standard allows without
 * a registered root and which is unique in practice. Works on a page that is not secure, as `newId` does.
 */
export function newUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // The first digit of a component is not 0, so the top bit is set to keep the number large.
  bytes[0] = (bytes[0] ?? 0) | 0x80;
  const value = [...bytes].reduce((total, byte) => (total << 8n) + BigInt(byte), 0n);
  return `2.25.${value.toString()}`;
}
