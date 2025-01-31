import { Either, left, right, chain } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
import { MachineError, createMachineError } from '../types/Core';
import { derivePublicKey } from './EcdsaSignatures';

/**
 * Secure key storage.
 * In production, this should be replaced with HSM or secure enclave.
 */
export class KeyStorage {
  private static instance: KeyStorage | null = null;
  private privateKeys: Map<string, string> = new Map();

  private constructor(initialKeys?: Map<string, string>) {
    if (initialKeys) {
      this.privateKeys = initialKeys;
    }
  }

  public static initialize(keys: Map<string, string>): void {
    if (!KeyStorage.instance) {
      KeyStorage.instance = new KeyStorage(keys);
    }
  }

  public static getInstance(): KeyStorage {
    if (!KeyStorage.instance) {
      throw new Error('KeyStorage not initialized. Call initialize() first.');
    }
    return KeyStorage.instance;
  }

  /**
   * Store a private key for a signer
   * @param signerId - ID of the signer
   * @param privateKey - Private key in hex format
   */
  public storePrivateKey(signerId: string, privateKey: string): void {
    this.privateKeys.set(signerId, privateKey);
  }

  /**
   * Get private key for a signer
   * @param signerId - ID of the signer
   */
  public getPrivateKey(signerId: string): Either<MachineError, string> {
    const key = this.privateKeys.get(signerId);
    if (!key) {
      return left(createMachineError(
        'INTERNAL_ERROR',
        `No private key found for signer ${signerId}`
      ));
    }
    return right(key);
  }

  /**
   * Get public key for a signer
   * @param signerId - ID of the signer
   */
  public getPublicKey(signerId: string): Either<MachineError, string> {
    return pipe(
      this.getPrivateKey(signerId),
      chain((privateKey: string) => derivePublicKey(privateKey))
    );
  }

  /**
   * Derive public key from private key
   * @param privateKey - Private key in hex format
   */
  public derivePublicKey(privateKey: string): Either<MachineError, string> {
    return derivePublicKey(privateKey);
  }
}

// Export singleton instance getter
export const getKeyStorage = KeyStorage.getInstance.bind(KeyStorage); 