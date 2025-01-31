import { Either, left, right, chain, map, fold, isLeft } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe, flow } from 'fp-ts/function';
import { createHash } from 'crypto';
import { TaskEither, tryCatch } from 'fp-ts/TaskEither';

import { MachineError, Message, createMachineError, MachineEvent, MachineId } from '../types/Core';
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
import { Proposal, ProposalId, ProposalStatus } from '../types/ProposalTypes';
import { ActorMachine } from '../eventbus/BaseMachine';
import { EventBus } from '../eventbus/EventBus';
import { verifyEcdsaSignature } from '../crypto/EcdsaSignatures';

interface EntityStateData {
  config: EntityConfig;
  channels: Map<string, BlockHash>;
  balance: bigint;
  nonce: number;
  proposals: Map<ProposalId, Proposal>;
}

// State management with proposals
export const createEntityState = (
  config: EntityConfig,
  channels: Map<string, BlockHash> = Map(),
  balance: bigint = BigInt(0),
  nonce: number = 0
): EntityState => Map<string, EntityStateData>().set('data', {
  config,
  channels,
  balance,
  nonce,
  proposals: Map()
});

// Helper functions for proposal management
const createProposal = (
  proposer: MachineId,
  type: 'TRANSACTION' | 'CONFIG_UPDATE',
  transaction?: SignedTransaction,
  newConfig?: EntityConfig
): Proposal => ({
  id: `proposal_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  proposer,
  type,
  transaction,
  newConfig,
  approvals: Map<MachineId, boolean>().set(proposer, true),
  status: 'ACTIVE',
  timestamp: Date.now(),
  expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours expiry
});

const checkProposalThreshold = (
  proposal: Proposal,
  config: EntityConfig
): { isThresholdMet: boolean; totalWeight: number } => {
  let totalWeight = 0;
  
  // Sum weights of signers who approved
  for (const [signer, weight] of config.signers) {
    if (proposal.approvals.get(signer)) {
      totalWeight += weight;
    }
  }
  
  return {
    isThresholdMet: totalWeight >= config.threshold,
    totalWeight
  };
};

const executeProposal = (
  state: EntityState,
  proposalId: ProposalId
): Either<MachineError, EntityState> => {
  const data = state.get('data') as EntityStateData;
  if (!data) {
    return left(createMachineError('INVALID_STATE', 'No entity data'));
  }

  const proposal = data.proposals.get(proposalId);
  if (!proposal || proposal.status !== 'ACTIVE') {
    return left(createMachineError('INVALID_PROPOSAL', 'Proposal not found or not active'));
  }

  // Mark as executed
  const updatedProposal = {
    ...proposal,
    status: 'EXECUTED' as ProposalStatus
  };

  let newState = state.set('data', {
    ...data,
    proposals: data.proposals.set(proposalId, updatedProposal)
  });

  // Apply the actual changes
  switch (proposal.type) {
    case 'TRANSACTION':
      if (proposal.transaction) {
        return processTransaction(newState, proposal.transaction);
      }
      break;

    case 'CONFIG_UPDATE':
      if (proposal.newConfig) {
        return right(newState.set('data', {
          ...data,
          config: proposal.newConfig,
          nonce: data.nonce + 1
        }));
      }
      break;
  }

  return right(newState);
};

// Event-driven entity machine
export class EntityMachineImpl extends ActorMachine implements EntityMachine {
  public readonly type = 'ENTITY' as const;
  private _state: EntityState;
  private _version: number;
  public readonly parentId: string;

  constructor(
    id: string,
    parentId: string,
    config: EntityConfig,
    eventBus: EventBus,
    initialState: EntityState = createEntityState(config)
  ) {
    super(id, eventBus);
    this.parentId = parentId;
    this._state = initialState;
    this._version = 1;
  }

  // Implement readonly properties
  get state(): EntityState {
    return this._state;
  }

  get version(): number {
    return this._version;
  }

  // Handle incoming events
  async handleEvent(event: MachineEvent): Promise<Either<MachineError, void>> {
    try {
      const message = event as Message<EntityCommand>;
      
      const commandResult = await processCommand(this, message);
      if (isLeft(commandResult)) {
        return commandResult as Either<MachineError, void>;
      }

      const machine = commandResult.right;
      this._state = machine.state;
      this._version = machine.version;

      // Dispatch appropriate events based on command type
      switch (message.payload.type) {
        case 'PROPOSE_TRANSACTION': {
          const proposal = createProposal(
            message.sender,
            'TRANSACTION',
            message.payload.transaction
          );

          const outEvent: MachineEvent = {
            id: `evt_${Date.now()}`,
            type: 'PROPOSAL_CREATED',
            payload: { 
              proposalId: proposal.id,
              proposer: message.sender
            },
            sender: this.id,
            target: this.parentId,
            timestamp: Date.now()
          };
          this.eventBus.dispatch(outEvent);
          break;
        }

        case 'APPROVE_PROPOSAL': {
          const outEvent: MachineEvent = {
            id: `evt_${Date.now()}`,
            type: 'PROPOSAL_APPROVED',
            payload: { 
              proposalId: message.payload.proposalId,
              approver: message.sender
            },
            sender: this.id,
            target: this.parentId,
            timestamp: Date.now()
          };
          this.eventBus.dispatch(outEvent);
          break;
        }

        case 'CANCEL_PROPOSAL': {
          const outEvent: MachineEvent = {
            id: `evt_${Date.now()}`,
            type: 'PROPOSAL_CANCELLED',
            payload: { 
              proposalId: message.payload.proposalId
            },
            sender: this.id,
            target: this.parentId,
            timestamp: Date.now()
          };
          this.eventBus.dispatch(outEvent);
          break;
        }

        case 'UPDATE_CONFIG': {
          const outEvent: MachineEvent = {
            id: `evt_${Date.now()}`,
            type: 'CONFIG_UPDATED',
            payload: { newConfig: message.payload.newConfig },
            sender: this.id,
            target: this.parentId,
            timestamp: Date.now()
          };
          this.eventBus.dispatch(outEvent);
          break;
        }

        case 'OPEN_CHANNEL': {
          const outEvent: MachineEvent = {
            id: `evt_${Date.now()}`,
            type: 'CHANNEL_OPENED',
            payload: { 
              channelId: generateChannelId(this.id, message.payload.partnerId),
              partnerId: message.payload.partnerId
            },
            sender: this.id,
            target: this.parentId,
            timestamp: Date.now()
          };
          this.eventBus.dispatch(outEvent);
          break;
        }

        case 'CLOSE_CHANNEL': {
          const outEvent: MachineEvent = {
            id: `evt_${Date.now()}`,
            type: 'CHANNEL_CLOSED',
            payload: { channelId: message.payload.channelId },
            sender: this.id,
            target: this.parentId,
            timestamp: Date.now()
          };
          this.eventBus.dispatch(outEvent);
          break;
        }
      }

      return right(undefined);
    } catch (error) {
      return left(createMachineError(
        'INTERNAL_ERROR',
        'Failed to handle event',
        error
      ));
    }
  }
}

// Helper function to generate channel ID
const generateChannelId = (entityId: string, partnerId: string): string => {
  const sortedIds = [entityId, partnerId].sort();
  return `channel_${sortedIds[0]}_${sortedIds[1]}`;
};

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
export const processCommand = async (
  machine: EntityMachine,
  message: Message<EntityCommand>
): Promise<Either<MachineError, EntityMachine>> => {
  const validationResult = await validateCommand(machine, message);
  if (isLeft(validationResult)) {
    return validationResult as Either<MachineError, EntityMachine>;
  }
  return executeCommand(machine, message);
};

// Command validation
const validateCommand = async (
  machine: EntityMachine,
  message: Message<EntityCommand>
): Promise<Either<MachineError, void>> => {
  try {
    switch (message.payload.type) {
      case 'PROPOSE_TRANSACTION':
        return await validateProposedTransaction(machine, message.payload.transaction);
        
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
const validateProposedTransaction = async (
  machine: EntityMachine,
  transaction: SignedTransaction
): Promise<Either<MachineError, void>> => {
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
  const messageHash = computeTransactionHash(transaction);
  let totalWeight = 0;
  const errors = Map<string, MachineError>().asMutable();

  // Verify each signature
  for (const [signer, weight] of config.signers) {
    const signature = transaction.partialSignatures.get(signer);
    if (!signature) {
      errors.set(signer, createMachineError(
        'INVALID_OPERATION',
        'Missing signature from signer'
      ));
      continue;
    }

    const result = await verifyEcdsaSignature(messageHash, signature, signer);
    if (isLeft(result)) {
      errors.set(signer, result.left);
    } else if (result.right) {
      totalWeight += weight;
    } else {
      errors.set(signer, createMachineError(
        'INVALID_OPERATION',
        'Invalid signature'
      ));
    }
  }

  if (totalWeight < config.threshold) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Insufficient valid signatures',
      { 
        totalWeight,
        threshold: config.threshold,
        errors: errors.asImmutable()
      }
    ));
  }

  return right(undefined);
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
): Either<MachineError, boolean> => {
  try {
    const messageBuffer = Buffer.from(message);
    return verifyEcdsaSignature(messageBuffer, signature, publicKey);
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to verify signature',
      error
    ));
  }
};

// Command execution
const executeCommand = (
  machine: EntityMachine,
  message: Message<EntityCommand>
): Either<MachineError, EntityMachine> => {
  try {
    return pipe(
      processEntityCommand(machine.state, message),
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
const processEntityCommand = (
  state: EntityState,
  message: Message<EntityCommand>
): Either<MachineError, EntityState> => {
  const data = state.get('data') as EntityStateData;
  if (!data) {
    return left(createMachineError('INVALID_STATE', 'No entity data'));
  }

  switch (message.payload.type) {
    case 'PROPOSE_TRANSACTION': {
      const proposal = createProposal(
        message.sender,
        'TRANSACTION',
        message.payload.transaction
      );

      return right(state.set('data', {
        ...data,
        proposals: data.proposals.set(proposal.id, proposal)
      }));
    }

    case 'APPROVE_PROPOSAL': {
      const { proposalId } = message.payload;
      const proposal = data.proposals.get(proposalId);

      if (!proposal || proposal.status !== 'ACTIVE') {
        return left(createMachineError('INVALID_PROPOSAL', 'Proposal not found or not active'));
      }

      // Update approvals
      const updatedProposal = {
        ...proposal,
        approvals: proposal.approvals.set(message.sender, true)
      };

      let newState = state.set('data', {
        ...data,
        proposals: data.proposals.set(proposalId, updatedProposal)
      });

      // Check if threshold is met
      const { isThresholdMet } = checkProposalThreshold(updatedProposal, data.config);
      if (isThresholdMet) {
        return executeProposal(newState, proposalId);
      }

      return right(newState);
    }

    case 'CANCEL_PROPOSAL': {
      const { proposalId } = message.payload;
      const proposal = data.proposals.get(proposalId);

      if (!proposal || proposal.status !== 'ACTIVE') {
        return left(createMachineError('INVALID_PROPOSAL', 'Proposal not found or not active'));
      }

      // Only proposer or admin can cancel
      if (message.sender !== proposal.proposer && !data.config.admins?.includes(message.sender)) {
        return left(createMachineError('UNAUTHORIZED', 'Only proposer or admin can cancel'));
      }

      return right(state.set('data', {
        ...data,
        proposals: data.proposals.set(proposalId, {
          ...proposal,
          status: 'CANCELLED'
        })
      }));
    }

    case 'UPDATE_CONFIG': {
      const newState = updateConfig(state, message.payload.newConfig);
      return right(newState);
    }
      
    case 'OPEN_CHANNEL': {
      const newState = openChannel(state, message.payload.partnerId);
      return right(newState);
    }
      
    case 'CLOSE_CHANNEL': {
      const newState = closeChannel(state, message.payload.channelId);
      return right(newState);
    }
      
    default:
      return right(state);
  }
};

// Transaction processing
const processTransaction = (
  state: EntityState,
  transaction: SignedTransaction
): Either<MachineError, EntityState> => {
  const data = state.get('data') as EntityStateData;
  if (!data) {
    return left(createMachineError('INVALID_STATE', 'No entity data'));
  }

  // Update nonce
  const newData = {
    ...data,
    nonce: data.nonce + 1
  };

  // Process transaction based on type
  switch (transaction.type) {
    case 'TRANSFER': {
      const amount = (transaction.payload as { amount: bigint }).amount;
      return right(state.set('data', {
        ...newData,
        balance: data.balance - amount
      }));
    }
      
    case 'CHANNEL_UPDATE': {
      const { channelId, newHash } = transaction.payload as { 
        channelId: string; 
        newHash: BlockHash 
      };
      return right(state.set('data', {
        ...newData,
        channels: data.channels.set(channelId, newHash)
      }));
    }
      
    case 'CONFIG_UPDATE': {
      const newConfig = transaction.payload as EntityConfig;
      return right(state.set('data', {
        ...newData,
        config: newConfig
      }));
    }
      
    case 'STATE_UPDATE': {
      const { balance } = transaction.payload as { balance: bigint };
      return right(state.set('data', {
        ...newData,
        balance
      }));
    }
      
    default:
      return right(state.set('data', newData));
  }
};

// Config update processing
const updateConfig = (
  state: EntityState,
  newConfig: EntityConfig
): EntityState => {
  const data = state.get('data') as EntityStateData;
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
  const data = state.get('data') as EntityStateData;
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
  const data = state.get('data') as EntityStateData;
  return state.set('data', {
    ...data,
    channels: data.channels.remove(channelId),
    nonce: data.nonce + 1
  });
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
  version: 1,
  stateRoot: createHash('sha256').update(JSON.stringify(transaction)).digest('hex')
});

export const generateChannelEvent = (
  channelId: string,
  partnerId: string,
  isOpening: boolean = true,
  finalBalances?: Map<MachineId, bigint>
): Event => 
  isOpening 
    ? { type: 'CHANNEL_OPENED' as const, channelId }
    : { 
        type: 'CHANNEL_CLOSED' as const, 
        channelId,
        finalBalances: finalBalances || Map<MachineId, bigint>()
      };

// Helper function to apply channel settlement
const applyChannelSettlement = (
  state: EntityState,
  channelId: string,
  finalBalances: Map<MachineId, bigint>
): EntityState => {
  const data = state.get('data') as EntityStateData;

  // Remove channel from tracking
  const updatedChannels = data.channels.remove(channelId);

  // Apply final balance for this entity
  const myBalance = finalBalances.get(channelId) || BigInt(0);
  
  return state.set('data', {
    ...data,
    channels: updatedChannels,
    balance: data.balance + myBalance,
    nonce: data.nonce + 1
  });
};

// Helper function to compute state hash
const computeStateHash = (state: EntityState): Either<MachineError, BlockHash> => {
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