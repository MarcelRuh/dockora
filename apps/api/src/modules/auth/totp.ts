import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

const ISSUER = 'Dockora';

function deriveKey(jwtSecret: string): Buffer {
  return createHash('sha256').update(`dockora-totp-v1:${jwtSecret}`).digest();
}

/** Encrypt TOTP secret for at-rest storage. */
export function encryptTotpSecret(plainSecret: string, jwtSecret: string): string {
  const key = deriveKey(jwtSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptTotpSecret(payload: string, jwtSecret: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < 28) throw new Error('Invalid TOTP secret payload');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = deriveKey(jwtSecret);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function generateTotpSecret(): string {
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32;
}

export function buildTotp(secretBase32: string, email: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function verifyTotpCode(secretBase32: string, email: string, code: string): boolean {
  const totp = buildTotp(secretBase32, email);
  const delta = totp.validate({ token: code.replace(/\s+/g, ''), window: 1 });
  return delta !== null;
}

export async function totpQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(4).toString('hex'));
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string> {
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c.toLowerCase(), 10)));
  return JSON.stringify(hashes);
}

export async function consumeBackupCode(
  storedJson: string | null | undefined,
  code: string,
): Promise<string | null> {
  if (!storedJson) return null;
  let hashes: string[];
  try {
    hashes = JSON.parse(storedJson) as string[];
  } catch {
    return null;
  }
  const normalized = code.replace(/\s+/g, '').toLowerCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i]!)) {
      const next = hashes.filter((_, idx) => idx !== i);
      return JSON.stringify(next);
    }
  }
  return null;
}
