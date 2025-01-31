import { Either, left, right, isLeft, map } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, createMachineError, MachineId } from '../types/Core';
import { SignerCommand, ServerCommand, Event } from '../types/Messages';
import { BlockHash, PublicKey, SignedTransaction } from '../types/MachineTypes';
import { EventBus } from '../eventbus/EventBus';
import { AbstractBaseMachine, BaseMachineState } from './BaseMachine';
import { getKeyStorage } from '../crypto/KeyStorage';
import { createEcdsaSignature, verifyEcdsaSignature } from '../crypto/EcdsaSignatures';
import { MempoolEntry } from '../types/BlockTypes';

// State types
export type SignerState = Map<string, SignerStateData>;

export interface SignerStateData extends BaseMachineState {
    readonly publicKey: string;
    readonly pendingTransactions: Map<string, SignedTransaction>;
}

// Create initial signer state
export const createSignerState = (
    publicKey: PublicKey,
    parentId: string
): SignerStateData => ({
    blockHeight: 0,
    latestHash: '',
    stateRoot: '',
    data: Map(),
    nonces: Map([[publicKey, 0]]),
    parentId,
    childIds: [],
    publicKey,
    pendingTransactions: Map()
});

// Signer machine implementation
export class SignerMachineImpl extends AbstractBaseMachine {
    protected _signerState: SignerStateData;

    constructor(
        id: string,
        eventBus: EventBus,
        parentId: string
    ) {
        const publicKeyResult = getKeyStorage().getPublicKey(id);
        if (isLeft(publicKeyResult)) {
            throw new Error(`Failed to initialize signer: ${(publicKeyResult.left as MachineError).message}`);
        }
        
        const initialState = createSignerState(publicKeyResult.right, parentId);
        super(id, 'SIGNER', eventBus, initialState);
        this._signerState = initialState;
    }

    public async handleEventLocal(
        ephemeralState: BaseMachineState,
        event: Message<unknown>
    ): Promise<Either<MachineError, BaseMachineState>> {
        // Forward to handleEvent
        const result = await this.handleEvent(event);
        if (result._tag === 'Left') {
            return left(result.left);
        }
        // If no error, return the unchanged ephemeral state
        return right(ephemeralState);
    }

    protected async processSignerCommand(message: Message<SignerCommand>): Promise<Either<MachineError, void>> {
        try {
            switch (message.payload.type) {
                case 'CREATE_ENTITY': {
                    const currentNonces = this._signerState.nonces.set(
                        this._signerState.publicKey, 
                        (this._signerState.nonces.get(this._signerState.publicKey) || 0) + 1
                    );
                    
                    this._signerState = {
                        ...this._signerState,
                        nonces: currentNonces
                    };
                    this._state = this._signerState;
                    this._version += 1;
                    return right(undefined);
                }
                
                case 'SIGN_TRANSACTION': {
                    const transaction = this._signerState.pendingTransactions.get(message.payload.txHash);
                    if (!transaction) {
                        return left(createMachineError('INVALID_STATE', 'No such transaction'));
                    }

                    const messageHash = computeTransactionHash(transaction);
                    const privateKeyResult = getKeyStorage().getPrivateKey(this._signerState.publicKey);
                    if (isLeft(privateKeyResult)) {
                        return left(privateKeyResult.left);
                    }

                    const signatureResult = createEcdsaSignature(messageHash, privateKeyResult.right);
                    if (isLeft(signatureResult)) {
                        return left(signatureResult.left);
                    }

                    const updatedTransaction = {
                        ...transaction,
                        partialSignatures: transaction.partialSignatures.set(this._signerState.publicKey, signatureResult.right)
                    };

                    this._signerState = {
                        ...this._signerState,
                        pendingTransactions: this._signerState.pendingTransactions.set(message.payload.txHash, updatedTransaction)
                    };
                    this._state = this._signerState;
                    this._version += 1;
                    return right(undefined);
                }

                default:
                    return right(undefined);
            }
        } catch (error) {
            return left(createMachineError('INTERNAL_ERROR', 'Failed to process command', error));
        }
    }

    async handleEvent(event: Message<unknown>): Promise<Either<MachineError, void>> {
        if (event.type === 'COMMAND') {
            return this.processSignerCommand(event as Message<SignerCommand>);
        }
        return right(undefined);
    }

    verifyStateTransition(from: BaseMachineState, to: BaseMachineState): Either<MachineError, boolean> {
        try {
            const fromSigner = from as SignerStateData;
            const toSigner = to as SignerStateData;

            if (to.blockHeight < from.blockHeight) {
                return right(false);
            }

            if (toSigner.publicKey !== fromSigner.publicKey) {
                return right(false);
            }

            for (const [txHash, tx] of toSigner.pendingTransactions) {
                for (const [signer, signature] of tx.partialSignatures) {
                    const messageHash = computeTransactionHash(tx);
                    const verifyResult = verifyEcdsaSignature(messageHash, signature, signer);
                    if (isLeft(verifyResult) || !verifyResult.right) {
                        return right(false);
                    }
                }
            }

            return right(true);
        } catch (error) {
            return left(createMachineError('INTERNAL_ERROR', 'Failed to verify state transition', error));
        }
    }
}

// Helper function to compute transaction hash
const computeTransactionHash = (transaction: SignedTransaction): Buffer => {
    const hash = createHash('sha256')
        .update(JSON.stringify({
            nonce: transaction.nonce,
            sender: transaction.sender,
            type: transaction.type,
            payload: transaction.payload
        }))
        .digest();
        
    return hash;
};

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
    if (data.nonces.size === 0 || data.nonces.some(n => n < 0)) {
      return left(createMachineError(
        'INVALID_STATE',
        'Nonces cannot be negative'
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

// Event generation for signed transactions
export const generateTransactionSignedEvent = (
  txHash: string,
  signer: MachineId
): Event => ({
  type: 'STATE_UPDATED',
  machineId: signer,
  version: 1,
  stateRoot: createHash('sha256').update(`${txHash}_${signer}_${Date.now()}`).digest('hex') as BlockHash
});

// Helper functions
const generateEntityId = (config: { threshold: number; signers: Array<[PublicKey, number]> }): string => {
  const signerKeys = config.signers.map(([key]) => key).sort().join('');
  return `entity_${config.threshold}_${signerKeys}`;
};

const computeEntityHash = (config: { threshold: number; signers: Array<[PublicKey, number]> }): BlockHash => {
  const sortedSigners = [...config.signers].sort(([a], [b]) => a.localeCompare(b));
  const configString = `${config.threshold}:${sortedSigners.map(([key, weight]) => `${key}:${weight}`).join(',')}`;
  return createHash('sha256').update(configString).digest('hex') as BlockHash;
};