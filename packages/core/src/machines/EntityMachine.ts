import { Either, left, right, chain, map, fold } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe, flow } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, createMachineError } from '../types/Core';
import { 
  EntityMachine, 
  EntityState, 
  EntityConfig,
  BlockHash,
  PublicKey,
  SignedTransaction,
  Transaction
} from '../types/MachineTypes';
import { EntityCommand, Event } from '../types/Messages';
import { verifyEntitySignatures } from './SignerMachine';

// State management
export const createEntityState = (
  config: EntityConfig,
  channels: Map<string, BlockHash> = Map(),
  balance: bigint = BigInt(0),
  nonce: number = 0
): EntityState => Map<string, {
  config: EntityConfig;
  channels: Map<string, BlockHash>;
  balance: bigint;
  nonce: number;
}>().set('data', {
  config,
  channels,
  balance,
  nonce
});

// Entity machine creation
export const createEntityMachine = (
  id: string,
  parentId: string,
  config: EntityConfig,
  initialState: EntityState = createEntityState(config)
): Either<MachineError, EntityMachine> => 
  pipe(
    validateEntityState(initialState),
    map(() => ({
      id,
      type: 'ENTITY' as const,
      state: initialState,
      version: 1,
      parentId
    }))
  );

// State validation
const validateEntityState = (state: EntityState): Either<MachineError, void> => {
  try {
    const data = state.get('data');
    if (!data || typeof data !== 'object') {
      return left(createMachineError(
        'INVALID_STATE',
        'Entity state must contain data object'
      ));
    }

    const { config, balance, nonce } = data as {
      config: EntityConfig;
      channels: Map<string, BlockHash>;
      balance: bigint;
      nonce: number;
    };

    // Validate threshold
    if (config.threshold <= 0) {
      return left(createMachineError(
        'INVALID_STATE',
        'Threshold must be positive'
      ));
    }

    // Validate signers
    if (config.signers.size === 0) {
      return left(createMachineError(
        'INVALID_STATE',
        'Entity must have at least one signer'
      ));
    }

    // Validate weights
    const hasInvalidWeight = Array.from(config.signers.values()).some(weight => weight <= 0);
    if (hasInvalidWeight) {
      return left(createMachineError(
        'INVALID_STATE',
        'All signer weights must be positive'
      ));
    }

    // Calculate total weight
    const totalWeight = Array.from(config.signers.values()).reduce((sum, weight) => sum + weight, 0);

    // Validate threshold against total weight
    if (config.threshold > totalWeight) {
      return left(createMachineError(
        'INVALID_STATE',
        'Threshold cannot be greater than total weight'
      ));
    }

    // Validate nonce
    if (typeof nonce !== 'number' || nonce < 0) {
      return left(createMachineError(
        'INVALID_STATE',
        'Nonce must be a non-negative number'
      ));
    }

    // Validate balance
    if (typeof balance !== 'bigint' || balance < BigInt(0)) {
      return left(createMachineError(
        'INVALID_STATE',
        'Balance must be a non-negative bigint'
      ));
    }

    return right(undefined);
  } catch (error) {
    return left(createMachineError(
      'VALIDATION_ERROR',
      'Failed to validate entity state',
      error
    ));
  }
};

// Command processing
export const processCommand = (
  machine: EntityMachine,
  message: Message<EntityCommand>
): Either<MachineError, EntityMachine> =>
  pipe(
    validateCommand(machine, message),
    chain(() => executeCommand(machine, message))
  );

// Command validation
const validateCommand = (
  machine: EntityMachine,
  message: Message<EntityCommand>
): Either<MachineError, void> => {
  try {
    switch (message.payload.type) {
      case 'PROPOSE_TRANSACTION':
        return validateProposedTransaction(machine, message.payload.transaction);
        
      case 'UPDATE_CONFIG':
        return validateConfigUpdate(machine, message.payload.newConfig);
        
      case 'OPEN_CHANNEL':
        return validateChannelOperation(machine, message.payload.partnerId);
        
      case 'CLOSE_CHANNEL':
        return validateChannelClosure(machine, message.payload.channelId);
        
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

// Transaction validation
const validateProposedTransaction = (
  machine: EntityMachine,
  transaction: SignedTransaction
): Either<MachineError, void> => {
  const data = machine.state.get('data');
  if (!data || typeof data !== 'object') {
    return left(createMachineError(
      'INVALID_STATE',
      'Entity state must contain data object'
    ));
  }

  const { config, nonce } = data as {
    config: EntityConfig;
    nonce: number;
  };

  // Check nonce
  if (transaction.nonce <= nonce) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Transaction nonce must be greater than current nonce'
    ));
  }

  // Verify signatures meet threshold
  return pipe(
    verifyEntitySignatures(transaction, config),
    chain(result => {
      if (!result.isValid) {
        return left(createMachineError(
          'INVALID_OPERATION',
          'Insufficient valid signatures',
          { 
            totalWeight: result.totalWeight,
            threshold: config.threshold,
            errors: result.errors
          }
        ));
      }
      return right(undefined);
    })
  );
};

// Config update validation
const validateConfigUpdate = (
  machine: EntityMachine,
  newConfig: EntityConfig
): Either<MachineError, void> => {
  // Validate new config structure
  if (newConfig.threshold <= 0) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'New threshold must be positive'
    ));
  }

  if (newConfig.signers.size === 0) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'New config must have at least one signer'
    ));
  }

  // Validate weights
  const hasInvalidWeight = Array.from(newConfig.signers.values()).some(weight => weight <= 0);
  if (hasInvalidWeight) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'All signer weights must be positive'
    ));
  }

  // Calculate total weight
  const totalWeight = Array.from(newConfig.signers.values()).reduce((sum, weight) => sum + weight, 0);

  // Validate threshold against total weight
  if (newConfig.threshold > totalWeight) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Threshold cannot be greater than total weight'
    ));
  }

  return right(undefined);
};

// Channel operation validation
const validateChannelOperation = (
  machine: EntityMachine,
  partnerId: string
): Either<MachineError, void> => {
  const data = machine.state.get('data');
  if (!data || typeof data !== 'object') {
    return left(createMachineError(
      'INVALID_STATE',
      'Entity state must contain data object'
    ));
  }

  const { channels } = data as {
    channels: Map<string, BlockHash>;
  };

  // Check if channel already exists
  if (channels.has(partnerId)) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Channel already exists with this partner'
    ));
  }

  // In practice, would also validate:
  // - Partner entity exists
  // - Partner entity accepts channel
  // - Channel limits and parameters
  
  return right(undefined);
};

// Channel state types
type ChannelStatus = 'ACTIVE' | 'SETTLING' | 'DISPUTED' | 'CLOSED';

type ChannelState = {
  readonly status: ChannelStatus;
  readonly balance: bigint;
  readonly lastUpdateNonce: number;
  readonly disputeTimeout?: number;
  readonly settlementProposal?: {
    readonly proposer: string;
    readonly balances: Map<string, bigint>;
    readonly signatures: Map<string, string>;
    readonly timestamp: number;
  };
};

// Channel closure validation
const validateChannelClosure = (
  machine: EntityMachine,
  channelId: string
): Either<MachineError, void> => {
  const data = machine.state.get('data');
  if (!data || typeof data !== 'object') {
    return left(createMachineError(
      'INVALID_STATE',
      'Entity state must contain data object'
    ));
  }

  const { channels, config } = data as {
    channels: Map<string, BlockHash>;
    config: EntityConfig;
  };

  // Check if channel exists
  if (!channels.has(channelId)) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Channel does not exist'
    ));
  }

  // Get channel state and validate
  return pipe(
    getChannelState(channelId),
    chain(state => {
      // Check channel status
      if (state.status === 'CLOSED') {
        return left(createMachineError(
          'INVALID_OPERATION',
          'Channel is already closed'
        ));
      }

      if (state.status === 'DISPUTED') {
        // Check if dispute timeout has passed
        const now = Date.now();
        if (state.disputeTimeout && now < state.disputeTimeout) {
          return left(createMachineError(
            'INVALID_OPERATION',
            'Cannot close channel during active dispute',
            { 
              timeRemaining: state.disputeTimeout - now 
            }
          ));
        }
      }

      // Check settlement status
      if (state.status === 'SETTLING') {
        if (!state.settlementProposal) {
          return left(createMachineError(
            'INVALID_STATE',
            'Channel in SETTLING state but no settlement proposal found'
          ));
        }

        // Verify settlement signatures
        return pipe(
          verifySettlementSignatures(state.settlementProposal, config),
          chain(result => {
            if (!result.isValid) {
              return left(createMachineError(
                'INVALID_OPERATION',
                'Insufficient valid signatures for settlement',
                { 
                  totalWeight: result.totalWeight,
                  threshold: config.threshold,
                  errors: result.errors
                }
              ));
            }

            // Verify balances match current state
            if (!verifySettlementBalances((state.settlementProposal as NonNullable<typeof state.settlementProposal>).balances, state.balance)) {
              return left(createMachineError(
                'INVALID_OPERATION',
                'Settlement balances do not match channel state'
              ));
            }

            return right(undefined);
          })
        );
      }

      // For ACTIVE channels, require settlement proposal
      if (state.status === 'ACTIVE') {
        return left(createMachineError(
          'INVALID_OPERATION',
          'Cannot close active channel without settlement proposal'
        ));
      }

      return right(undefined);
    })
  );
};

// Helper functions for channel validation
const getChannelState = (channelId: string): Either<MachineError, ChannelState> => {
  try {
    // In practice, would fetch from storage/network
    // Mock implementation for now
    return right({
      status: 'ACTIVE',
      balance: BigInt(0),
      lastUpdateNonce: 0
    });
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to fetch channel state',
      error
    ));
  }
};

const verifySettlementSignatures = (
  settlement: NonNullable<ChannelState['settlementProposal']>,
  config: EntityConfig
): Either<MachineError, { 
  readonly isValid: boolean;
  readonly totalWeight: number;
  readonly errors: Map<string, MachineError>;
}> => {
  try {
    // Create settlement message
    const message = createSettlementMessage(settlement);

    // Verify each signature
    let totalWeight = 0;
    const errors = Map<string, MachineError>().asMutable();

    for (const [signer, weight] of config.signers) {
      const signature = settlement.signatures.get(signer);
      if (!signature) {
        errors.set(signer, createMachineError(
          'INVALID_OPERATION',
          'Missing signature from signer'
        ));
        continue;
      }

      if (verifySignature(message, signature, signer)) {
        totalWeight += weight;
      } else {
        errors.set(signer, createMachineError(
          'INVALID_OPERATION',
          'Invalid signature'
        ));
      }
    }

    return right({
      isValid: totalWeight >= config.threshold,
      totalWeight,
      errors: errors.asImmutable()
    });
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to verify settlement signatures',
      error
    ));
  }
};

const verifySettlementBalances = (
  proposedBalances: Map<string, bigint>,
  currentBalance: bigint
): boolean => {
  // Sum all proposed balances
  const totalProposed = Array.from(proposedBalances.values())
    .reduce((sum, balance) => sum + balance, BigInt(0));

  // Verify total matches current balance
  return totalProposed === currentBalance;
};

const createSettlementMessage = (
  settlement: NonNullable<ChannelState['settlementProposal']>
): string => {
  const data = {
    proposer: settlement.proposer,
    balances: Array.from(settlement.balances.entries())
      .sort(([a], [b]) => a.localeCompare(b)),
    timestamp: settlement.timestamp
  };
  return JSON.stringify(data);
};

const verifySignature = (
  message: string,
  signature: string,
  publicKey: string
): boolean => {
  try {
    // In practice, would use proper crypto
    // Mock implementation for now
    return true;
  } catch (error) {
    return false;
  }
};

// Command execution
const executeCommand = (
  machine: EntityMachine,
  message: Message<EntityCommand>
): Either<MachineError, EntityMachine> => {
  try {
    const newState = processEntityCommand(machine.state, message);
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
const processEntityCommand = (
  state: EntityState,
  message: Message<EntityCommand>
): EntityState => {
  switch (message.payload.type) {
    case 'PROPOSE_TRANSACTION':
      return processTransaction(state, message.payload.transaction);
      
    case 'UPDATE_CONFIG':
      return updateConfig(state, message.payload.newConfig);
      
    case 'OPEN_CHANNEL':
      return openChannel(state, message.payload.partnerId);
      
    case 'CLOSE_CHANNEL':
      return closeChannel(state, message.payload.channelId);
      
    default:
      return state;
  }
};

// Transaction processing
const processTransaction = (
  state: EntityState,
  transaction: SignedTransaction
): EntityState => {
  const data = state.get('data') as {
    config: EntityConfig;
    channels: Map<string, BlockHash>;
    balance: bigint;
    nonce: number;
  };

  // Update nonce
  const newData = {
    ...data,
    nonce: data.nonce + 1
  };

  // Process transaction based on type
  switch (transaction.type) {
    case 'TRANSFER': {
      const amount = (transaction.payload as { amount: bigint }).amount;
      return state.set('data', {
        ...newData,
        balance: data.balance - amount
      });
    }
      
    case 'CHANNEL_UPDATE': {
      const { channelId, newHash } = transaction.payload as { 
        channelId: string; 
        newHash: BlockHash 
      };
      return state.set('data', {
        ...newData,
        channels: data.channels.set(channelId, newHash)
      });
    }
      
    case 'CONFIG_UPDATE': {
      const newConfig = transaction.payload as EntityConfig;
      return state.set('data', {
        ...newData,
        config: newConfig
      });
    }
      
    case 'STATE_UPDATE': {
      const { balance } = transaction.payload as { balance: bigint };
      return state.set('data', {
        ...newData,
        balance
      });
    }
      
    default:
      return state.set('data', newData);
  }
};

// Config update processing
const updateConfig = (
  state: EntityState,
  newConfig: EntityConfig
): EntityState => {
  const data = state.get('data') as {
    config: EntityConfig;
    channels: Map<string, BlockHash>;
    balance: bigint;
    nonce: number;
  };

  return state.set('data', {
    ...data,
    config: newConfig,
    nonce: data.nonce + 1
  });
};

// Channel operations
const openChannel = (
  state: EntityState,
  partnerId: string
): EntityState => {
  const data = state.get('data') as {
    config: EntityConfig;
    channels: Map<string, BlockHash>;
    balance: bigint;
    nonce: number;
  };

  return state.set('data', {
    ...data,
    channels: data.channels.set(partnerId, computeInitialChannelHash(partnerId)),
    nonce: data.nonce + 1
  });
};

// Channel closure
const closeChannel = (
  state: EntityState,
  channelId: string
): EntityState => {
  const data = state.get('data') as {
    config: EntityConfig;
    channels: Map<string, BlockHash>;
    balance: bigint;
    nonce: number;
  };

  // Get channel state and apply settlement
  return pipe(
    getChannelState(channelId),
    fold(
      // On error, just remove channel
      () => state.set('data', {
        ...data,
        channels: data.channels.remove(channelId),
        nonce: data.nonce + 1
      }),
      channel => {
        // Apply settlement if exists and is valid
        if (channel.settlementProposal?.balances && channel.settlementProposal.balances.has(channelId)) {
          const myBalance = channel.settlementProposal.balances.get(channelId) as bigint;
          return state.set('data', {
            ...data,
            channels: data.channels.remove(channelId),
            balance: data.balance + myBalance,
            nonce: data.nonce + 1
          });
        }

        // Otherwise just remove channel
        return state.set('data', {
          ...data,
          channels: data.channels.remove(channelId),
          nonce: data.nonce + 1
        });
      }
    )
  );
};

// Helper functions
const computeInitialChannelHash = (partnerId: string): BlockHash => {
  return createHash('sha256')
    .update(`channel_init:${partnerId}:${Date.now()}`)
    .digest('hex');
};

// Event generation
export const generateTransactionEvent = (transaction: Transaction): Event => ({
  type: 'STATE_UPDATED',
  machineId: transaction.sender,
  version: 1
});

export const generateChannelEvent = (
  channelId: string,
  partnerId: string,
  isOpening: boolean = true
): Event => ({
  type: isOpening ? 'CHANNEL_OPENED' : 'CHANNEL_CLOSED',
  channelId
}); 