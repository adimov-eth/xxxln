import { Either, left, right, chain, map } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';
import { createPrivateKey, createPublicKey, sign, KeyObject } from 'crypto';
import { ec as EC } from 'elliptic';

import { MachineError, Message, createMachineError } from '../types/Core';
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

// Initialize secp256k1 curve
const secp256k1 = new EC('secp256k1');

// State management
export const createSignerState = (
  publicKey: PublicKey,
  entities: Map<string, BlockHash> = Map(),
  nonce: number = 0
): SignerState => Map({
  data: {
    publicKey,
    entities,
    nonce,
    pendingTransactions: Map<string, SignedTransaction>()
  }
});

// Signer machine creation
export const createSignerMachine = (
  id: string,
  parentId: string,
  publicKey: PublicKey,
  initialState: SignerState = createSignerState(publicKey)
): Either<MachineError, SignerMachine> => 
  pipe(
    validateSignerState(initialState),
    map(() => ({
      id,
      type: 'SIGNER' as const,
      state: initialState,
      version: 1,
      parentId
    }))
  );

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
export const processCommand = (
  machine: SignerMachine,
  message: Message<SignerCommand>
): Either<MachineError, SignerMachine> =>
  pipe(
    validateCommand(machine, message),
    chain(() => executeCommand(machine, message))
  );

// Command validation
const validateCommand = (
  machine: SignerMachine,
  message: Message<SignerCommand>
): Either<MachineError, void> => {
  try {
    const data = machine.state.get('data') as SignerStateData;
    
    switch (message.payload.type) {
      case 'CREATE_ENTITY':
        return validateEntityCreation(data.publicKey, message.payload.config);
        
      case 'SIGN_TRANSACTION':
        return validateTransaction(data, message.payload.txHash);
        
      default:
        return right(undefined);
    }
  } catch (error) {
    return left(createMachineError(
      'VALIDATION_ERROR',
      'Failed to validate command',
      error
    ));
  }
};

// Entity validation
const validateEntityCreation = (
  signerPublicKey: PublicKey,
  config: { threshold: number; signers: Array<[PublicKey, number]> }
): Either<MachineError, void> => {
  // Check if signer is included
  if (!config.signers.some(([key]) => key === signerPublicKey)) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Signer must be included in entity signers'
    ));
  }

  // Validate threshold
  if (config.threshold <= 0) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Threshold must be positive'
    ));
  }

  // Validate signers array
  if (config.signers.length === 0) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Entity must have at least one signer'
    ));
  }

  // Check for duplicate signers
  const uniqueSigners = new Set(config.signers.map(([key]) => key));
  if (uniqueSigners.size !== config.signers.length) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Duplicate signers are not allowed'
    ));
  }

  // Validate weights
  const hasInvalidWeight = config.signers.some(([_, weight]) => weight <= 0);
  if (hasInvalidWeight) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'All signer weights must be positive'
    ));
  }

  // Calculate total weight
  const totalWeight = config.signers.reduce((sum, [_, weight]) => sum + weight, 0);

  // Validate threshold against total weight
  if (config.threshold > totalWeight) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Threshold cannot be greater than total weight'
    ));
  }

  // Validate minimum achievable threshold
  const sortedWeights = config.signers
    .map(([_, weight]) => weight)
    .sort((a, b) => b - a); // Sort descending

    let maxAchievableWeight = 0;
    for (const weight of sortedWeights) {
      if (maxAchievableWeight >= config.threshold) break;
      maxAchievableWeight += weight;
    }

    if (maxAchievableWeight < config.threshold) {
      return left(createMachineError(
        'INVALID_OPERATION',
        'Threshold cannot be achieved with given signer weights'
      ));
    }

  return right(undefined);
};

// Transaction validation
const validateTransaction = (
  data: SignerStateData,
  txHash: string
): Either<MachineError, void> => {
  // Check if transaction exists
  const transaction = data.pendingTransactions.get(txHash);
  if (!transaction) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Transaction not found'
    ));
  }

  // Check if already signed by this signer
  if (transaction.signatures.has(data.publicKey)) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Transaction already signed by this signer'
    ));
  }

  // Check transaction nonce
  if (transaction.nonce <= data.nonce) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Transaction nonce must be greater than current nonce'
    ));
  }

  // Validate transaction metadata
  return validateTransactionMetadata(transaction);
};

// Transaction metadata validation
const validateTransactionMetadata = (
  transaction: Transaction
): Either<MachineError, void> => {
  const now = Date.now();

  // Check basic timestamp validity
  if (transaction.timestamp > now + 300000) { // 5 minutes in the future
    return left(createMachineError(
      'INVALID_OPERATION',
      'Transaction timestamp too far in the future'
    ));
  }

  // Check validity window
  if (transaction.metadata.validFrom > now) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Transaction not yet valid'
    ));
  }

  if (transaction.metadata.validUntil < now) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Transaction has expired'
    ));
  }

  // Check gas parameters
  if (transaction.metadata.gasLimit <= BigInt(0)) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Gas limit must be positive'
    ));
  }

  if (transaction.metadata.maxFeePerGas <= BigInt(0)) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Max fee per gas must be positive'
    ));
  }

  // In practice, would also validate:
  // - Chain ID against current network
  // - Gas limit against block gas limit
  // - Max fee against current network conditions
  
  return right(undefined);
};

// Command execution
const executeCommand = (
  machine: SignerMachine,
  message: Message<SignerCommand>
): Either<MachineError, SignerMachine> => {
  try {
    const newState = processSignerCommand(machine.state, message);
    return right({
      ...machine,
      state: newState,
      version: machine.version + 1
    });
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to execute command',
      error
    ));
  }
};

// Command processing
const processSignerCommand = (
  state: SignerState,
  message: Message<SignerCommand>
): SignerState => {
  const data = state.get('data') as SignerStateData;
  
  switch (message.payload.type) {
    case 'CREATE_ENTITY':
      return createEntity(state, data, message.payload.config);
      
    case 'SIGN_TRANSACTION':
      return signTransaction(state, data, message.payload.txHash);
      
    default:
      return state;
  }
};

// Entity creation
const createEntity = (
  state: SignerState,
  data: SignerStateData,
  config: { threshold: number; signers: Array<[PublicKey, number]> }
): SignerState => {
  const entityId = generateEntityId(config);
  const blockHash = computeEntityHash(config);
  
  return state.set('data', {
    ...data,
    entities: data.entities.set(entityId, blockHash),
    nonce: data.nonce + 1
  });
};

// Transaction signing
const signTransaction = (
  state: SignerState,
  data: SignerStateData,
  txHash: string
): SignerState => {
  const transaction = data.pendingTransactions.get(txHash);
  if (!transaction) return state;

  // Compute signature using secp256k1
  const { signature, recoveryParam } = computeSignature(transaction, data.publicKey);
  
  // Update transaction with new signature
  const updatedTransaction: SignedTransaction = {
    ...transaction,
    signatures: transaction.signatures.set(data.publicKey, signature),
    recoveryParams: transaction.recoveryParams.set(data.publicKey, recoveryParam)
  };

  return state.set('data', {
    ...data,
    pendingTransactions: data.pendingTransactions.set(txHash, updatedTransaction),
    nonce: data.nonce + 1
  });
};

// Signature computation using secp256k1
const computeSignature = (
  transaction: Transaction,
  publicKey: PublicKey
): { signature: string; recoveryParam: number } => {
  // Create deterministic transaction representation
  const txData = {
    type: transaction.type,
    nonce: transaction.nonce,
    timestamp: transaction.timestamp,
    sender: transaction.sender,
    payload: transaction.payload,
    metadata: {
      chainId: transaction.metadata.chainId,
      validFrom: transaction.metadata.validFrom,
      validUntil: transaction.metadata.validUntil,
      gasLimit: transaction.metadata.gasLimit.toString(),
      maxFeePerGas: transaction.metadata.maxFeePerGas.toString()
    }
  };

  // Compute transaction hash (RFC 8785 for stable JSON stringification)
  const txString = JSON.stringify(txData, Object.keys(txData).sort());
  const messageHash = createHash('sha256').update(txString).digest();

  // In practice, would get the private key from secure storage
  // Here we derive it deterministically from the public key for demo
  const privateKey = secp256k1.keyFromPrivate(
    createHash('sha256').update(publicKey).digest()
  );

  // Sign the message hash
  const signature = privateKey.sign(messageHash, { canonical: true });

  // Convert signature to hex string
  const r = signature.r.toString('hex').padStart(64, '0');
  const s = signature.s.toString('hex').padStart(64, '0');
  const signatureHex = r + s;

  return {
    signature: signatureHex,
    recoveryParam: signature.recoveryParam || 0
  };
};

// Signature verification
export const verifySignature = (
  transaction: SignedTransaction,
  publicKey: PublicKey
): Either<MachineError, boolean> => {
  try {
    const signature = transaction.signatures.get(publicKey);
    const recoveryParam = transaction.recoveryParams.get(publicKey);
    
    if (!signature || recoveryParam === undefined) {
      return left(createMachineError(
        'INVALID_OPERATION',
        'Signature not found'
      ));
    }

    // Reconstruct message hash
    const txData = {
      type: transaction.type,
      nonce: transaction.nonce,
      timestamp: transaction.timestamp,
      sender: transaction.sender,
      payload: transaction.payload,
      metadata: {
        chainId: transaction.metadata.chainId,
        validFrom: transaction.metadata.validFrom,
        validUntil: transaction.metadata.validUntil,
        gasLimit: transaction.metadata.gasLimit.toString(),
        maxFeePerGas: transaction.metadata.maxFeePerGas.toString()
      }
    };

    const txString = JSON.stringify(txData, Object.keys(txData).sort());
    const messageHash = createHash('sha256').update(txString).digest();

    // Parse signature
    const r = Buffer.from(signature.slice(0, 64), 'hex');
    const s = Buffer.from(signature.slice(64, 128), 'hex');

    // Verify signature
    const key = secp256k1.keyFromPublic(publicKey, 'hex');
    const isValid = key.verify(messageHash, { r, s });

    return right(isValid);
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to verify signature',
      error
    ));
  }
};

// Transaction hash computation
export const computeTransactionHash = (transaction: Transaction): string => {
  const txString = JSON.stringify({
    type: transaction.type,
    nonce: transaction.nonce,
    timestamp: transaction.timestamp,
    sender: transaction.sender,
    payload: transaction.payload
  }, Object.keys(transaction).sort());

  return createHash('sha256')
    .update(txString)
    .digest('hex');
};

// Event generation for signed transactions
export const generateTransactionSignedEvent = (
  txHash: string,
  signer: PublicKey
): Event => ({
  type: 'STATE_UPDATED',
  machineId: txHash,
  version: 1
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
  version: 1
});

// Batch signature verification
export type BatchVerificationResult = {
  readonly isValid: boolean;
  readonly errors: Map<PublicKey, MachineError>;
};

export const verifySignaturesBatch = (
  transaction: SignedTransaction,
  publicKeys: ReadonlyArray<PublicKey>
): Either<MachineError, BatchVerificationResult> => {
  try {
    // Reconstruct message hash (only once for all verifications)
    const txData = {
      type: transaction.type,
      nonce: transaction.nonce,
      timestamp: transaction.timestamp,
      sender: transaction.sender,
      payload: transaction.payload,
      metadata: {
        chainId: transaction.metadata.chainId,
        validFrom: transaction.metadata.validFrom,
        validUntil: transaction.metadata.validUntil,
        gasLimit: transaction.metadata.gasLimit.toString(),
        maxFeePerGas: transaction.metadata.maxFeePerGas.toString()
      }
    };

    const txString = JSON.stringify(txData, Object.keys(txData).sort());
    const messageHash = createHash('sha256').update(txString).digest();

    // Initialize result maps
    let allValid = true;
    const errors = Map<PublicKey, MachineError>().asMutable();

    // Verify each signature
    for (const publicKey of publicKeys) {
      const signature = transaction.signatures.get(publicKey);
      const recoveryParam = transaction.recoveryParams.get(publicKey);

      if (!signature || recoveryParam === undefined) {
        allValid = false;
        errors.set(publicKey, createMachineError(
          'INVALID_OPERATION',
          'Signature not found'
        ));
        continue;
      }

      try {
        // Parse signature
        const r = Buffer.from(signature.slice(0, 64), 'hex');
        const s = Buffer.from(signature.slice(64, 128), 'hex');

        // Verify signature
        const key = secp256k1.keyFromPublic(publicKey, 'hex');
        const isValid = key.verify(messageHash, { r, s });

        if (!isValid) {
          allValid = false;
          errors.set(publicKey, createMachineError(
            'INVALID_OPERATION',
            'Invalid signature'
          ));
        }
      } catch (error) {
        allValid = false;
        errors.set(publicKey, createMachineError(
          'INTERNAL_ERROR',
          'Failed to verify signature',
          error
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

// Helper function to verify entity signatures
export const verifyEntitySignatures = (
  transaction: SignedTransaction,
  config: EntityConfig
): Either<MachineError, { 
  readonly isValid: boolean;
  readonly totalWeight: number;
  readonly errors: Map<PublicKey, MachineError>;
}> => {
  return pipe(
    verifySignaturesBatch(transaction, Array.from(config.signers.keys())),
    map(result => {
      let totalWeight = 0;

      // Calculate total weight of valid signatures
      for (const [publicKey, weight] of config.signers) {
        if (!result.errors.has(publicKey)) {
          totalWeight += weight;
        }
      }

      return {
        isValid: totalWeight >= config.threshold,
        totalWeight,
        errors: result.errors
      };
    })
  );
}; 