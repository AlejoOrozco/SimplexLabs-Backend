import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { SecurityConfig } from '../../config/configuration';

/**
 * Envelope format for a single encrypted payload. All fields are base64url so
 * the whole ciphertext round-trips as a single ASCII string that is safe to
 * store in a TEXT column without extra encoding concerns.
 *
 * Layout (pipe-separated):
 *   v1 | iv_b64 | authTag_b64 | ciphertext_b64 | aad_b64
 *
 * `aad` (additional authenticated data) is optional and binds the ciphertext
 * to a logical context (e.g. "company:<uuid>:channel:<channel>"). If a caller
 * supplies aad on encrypt, the same aad must be supplied on decrypt or
 * authentication fails — this prevents an attacker who swaps encrypted
 * columns between rows from successfully decrypting another tenant's token.
 */

const ENVELOPE_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

const FIELD_SEPARATOR = '|';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const security = config.getOrThrow<SecurityConfig>('security');
    this.key = parseEncryptionKey(security.encryptionKey);
  }

  /**
   * Encrypt a UTF-8 plaintext. `aad` is optional but strongly recommended —
   * pass a stable string identifying the owning record (e.g. the companyId
   * combined with the channel). The returned string is opaque and must be
   * stored verbatim; it embeds version + iv + tag + ciphertext.
   */
  encrypt(plaintext: string, aad?: string): string {
    if (typeof plaintext !== 'string') {
      throw new InternalServerErrorException(
        'EncryptionService.encrypt expects a string plaintext',
      );
    }

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });

    const aadBuffer = aad !== undefined ? Buffer.from(aad, 'utf8') : undefined;
    if (aadBuffer) {
      cipher.setAAD(aadBuffer, { plaintextLength: Buffer.byteLength(plaintext, 'utf8') });
    }

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      ENVELOPE_VERSION,
      toB64Url(iv),
      toB64Url(authTag),
      toB64Url(ciphertext),
      aadBuffer ? toB64Url(aadBuffer) : '',
    ].join(FIELD_SEPARATOR);
  }

  /**
   * Decrypt a payload previously produced by `encrypt`. The `aad` supplied
   * here must byte-equal the `aad` used at encrypt time, otherwise
   * authentication fails and we throw.
   */
  decrypt(payload: string, aad?: string): string {
    const { iv, authTag, ciphertext, storedAad } = parseEnvelope(payload);

    if (storedAad && aad === undefined) {
      throw new InternalServerErrorException(
        'EncryptionService.decrypt requires aad — ciphertext was encrypted with one',
      );
    }
    if (!storedAad && aad !== undefined) {
      throw new InternalServerErrorException(
        'EncryptionService.decrypt given aad but ciphertext has none',
      );
    }
    if (storedAad && aad !== undefined) {
      const suppliedAadBuffer = Buffer.from(aad, 'utf8');
      if (
        storedAad.length !== suppliedAadBuffer.length ||
        !timingSafeEqual(storedAad, suppliedAadBuffer)
      ) {
        throw new InternalServerErrorException(
          'EncryptionService.decrypt aad mismatch',
        );
      }
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    if (storedAad) {
      decipher.setAAD(storedAad, { plaintextLength: ciphertext.length });
    }
    decipher.setAuthTag(authTag);

    try {
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      // Never leak underlying OpenSSL error detail — those sometimes include
      // ciphertext hex fragments. Authentication failure is the one signal.
      throw new InternalServerErrorException(
        'EncryptionService.decrypt authentication failed',
      );
    }
  }
}

function parseEncryptionKey(raw: string): Buffer {
  if (!raw || raw.trim().length === 0) {
    throw new InternalServerErrorException(
      'ENCRYPTION_KEY is not configured. Provide a 32-byte key as 64-char hex or base64.',
    );
  }

  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_LENGTH_BYTES * 2) {
    return Buffer.from(trimmed, 'hex');
  }

  const fromB64 = Buffer.from(trimmed, 'base64');
  if (fromB64.length === KEY_LENGTH_BYTES) return fromB64;

  const fromB64Url = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (fromB64Url.length === KEY_LENGTH_BYTES) return fromB64Url;

  throw new InternalServerErrorException(
    'ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64).',
  );
}

interface ParsedEnvelope {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
  storedAad: Buffer | null;
}

function parseEnvelope(payload: string): ParsedEnvelope {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new InternalServerErrorException(
      'EncryptionService.decrypt: empty payload',
    );
  }
  const parts = payload.split(FIELD_SEPARATOR);
  if (parts.length !== 5) {
    throw new InternalServerErrorException(
      'EncryptionService.decrypt: malformed envelope',
    );
  }
  const [version, ivB64, authTagB64, ciphertextB64, aadB64] = parts;
  if (version !== ENVELOPE_VERSION) {
    throw new InternalServerErrorException(
      `EncryptionService.decrypt: unsupported envelope version "${version}"`,
    );
  }

  const iv = fromB64Url(ivB64);
  const authTag = fromB64Url(authTagB64);
  const ciphertext = fromB64Url(ciphertextB64);
  const storedAad = aadB64.length > 0 ? fromB64Url(aadB64) : null;

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new InternalServerErrorException(
      'EncryptionService.decrypt: invalid iv length',
    );
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new InternalServerErrorException(
      'EncryptionService.decrypt: invalid auth tag length',
    );
  }

  return { iv, authTag, ciphertext, storedAad };
}

function toB64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64Url(value: string): Buffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}
