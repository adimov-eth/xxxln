import { Either, left, right, chain, map } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, State, createMachineError } from '../types/Core';
import { ServerMachine, ServerState, ServerStateData, BlockHash, PublicKey } from '../types/MachineTypes';
import { ServerCommand, Event } from '../types/Messages';

// State management
export const createServerState = (
  blockHeight: number = 0,
  latestHash: BlockHash = '',
  submachines: Map<string, BlockHash> = Map()
): ServerState => Map({
  data: {
    blockHeight,
    latestHash,
    submachines
  }
});

// Server machine creation
export const createServerMachine = (
  id: string,
  initialState: ServerState = createServerState()
): Either<MachineError, ServerMachine> => 
  pipe(
    validateServerState(initialState),
    map(() => ({
      id,
      type: 'SERVER' as const,
      state: initialState,
      version: 1
    }))
  );

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

// Block production
export const produceBlock = (
  machine: ServerMachine,
  transactions: Array<Message<ServerCommand>>
): Either<MachineError, ServerMachine> => 
  pipe(
    processTransactions(machine.state, transactions),
    chain(newState => pipe(
      computeStateHash(newState),
      map(blockHash => updateStateWithHash(newState, blockHash))
    )),
    map(finalState => ({
      ...machine,
      state: finalState,
      version: machine.version + 1
    }))
  );

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

// State updates
const updateStateWithHash = (
  state: ServerState,
  blockHash: BlockHash
): ServerState => {
  const data = state.get('data') as ServerStateData;
  return state.set('data', {
    ...data,
    latestHash: blockHash
  });
};

// Event generation
export const generateBlockEvent = (blockHash: BlockHash): Event => ({
  type: 'BLOCK_PRODUCED',
  blockHash
}); 