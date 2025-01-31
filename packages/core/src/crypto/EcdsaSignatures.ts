import { Either, left, right } from 'fp-ts/Either';
import { ec as EC } from 'elliptic';
import { MachineError, createMachineError } from '../types/Core';

// Initialize secp256k1 curve
const secp256k1 = new EC('secp256k1');

/**
 * Verifies an ECDSA signature over secp256k1.
 * @param messageHash - a 32-byte hash (Buffer or hex string)
 * @param signature - hex string of r||s (64 bytes)
 * @param publicKey - hex string in uncompressed or compressed format
 */
export function verifyEcdsaSignature(
  messageHash: Buffer | Uint8Array,
  signature: string,
  publicKey: string
): Either<MachineError, boolean> {
  try {
    // 1. Parse r, s from signature
    const r = signature.slice(0, 64);
    const s = signature.slice(64, 128);

    const signatureObj = {
      r: r,
      s: s
    };

    // 2. Convert the public key from hex to an elliptic KeyPair
    const key = secp256k1.keyFromPublic(publicKey, 'hex');

    // 3. Verify
    const isValid = key.verify(messageHash, signatureObj);
    return right(isValid);
  } catch (err) {
    return left(createMachineError(
      'INVALID_SIGNATURE',
      'Failed to verify ECDSA signature',
      err
    ));
  }
}

/**
 * Creates an ECDSA signature over secp256k1.
 * @param messageHash - a 32-byte hash (Buffer or hex string)
 * @param privateKey - hex string of private key
 */
export function createEcdsaSignature(
  messageHash: Buffer | Uint8Array,
  privateKey: string
): Either<MachineError, string> {
  try {
    // 1. Create key pair from private key
    const keyPair = secp256k1.keyFromPrivate(privateKey, 'hex');

    // 2. Sign with canonical flag for deterministic signatures
    const signature = keyPair.sign(messageHash, { canonical: true });

    // 3. Format as r||s hex string
    const r = signature.r.toString('hex').padStart(64, '0');
    const s = signature.s.toString('hex').padStart(64, '0');
    
    return right(r + s);
  } catch (err) {
    return left(createMachineError(
      'INVALID_SIGNATURE',
      'Failed to create ECDSA signature',
      err
    ));
  }
}

/**
 * Derives a public key from a private key
 * @param privateKey - hex string of private key
 */
export function derivePublicKey(privateKey: string): Either<MachineError, string> {
  try {
    const keyPair = secp256k1.keyFromPrivate(privateKey, 'hex');
    return right(keyPair.getPublic(true, 'hex')); // compressed format
  } catch (err) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to derive public key',
      err
    ));
  }
} 