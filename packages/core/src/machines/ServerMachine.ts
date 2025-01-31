import { Either, left, right, chain, map } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, State, createMachineError, MachineEvent, MachineId } from '../types/Core';
import { ServerMachine, ServerState, ServerStateData, BlockHash, PublicKey } from '../types/MachineTypes';
import { ServerCommand, Event } from '../types/Messages';
import { ActorMachine } from '../eventbus/BaseMachine';
import { EventBus } from '../eventbus/EventBus';
import { Block, BlockHeader, MempoolEntry, createMempoolState, createBlockProductionConfig, computeTransactionsRoot } from '../types/BlockTypes';

// State management
export const createServerState = (
  blockHeight: number = 0,
  latestHash: BlockHash = '',
  submachines: Map<string, BlockHash> = Map()
): ServerState => Map({
  data: {
    blockHeight,
    latestHash,
    submachines,
    mempool: createMempoolState(),
    blockProductionConfig: createBlockProductionConfig(),
    lastBlockTime: Date.now(),
    lastSyncTime: Date.now() // Track last sync time
  }
});

// Event-driven server machine
export class ServerMachineImpl extends ActorMachine implements ServerMachine {
  public readonly type = 'SERVER' as const;
  private _state: ServerState;
  private _version: number;
  private _blockProductionInterval?: NodeJS.Timeout;
  private _syncInterval?: NodeJS.Timeout;

  constructor(
    id: string,
    eventBus: EventBus,
    initialState: ServerState = createServerState()
  ) {
    super(id, eventBus);
    this._state = initialState;
    this._version = 1;
    this.startBlockProduction();
    this.startStateSync(); // Start periodic state sync
  }

  // Implement readonly properties
  get state(): ServerState {
    return this._state;
  }

  get version(): number {
    return this._version;
  }

  // Start block production loop
  private startBlockProduction(): void {
    const data = this._state.get('data') as ServerStateData;
    const { blockTime } = data.blockProductionConfig;
    
    this._blockProductionInterval = setInterval(async () => {
      await this.tryProduceBlock();
    }, blockTime);
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
      void this.syncChildStates(); // Fire and forget
    }, SYNC_INTERVAL);
  }

  // Stop state synchronization
  public stopStateSync(): void {
    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = undefined;
    }
  }

  // Handle incoming events
  async handleEvent(event: MachineEvent): Promise<Either<MachineError, void>> {
    try {
      const message = event as Message<ServerCommand>;
      const result = pipe(
        validateServerState(this._state),
        chain(() => {
          // Handle state sync commands
          if (message.payload.type === 'UPDATE_CHILD_STATE') {
            this._state = updateChildState(this._state, message.payload.childId, message.payload.stateRoot);
            this._version++;
            return right(undefined);
          }

          if (message.payload.type === 'SYNC_CHILD_STATES') {
            void this.syncChildStates(); // Fire and forget
            return right(undefined);
          }

          // Add transaction to mempool instead of processing immediately
          if (message.payload.type !== 'PROCESS_BLOCK' && message.payload.type !== 'SYNC_STATE') {
            this._state = addToMempool(this._state, message);
            return right(undefined);
          }

          // Process non-transaction commands immediately
          this._state = processTransaction(this._state, message);
          this._version++;

          // Generate and dispatch appropriate events
          switch (message.payload.type) {
            case 'PROCESS_BLOCK': {
              const outEvent: MachineEvent = {
                id: `evt_${Date.now()}`,
                type: 'BLOCK_PROCESSED',
                payload: { blockHash: message.payload.blockHash },
                sender: this.id,
                timestamp: Date.now()
              };
              this.eventBus.dispatch(outEvent);
              break;
            }

            case 'SYNC_STATE': {
              const outEvent: MachineEvent = {
                id: `evt_${Date.now()}`,
                type: 'STATE_SYNCED',
                payload: { targetHash: message.payload.targetHash },
                sender: this.id,
                timestamp: Date.now()
              };
              this.eventBus.dispatch(outEvent);
              break;
            }
          }

          return right(undefined);
        })
      );
      return Promise.resolve(result);
    } catch (error) {
      return Promise.resolve(left(createMachineError(
        'INTERNAL_ERROR',
        'Failed to handle event',
        error
      )));
    }
  }

  // Synchronize child states
  private async syncChildStates(): Promise<Either<MachineError, void>> {
    try {
      const data = this._state.get('data') as ServerStateData;
      const now = Date.now();

      // For each submachine, request its current state root
      for (const [childId] of data.submachines) {
        const queryEvent: MachineEvent = {
          id: `query_${Date.now()}`,
          type: 'GET_STATE_ROOT',
          payload: { machineId: childId },
          sender: this.id,
          target: childId,
          timestamp: now
        };
        this.eventBus.dispatch(queryEvent);
      }

      // Update last sync time
      this._state = this._state.set('data', {
        ...data,
        lastSyncTime: now
      });

      return right(undefined);
    } catch (error) {
      return left(createMachineError(
        'INTERNAL_ERROR',
        'Failed to sync child states',
        error
      ));
    }
  }

  // Try to produce a new block
  private async tryProduceBlock(): Promise<Either<MachineError, void>> {
    const data = this._state.get('data') as ServerStateData;
    const { maxTransactionsPerBlock } = data.blockProductionConfig;

    // Get pending transactions from mempool
    const pendingTxs = Array.from(data.mempool.pending.values())
      .sort((a, b) => Number(b.gasPrice - a.gasPrice))
      .slice(0, maxTransactionsPerBlock)
      .map(entry => entry.transaction);

    if (pendingTxs.length === 0) {
      return right(undefined); // No transactions to process
    }

    return this.produceBlock(pendingTxs);
  }

  // Process a batch of transactions and produce a new block
  private async produceBlock(transactions: Array<Message<ServerCommand>>): Promise<Either<MachineError, void>> {
    try {
      const data = this._state.get('data') as ServerStateData;
      
      // Sync child states before producing block
      await this.syncChildStates();
      
      // Process all transactions to get new state
      const processedState = await pipe(
        processTransactions(this._state, transactions),
        chain((newState: ServerState) => {
          const stateRoot = computeStateHash(newState);
          if (stateRoot._tag === 'Left') {
            return left(stateRoot.left);
          }

          // Create block header
          const header: BlockHeader = {
            blockNumber: data.blockHeight + 1,
            parentHash: data.latestHash,
            stateRoot: stateRoot.right,
            transactionsRoot: computeTransactionsRoot(transactions),
            timestamp: Date.now(),
            proposer: this.id
          };

          // Create the block
          const block: Block = {
            header,
            transactions,
            signatures: Map()
          };

          // Update state with new block
          this._state = updateStateWithBlock(newState, block);
          this._version++;

          // Remove processed transactions from mempool
          this._state = removeFromMempool(this._state, transactions);

          // Dispatch block produced event
          const outEvent: MachineEvent = {
            id: `evt_${Date.now()}`,
            type: 'BLOCK_PRODUCED',
            payload: { block },
            sender: this.id,
            timestamp: Date.now()
          };
          this.eventBus.dispatch(outEvent);

          return right(undefined);
        })
      );

      return processedState;
    } catch (error) {
      return left(createMachineError(
        'INTERNAL_ERROR',
        'Failed to produce block',
        error
      ));
    }
  }
}

// Mempool operations
const addToMempool = (
  state: ServerState,
  tx: Message<ServerCommand>
): ServerState => {
  const data = state.get('data') as ServerStateData;
  const entry: MempoolEntry = {
    transaction: tx,
    receivedAt: Date.now(),
    gasPrice: BigInt(1), // TODO: Extract from tx
    nonce: 0 // TODO: Extract from tx
  };

  return state.set('data', {
    ...data,
    mempool: {
      ...data.mempool,
      pending: data.mempool.pending.set(tx.id, entry),
      currentSize: data.mempool.currentSize + 1
    }
  });
};

const removeFromMempool = (
  state: ServerState,
  transactions: Array<Message<ServerCommand>>
): ServerState => {
  const data = state.get('data') as ServerStateData;
  const txIds = new Set(transactions.map(tx => tx.id));

  return state.set('data', {
    ...data,
    mempool: {
      ...data.mempool,
      pending: data.mempool.pending.filter(entry => !txIds.has(entry.transaction.id)),
      currentSize: data.mempool.currentSize - txIds.size
    }
  });
};

// State updates
const updateStateWithBlock = (
  state: ServerState,
  block: Block
): ServerState => {
  const data = state.get('data') as ServerStateData;
  return state.set('data', {
    ...data,
    blockHeight: block.header.blockNumber,
    latestHash: block.header.stateRoot,
    lastBlockTime: block.header.timestamp
  });
};

// State validation
const validateServerState = (state: ServerState): Either<MachineError, void> => {
  try {
    const data = state.get('data') as ServerStateData | undefined;
    if (!data) {
      return left(createMachineError(
        'INVALID_STATE',
        'Server state must contain data'
      ));
    }
    if (data.blockHeight < 0) {
      return left(createMachineError(
        'INVALID_STATE',
        'Block height cannot be negative'
      ));
    }
    return right(undefined);
  } catch (error) {
    return left(createMachineError(
      'VALIDATION_ERROR',
      'Failed to validate server state',
      error
    ));
  }
};

// State computation
export const computeStateHash = (state: State): Either<MachineError, BlockHash> => {
  try {
    const stateJson = JSON.stringify(state.toJS());
    return right(createHash('sha256').update(stateJson).digest('hex'));
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to compute state hash',
      error
    ));
  }
};

// Event generation
export const generateBlockEvent = (blockHash: BlockHash): Event => ({
  type: 'BLOCK_PRODUCED',
  blockHash
});

// Transaction processing
const processTransactions = (
  state: ServerState,
  transactions: Array<Message<ServerCommand>>
): Either<MachineError, ServerState> => {
  try {
    const newState = transactions.reduce(
      (currentState, tx) => processTransaction(currentState, tx),
      state
    );
    return right(newState);
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to process transactions',
      error
    ));
  }
};

const processTransaction = (
  state: ServerState,
  tx: Message<ServerCommand>
): ServerState => {
  const data = state.get('data') as ServerStateData;
  
  switch (tx.payload.type) {
    case 'CREATE_SIGNER':
      return state.set('data', {
        ...data,
        submachines: data.submachines.set(tx.payload.publicKey, '')
      });
      
    case 'PROCESS_BLOCK':
      return state.set('data', {
        ...data,
        blockHeight: data.blockHeight + 1,
        latestHash: tx.payload.blockHash
      });
      
    case 'SYNC_STATE':
      return state.set('data', {
        ...data,
        latestHash: tx.payload.targetHash
      });
      
    default:
      return state;
  }
};

// Update child state
const updateChildState = (
  state: ServerState,
  childId: MachineId,
  stateRoot: BlockHash
): ServerState => {
  const data = state.get('data') as ServerStateData;
  return state.set('data', {
    ...data,
    submachines: data.submachines.set(childId, stateRoot)
  });
}; 