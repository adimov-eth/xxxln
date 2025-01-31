import { Either, left, right, chain, map, isLeft, fold } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, createMachineError, MachineEvent } from '../types/Core';
import { 
  SignerMachine, 
  SignerState, 
  SignerStateData,
  BlockHash, 
  PublicKey,
  EntityConfig,
  Transaction,
  SignedTransaction
} from '../types/MachineTypes';
import { SignerCommand, Event } from '../types/Messages';
import { ActorMachine } from '../eventbus/BaseMachine';
import { EventBus } from '../eventbus/EventBus';
import { getKeyStorage } from '../crypto/KeyStorage';
import { createEcdsaSignature, verifyEcdsaSignature } from '../crypto/EcdsaSignatures';

// State management
export const createSignerState = (
  publicKey: PublicKey,
): SignerState => Map<string, SignerStateData>().set('data', {
  publicKey,
  privateKey: '', // This is now managed by KeyStorage
  pendingTransactions: Map<string, SignedTransaction>(),
  nonce: 0
});

// Event-driven signer machine
export class SignerMachineImpl extends ActorMachine implements SignerMachine {
  private _state: SignerState;
  private _version: number;
  public readonly type = 'SIGNER' as const;
  public readonly parentId: string;

  constructor(
    id: string,
    eventBus: EventBus,
    parentId: string,
    initialState?: SignerState
  ) {
    super(id, eventBus);
    
    // Get public key from key storage
    const publicKeyResult = getKeyStorage().getPublicKey(id);
    if (isLeft(publicKeyResult)) {
      throw new Error(`Failed to initialize signer: ${(publicKeyResult.left as MachineError).message}`);
    }
    
    this._state = initialState || createSignerState(publicKeyResult.right);
    this._version = 1;
    this.parentId = parentId;
  }

  get state(): SignerState {
    return this._state;
  }

  get version(): number {
    return this._version;
  }

  // Handle incoming events
  async handleEvent(event: MachineEvent): Promise<Either<MachineError, void>> {
    try {
      const message = event as Message<SignerCommand>;
      const data = this._state.get('data') as SignerStateData;
      
      if (!data) {
        return left(createMachineError('INVALID_STATE', 'No signer data'));
      }

      const result = await processCommand(this, message);
      return pipe(
        result,
        map(machine => {
          this._state = machine.state;
          this._version = machine.version;
          return undefined;
        })
      );
    } catch (error) {
      return left(createMachineError(
        'INTERNAL_ERROR',
        'Failed to handle event',
        error
      ));
    }
  }
}

// State validation
const validateSignerState = (state: SignerState): Either<MachineError, void> => {
  try {
    const data = state.get('data') as SignerStateData | undefined;
    if (!data) {
      return left(createMachineError(
        'INVALID_STATE',
        'Signer state must contain data'
      ));
    }
    if (!data.publicKey) {
      return left(createMachineError(
        'INVALID_STATE',
        'Signer must have a public key'
      ));
    }
    if (data.nonce < 0) {
      return left(createMachineError(
        'INVALID_STATE',
        'Nonce cannot be negative'
      ));
    }
    return right(undefined);
  } catch (error) {
    return left(createMachineError(
      'VALIDATION_ERROR',
      'Failed to validate signer state',
      error
    ));
  }
};

// Command processing
const processCommand = async (
  machine: SignerMachine,
  message: Message<SignerCommand>
): Promise<Either<MachineError, SignerMachine>> => {
  try {
    const stateResult = await processSignerCommand(machine.state, message);
    return pipe(
      stateResult,
      map(newState => ({
        ...machine,
        state: newState,
        version: machine.version + 1
      }))
    );
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to execute command',
      error
    ));
  }
};

// Command processing
const processSignerCommand = async (
  state: SignerState,
  message: Message<SignerCommand>
): Promise<Either<MachineError, SignerState>> => {
  const data = state.get('data') as SignerStateData;
  
  switch (message.payload.type) {
    case 'CREATE_ENTITY':
      return Promise.resolve(right(createEntity(state, data, message.payload.config)));
      
    case 'SIGN_TRANSACTION':
      return signTransaction(state, message.payload.txHash);
      
    default:
      return Promise.resolve(right(state));
  }
};

// Entity creation
const createEntity = (
  state: SignerState,
  data: SignerStateData,
  config: { threshold: number; signers: Array<[PublicKey, number]> }
): SignerState => {
  return state.set('data', {
    ...data,
    nonce: data.nonce + 1
  });
};

// Transaction signing
const signTransaction = async (
  state: SignerState,
  txHash: string
): Promise<Either<MachineError, SignerState>> => {
  const data = state.get('data') as SignerStateData;
  if (!data) {
    return left(createMachineError('INVALID_STATE', 'No signer data'));
  }

  const transaction = data.pendingTransactions.get(txHash);
  if (!transaction) {
    return left(createMachineError('INVALID_STATE', 'No such transaction'));
  }

  // Compute message hash
  const messageHash = computeTransactionHash(transaction);

  // Get private key from secure storage
  const privateKeyResult = getKeyStorage().getPrivateKey(data.publicKey);
  if (isLeft(privateKeyResult)) {
    return left(privateKeyResult.left);
  }

  // Create signature
  const signatureResult = createEcdsaSignature(messageHash, privateKeyResult.right);
  if (isLeft(signatureResult)) {
    return left(signatureResult.left);
  }

  // Update transaction with new signature
  const updatedTransaction = {
    ...transaction,
    partialSignatures: transaction.partialSignatures.set(data.publicKey, signatureResult.right)
  };

  // Update state
  return right(state.set('data', {
    ...data,
    pendingTransactions: data.pendingTransactions.set(txHash, updatedTransaction)
  }));
};

// Verify signature
export const verifySignature = async (
  transaction: SignedTransaction,
  publicKey: PublicKey
): Promise<Either<MachineError, boolean>> => {
  try {
    const partialSig = transaction.partialSignatures.get(publicKey);
    if (!partialSig) {
      return left(createMachineError(
        'INVALID_OPERATION',
        'Signature not found'
      ));
    }

    const messageHash = computeTransactionHash(transaction);
    return verifyEcdsaSignature(messageHash, partialSig, publicKey);
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to verify signature',
      error
    ));
  }
};

// Transaction hash computation
const computeTransactionHash = (transaction: Transaction): Uint8Array => {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      nonce: transaction.nonce,
      sender: transaction.sender,
      type: transaction.type,
      payload: transaction.payload
    }))
    .digest();
    
  return new Uint8Array(hash);
};

// Event generation for signed transactions
export const generateTransactionSignedEvent = (
  txHash: string,
  signer: PublicKey
): Event => ({
  type: 'STATE_UPDATED',
  machineId: txHash,
  version: 1,
  stateRoot: createHash('sha256').update(`${txHash}_${signer}_${Date.now()}`).digest('hex')
});

// Helper functions
const generateEntityId = (config: { threshold: number; signers: Array<[PublicKey, number]> }): string => {
  const signerKeys = config.signers.map(([key]) => key).sort().join('');
  return `entity_${config.threshold}_${signerKeys}`;
};

const computeEntityHash = (config: { threshold: number; signers: Array<[PublicKey, number]> }): BlockHash => {
  const sortedSigners = [...config.signers].sort(([a], [b]) => a.localeCompare(b));
  const configString = `${config.threshold}:${sortedSigners.map(([key, weight]) => `${key}:${weight}`).join(',')}`;
  return createHash('sha256').update(configString).digest('hex');
};

// Event generation
export const generateEntityCreatedEvent = (entityId: string): Event => ({
  type: 'STATE_UPDATED',
  machineId: entityId,
  version: 1,
  stateRoot: createHash('sha256').update(`entity_${entityId}_${Date.now()}`).digest('hex')
});

// Batch signature verification
export type BatchVerificationResult = {
  readonly isValid: boolean;
  readonly errors: Map<PublicKey, MachineError>;
};

export const verifySignaturesBatch = async (
  transaction: SignedTransaction,
  publicKeys: ReadonlyArray<PublicKey>
): Promise<Either<MachineError, BatchVerificationResult>> => {
  try {
    const messageHash = computeTransactionHash(transaction);
    let allValid = true;
    const errors = Map<PublicKey, MachineError>().asMutable();

    // Verify each signature
    for (const publicKey of publicKeys) {
      const partialSig = transaction.partialSignatures.get(publicKey);
      if (!partialSig) {
        allValid = false;
        errors.set(publicKey, createMachineError(
          'INVALID_OPERATION',
          'Signature not found'
        ));
        continue;
      }

      const result = await verifyEcdsaSignature(messageHash, partialSig, publicKey);
      if (isLeft(result)) {
        allValid = false;
        errors.set(publicKey, result.left);
      } else if (!result.right) {
        allValid = false;
        errors.set(publicKey, createMachineError(
          'INVALID_OPERATION',
          'Invalid signature'
        ));
      }
    }

    return right({
      isValid: allValid,
      errors: errors.asImmutable()
    });
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to perform batch signature verification',
      error
    ));
  }
}; 