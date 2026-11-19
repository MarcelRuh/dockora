/** `sha256:<hex>` or a bare hex image ID – not a pullable `repo:tag` reference. */
export function isImageIdRef(ref: string | undefined | null): boolean {
  if (!ref) return false;
  return /^(sha256:)?[0-9a-f]{12,64}$/i.test(ref.trim());
}
