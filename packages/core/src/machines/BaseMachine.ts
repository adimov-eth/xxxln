import { Either, left, right } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, createMachineError, MachineId, ErrorCode } from '../types/Core';
import { EventBus } from '../eventbus/EventBus';
import { Block, BlockHeader, MempoolEntry, createMempoolState } from '../types/BlockTypes';

// Base machine state
export interface BaseMachineState {
    readonly blockHeight: number;
    readonly latestHash: string;
    readonly stateRoot: string;
    readonly data: Map<string, unknown>;
    readonly nonces: Map<string, number>;
    readonly parentId: string | null;
    readonly childIds: string[];
}

// Base machine interface
export interface BaseMachine {
    readonly id: string;
    readonly type: string;
    readonly state: BaseMachineState;
    readonly version: number;
    readonly blocks: Block[];
    readonly mempool: {
        readonly transactions: Message<unknown>[];
        readonly proposals: Map<string, unknown>;
    };
    
    // Event handling
    handleEvent(event: Message<unknown>): Promise<Either<MachineError, void>>;
    
    // Blockchain functions
    produceBlock(): Promise<Either<MachineError, Block>>;
    receiveBlock(block: Block): Promise<Either<MachineError, void>>;
    verifyBlock(block: Block): Promise<Either<MachineError, boolean>>;
    reconstructState(targetHash: string): Promise<Either<MachineError, BaseMachineState>>;
    
    // State management
    getStateAtBlock(blockHash: string): Promise<Either<MachineError, BaseMachineState>>;
    computeStateRoot(): Either<MachineError, string>;
    verifyStateTransition(from: BaseMachineState, to: BaseMachineState): Either<MachineError, boolean>;
}

// Abstract base machine implementation
export abstract class AbstractBaseMachine implements BaseMachine {
    public readonly inbox: Message<unknown>[] = [];
    protected _state: BaseMachineState;
    protected _version: number = 1;
    protected _blocks: Block[] = [];
    protected _mempool = createMempoolState();

    constructor(
        public readonly id: string,
        public readonly type: string,
        public readonly eventBus: EventBus,
        initialState: BaseMachineState
    ) {
        this._state = initialState;
    }

    // Implement getters
    get state(): BaseMachineState {
        return this._state;
    }

    get version(): number {
        return this._version;
    }

    get blocks(): Block[] {
        return this._blocks;
    }

    get mempool(): { transactions: Message<unknown>[]; proposals: Map<string, unknown>; } {
        return {
            transactions: this._mempool.pending.valueSeq().toArray().map(entry => entry.transaction),
            proposals: Map()
        };
    }

    // Abstract methods that must be implemented by specific machines
    abstract handleEvent(event: Message<unknown>): Promise<Either<MachineError, void>>;
    abstract verifyStateTransition(from: BaseMachineState, to: BaseMachineState): Either<MachineError, boolean>;

    // Common blockchain functionality
    async produceBlock(): Promise<Either<MachineError, Block>> {
        try {
            // Get pending transactions
            const transactions = this._mempool.pending.valueSeq().toArray().map(entry => entry.transaction);
            if (transactions.length === 0) {
                return left(createMachineError(
                    'INTERNAL_ERROR',
                    'No transactions to process'
                ));
            }

            // Create new state by applying transactions
            let newState = { ...this._state };
            for (const tx of transactions) {
                const result = await this.handleEvent(tx);
                if (result._tag === 'Left') {
                    continue; // Skip failed transactions
                }
            }

            // Update block height and compute new state root
            newState.blockHeight += 1;
            const stateRootResult = this.computeStateRoot();
            if (stateRootResult._tag === 'Left') {
                return left(stateRootResult.left);
            }
            newState.stateRoot = stateRootResult.right;

            // Create block header
            const header: BlockHeader = {
                height: newState.blockHeight,
                prevHash: this._state.latestHash,
                proposer: this.id,
                timestamp: Date.now(),
                transactionsRoot: createHash('sha256')
                    .update(JSON.stringify(transactions))
                    .digest('hex'),
                stateRoot: newState.stateRoot
            };

            // Create block
            const block: Block = {
                header,
                transactions,
                signatures: Map()
            };

            // Update state
            this._state = newState;
            this._version += 1;
            this._blocks.push(block);

            return right(block);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to produce block',
                error
            ));
        }
    }

    async receiveBlock(block: Block): Promise<Either<MachineError, void>> {
        try {
            // Verify block links to our chain
            if (block.header.prevHash !== this._state.latestHash) {
                return left(createMachineError(
                    'VALIDATION_ERROR',
                    'Block does not link to current chain'
                ));
            }

            // Verify block
            const verifyResult = await this.verifyBlock(block);
            if (verifyResult._tag === 'Left') {
                return verifyResult;
            }
            if (!verifyResult.right) {
                return left(createMachineError(
                    'VALIDATION_ERROR',
                    'Block verification failed'
                ));
            }

            // Apply transactions to create new state
            let newState = { ...this._state };
            for (const tx of block.transactions) {
                const result = await this.handleEvent(tx);
                if (result._tag === 'Left') {
                    return result;
                }
            }

            // Update state
            newState.blockHeight = block.header.height;
            newState.latestHash = createHash('sha256')
                .update(JSON.stringify(block))
                .digest('hex');
            newState.stateRoot = block.header.stateRoot;

            // Verify state transition
            const transitionResult = this.verifyStateTransition(this._state, newState);
            if (transitionResult._tag === 'Left') {
                return transitionResult;
            }
            if (!transitionResult.right) {
                return left(createMachineError(
                    'VALIDATION_ERROR',
                    'State transition verification failed'
                ));
            }

            // Update machine state
            this._state = newState;
            this._version += 1;
            this._blocks.push(block);

            return right(undefined);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to receive block',
                error
            ));
        }
    }

    async verifyBlock(block: Block): Promise<Either<MachineError, boolean>> {
        try {
            // Verify block structure
            if (!block.header || !block.transactions) {
                return right(false);
            }

            // Verify block links correctly
            if (block.header.height !== this._state.blockHeight + 1) {
                return right(false);
            }

            // Verify transactions root
            const txRoot = createHash('sha256')
                .update(JSON.stringify(block.transactions))
                .digest('hex');
            if (txRoot !== block.header.transactionsRoot) {
                return right(false);
            }

            // Verify state root matches
            let tempState = { ...this._state };
            for (const tx of block.transactions) {
                const result = await this.handleEvent(tx);
                if (result._tag === 'Left') {
                    return right(false);
                }
            }

            const stateRootResult = this.computeStateRoot();
            if (stateRootResult._tag === 'Left') {
                return stateRootResult;
            }

            return right(stateRootResult.right === block.header.stateRoot);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to verify block',
                error
            ));
        }
    }

    async reconstructState(targetHash: string): Promise<Either<MachineError, BaseMachineState>> {
        try {
            // Find block with target hash
            const targetBlock = this._blocks.find(b => 
                createHash('sha256')
                    .update(JSON.stringify(b))
                    .digest('hex') === targetHash
            );

            if (!targetBlock) {
                return left(createMachineError(
                    'VALIDATION_ERROR',
                    'Target block not found'
                ));
            }

            // Replay all transactions up to target block
            let state = { ...this._state };
            for (const tx of targetBlock.transactions) {
                const result = await this.handleEvent(tx);
                if (result._tag === 'Left') {
                    return result;
                }
            }

            return right(state);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to reconstruct state',
                error
            ));
        }
    }

    async getStateAtBlock(blockHash: string): Promise<Either<MachineError, BaseMachineState>> {
        return this.reconstructState(blockHash);
    }

    computeStateRoot(): Either<MachineError, string> {
        try {
            return right(createHash('sha256')
                .update(JSON.stringify(this._state))
                .digest('hex'));
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to compute state root',
                error
            ));
        }
    }
} 