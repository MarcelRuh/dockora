/** A transient registry 429 must not wipe a digest we already compared. */
export function isRegistryRateLimit(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('rate limited') || lower.includes('(429)');
}

export function mergeRemoteCheck(input: {
  previousRemoteDigest: string | null;
  fetchedDigest: string | null;
  remoteError?: string;
}): { remoteDigest: string | null; error?: string } {
  if (!input.remoteError) {
    return { remoteDigest: input.fetchedDigest };
  }
  if (isRegistryRateLimit(input.remoteError) && input.previousRemoteDigest) {
    return { remoteDigest: input.previousRemoteDigest };
  }
  return {
    remoteDigest: input.previousRemoteDigest ?? input.fetchedDigest,
    error: input.remoteError,
  };
}
