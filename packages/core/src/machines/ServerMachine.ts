import { Either, left, right, chain, map } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, createMachineError, MachineEvent } from '../types/Core';
import { ServerCommand, Event, Query, Command } from '../types/Messages';
import { BlockHash } from '../types/MachineTypes';
import { Block, BlockProductionConfig, createBlockProductionConfig, MempoolEntry } from '../types/BlockTypes';
import { EventBus } from '../eventbus/EventBus';
import { AbstractBaseMachine, BaseMachineState } from './BaseMachine';

// Extended base state for server
interface ExtendedBaseMachineState extends BaseMachineState {
    readonly submachines: Map<string, BlockHash>;
    readonly lastBlockTime: number;
    readonly lastSyncTime: number;
    readonly blockProductionConfig: BlockProductionConfig;
}

// Server-specific state
export interface ServerStateData extends ExtendedBaseMachineState {}

// Create initial server state
export const createServerState = (
    blockHeight: number = 0,
    latestHash: BlockHash = '',
    submachines: Map<string, BlockHash> = Map()
): ServerStateData => {
    const state: ServerStateData = {
        blockHeight,
        latestHash,
        stateRoot: '',
        data: Map(),
        nonces: Map(),
        parentId: null,
        childIds: [],
        submachines,
        lastBlockTime: Date.now(),
        lastSyncTime: Date.now(),
        blockProductionConfig: createBlockProductionConfig()
    };
    return state;
};

// Server machine implementation
export class ServerMachineImpl extends AbstractBaseMachine {
    constructor(
        id: string,
        eventBus: EventBus,
        initialState: ServerStateData = createServerState()
    ) {
        super(id, 'SERVER', eventBus, initialState);
        this.startBlockProduction();
        this.startStateSync();
    }

    private _blockProductionInterval?: NodeJS.Timeout;
    private _syncInterval?: NodeJS.Timeout;

    // Start block production loop
    private startBlockProduction(): void {
        const state = this._state as ServerStateData;
        this._blockProductionInterval = setInterval(async () => {
            await this.produceBlock();
        }, state.blockProductionConfig.blockTime); // Use configured block time
    }

    // NEW: Reintroduce produceBlock method to dispatch "BLOCK_PRODUCED"
    public async produceBlock(): Promise<Either<MachineError, Block>> {
        try {
            // Gather transactions from mempool (just an example).
            const pendingTxs = Array.from(this._mempool.pending.values()).map(entry => entry.transaction);

            const blockHash: BlockHash = `hash_${Date.now()}`;
            const newBlock: Block = {
                header: {
                    height: (this._state.blockHeight + 1),
                    timestamp: Date.now(),
                    prevHash: this._state.latestHash,
                    stateRoot: 'someNewStateRoot',
                    transactionsRoot: 'someTransactionsRoot',
                    proposer: this.id
                },
                transactions: pendingTxs,
                signatures: Map()
            };

            // Dispatch block-produced event
            const outEvent: MachineEvent = {
                id: `evt_${Date.now()}`,
                type: 'PROPOSE_BLOCK',
                payload: { 
                    kind: 'SERVER', 
                    payload: { 
                        type: 'PROPOSE_BLOCK', 
                        block: newBlock 
                    } 
                },
                timestamp: Date.now(),
                sender: this.id,
                recipient: 'ALL'
            };
            this.eventBus.dispatch(outEvent);

            return right(newBlock);
        } catch (error) {
            return left(createMachineError('INTERNAL_ERROR', 'Failed to produce block', error));
        }
    }

    // Stop block production
    public stopBlockProduction(): void {
        if (this._blockProductionInterval) {
            clearInterval(this._blockProductionInterval);
            this._blockProductionInterval = undefined;
        }
    }

    // Start state synchronization loop
    private startStateSync(): void {
        const SYNC_INTERVAL = 5000; // 5 seconds
        
        this._syncInterval = setInterval(() => {
            void this.syncChildStates();
        }, SYNC_INTERVAL);
    }

    // Stop state synchronization
    public stopStateSync(): void {
        if (this._syncInterval) {
            clearInterval(this._syncInterval);
            this._syncInterval = undefined;
        }
    }

    // Rename and adjust: handleEventLocal is now the function that
    // takes in a local ephemeral state and returns a new state.
    public async handleEventLocal(
        currentState: BaseMachineState,
        event: Message<ServerCommand>
    ): Promise<Either<MachineError, BaseMachineState>> {
        try {
            // Treat currentState as immutable; return a copy on changes
            const data = currentState as ServerStateData;

            // 1) UPDATE_CHILD_STATE
            if (event.payload.type === 'UPDATE_CHILD_STATE') {
                const newState: ServerStateData = {
                    ...data,
                    submachines: data.submachines.set(event.payload.childId, event.payload.stateRoot)
                };
                return right(newState);
            }

            // 2) SYNC_CHILD_STATES
            if (event.payload.type === 'SYNC_CHILD_STATES') {
                // We'll just return the same ephemeral state here.
                // The actual sync logic is triggered externally.
                return right(data);
            }

            // 3) Transactions that go into mempool
            if (event.payload.type !== 'PROCESS_BLOCK' && event.payload.type !== 'SYNC_STATE') {
                const entry: MempoolEntry = {
                    transaction: event,
                    receivedAt: Date.now(),
                    gasPrice: BigInt(1),
                    nonce: 0
                };
                // Clone the mempool structure immutably:
                const updatedPending = this._mempool.pending.set(event.id, entry);
                const updatedMempool = {
                    ...this._mempool,
                    pending: updatedPending,
                    currentSize: this._mempool.currentSize + 1
                };

                // We do not set this._mempool directly in ephemeral mode,
                // but you might store mempool changes on the ephemeral state if desired.
                // For demonstration, let's keep the ephemeral state unmodified regarding mempool
                // or create a new field in data. For now, we're returning data unchanged:
                return right(data);
            }

            // 4) PROCESS_BLOCK or SYNC_STATE
            switch (event.payload.type) {
                case 'PROCESS_BLOCK': {
                    const newState: ServerStateData = {
                        ...data,
                        blockHeight: data.blockHeight + 1,
                        latestHash: event.payload.blockHash
                    };
                    return right(newState);
                }
                case 'SYNC_STATE': {
                    const newState: ServerStateData = {
                        ...data,
                        latestHash: event.payload.targetHash
                    };
                    return right(newState);
                }
            }

            // If no recognized command, return the state unmodified
            return right(data);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to handle event locally',
                error
            ));
        }
    }

    // We still must provide a handleEvent(...) to fulfill BaseMachine's interface,
    // but all real ephemeral logic is in handleEventLocal now.
    public async handleEvent(event: Message<ServerCommand>): Promise<Either<MachineError, void>> {
        try {
            // Ensure top-level event type matches payload type to avoid inconsistencies:
            event = {
                ...event,
                type: event.payload.type
            };

            const ephemeralResult = await this.handleEventLocal(this._state, event);
            if (ephemeralResult._tag === 'Left') {
                return ephemeralResult;
            }

            this._state = ephemeralResult.right;
            this._version++;
            return right(undefined);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to handle event',
                error
            ));
        }
    }

    verifyStateTransition(from: ServerStateData, to: ServerStateData): Either<MachineError, boolean> {
        try {
            // Verify block height increases monotonically
            if (to.blockHeight < from.blockHeight) {
                return right(false);
            }

            // Verify submachine state roots
            for (const [machineId, stateRoot] of from.submachines) {
                const newRoot = to.submachines.get(machineId);
                if (!newRoot) {
                    return right(false);
                }
            }

            return right(true);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to verify state transition',
                error
            ));
        }
    }

    // Synchronize child states
    private async syncChildStates(): Promise<Either<MachineError, void>> {
        try {
            const data = this._state as ServerStateData;
            const now = Date.now();

            // For each submachine, request its current state root
            for (const [childId] of data.submachines) {
                const queryEvent: MachineEvent = {
                    id: `query_${Date.now()}`,
                    type: 'GET_STATE_ROOT',
                    payload: { 
                        kind: 'SERVER', 
                        payload: { 
                            type: 'SYNC_STATE', 
                            targetHash: childId 
                        } 
                    },
                    timestamp: now,
                    sender: this.id,
                    recipient: childId
                };
                this.eventBus.dispatch(queryEvent);
            }

            // Update last sync time
            const newState: ServerStateData = {
                ...data,
                lastSyncTime: now
            };
            this._state = newState;

            return right(undefined);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to sync child states',
                error
            ));
        }
    }
} 