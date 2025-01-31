import { Either, left, right, chain, map } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, createMachineError, MachineId, MachineEvent } from '../types/Core';
import { 
  ChannelMachine, 
  ChannelState,
  BlockHash,
  SignatureData,
  PublicKey,
  StateUpdate,
  SignedStateUpdate,
  DisputeState
} from '../types/MachineTypes';
import { ChannelCommand } from '../types/Messages';
import { ActorMachine } from '../eventbus/BaseMachine';
import { EventBus } from '../eventbus/EventBus';
import { verifyEcdsaSignature } from '../crypto/EcdsaSignatures';

// State types
type DisputeStatus = 
  | 'NONE' 
  | 'INITIATED' 
  | 'EVIDENCE_SUBMITTED' 
  | 'CHALLENGE_PERIOD'
  | 'RESOLVED' 
  | 'TIMED_OUT';

type DisputeEvidence = {
  readonly stateUpdate: SignedStateUpdate;
  readonly timestamp: number;
  readonly challengeProof?: {
    readonly previousUpdate: SignedStateUpdate;
    readonly maliciousProof: string;
  };
};

type DisputeData = {
  readonly status: DisputeStatus;
  readonly initiator: MachineId;
  readonly startTime: number;
  readonly timeout: number;
  readonly evidence: Map<MachineId, DisputeEvidence>;
  readonly challengePeriodEnd?: number;
  readonly penalties: Map<MachineId, bigint>;
  readonly resolutionVotes: Map<MachineId, boolean>;
  readonly automaticResolutionTime: number;
};

type ChannelData = {
  readonly participants: [MachineId, MachineId];
  readonly balances: Map<MachineId, bigint>;
  readonly sequence: number;
  readonly isOpen: boolean;
  readonly disputePeriod: number;
  readonly stateUpdates: Map<number, SignedStateUpdate>;
  readonly dispute?: DisputeData;
};

// State management
export const createChannelState = (
  participants: [MachineId, MachineId],
  initialBalances: Map<MachineId, bigint>,
  disputePeriod: number = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
): ChannelState => Map<string, ChannelData>().set('data', {
  participants,
  balances: initialBalances,
  sequence: 0,
  isOpen: true,
  disputePeriod,
  stateUpdates: Map()
});

// State verification
const verifyStateUpdate = (
  currentState: ChannelState,
  update: SignedStateUpdate
): Either<MachineError, void> => {
  const data = currentState.get('data') as ChannelData;
  if (!data) {
    return left(createMachineError(
      'INVALID_STATE',
      'Channel state must contain data object'
    ));
  }

  // Verify sequence number
  if (update.sequence <= data.sequence) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'State update sequence must be greater than current sequence'
    ));
  }

  // Verify state hash
  const computedHash = computeStateHash(update);
  if (computedHash !== update.stateHash) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Invalid state hash'
    ));
  }

  // Verify all participants have signed
  for (const participant of data.participants) {
    const signature = update.signatures.get(participant);
    if (!signature) {
      return left(createMachineError(
        'INVALID_OPERATION',
        'Missing signature from participant',
        { participant }
      ));
    }

    if (!verifySignature(update.stateHash, signature, participant)) {
      return left(createMachineError(
        'INVALID_OPERATION',
        'Invalid signature',
        { participant }
      ));
    }
  }

  return right(undefined);
};

const computeStateHash = (update: StateUpdate): BlockHash => {
  const data = {
    sequence: update.sequence,
    balances: Array.from(update.balances.entries())
      .sort(([a], [b]) => a.localeCompare(b)),
    timestamp: update.timestamp
  };
  return createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
};

const verifySignature = (
  message: string,
  signature: SignatureData,
  publicKey: MachineId
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

// Channel machine creation
export const createChannelMachine = (
  id: string,
  participants: [MachineId, MachineId],
  initialBalances: Map<MachineId, bigint>,
  initialState: ChannelState = createChannelState(participants, initialBalances)
): Either<MachineError, ChannelMachine> => 
  pipe(
    validateChannelState(initialState),
    map(() => ({
      id,
      type: 'CHANNEL' as const,
      state: initialState,
      version: 1,
      parentIds: participants
    }))
  );

// State validation
const validateChannelState = (state: ChannelState): Either<MachineError, void> => {
  const data = state.get('data');
  if (!data || typeof data !== 'object') {
    return left(createMachineError(
      'INVALID_STATE',
      'Channel state must contain data object'
    ));
  }

  const channelData = data as {
    participants: [MachineId, MachineId];
    balances: Map<MachineId, bigint>;
    sequence: number;
    isOpen: boolean;
    disputePeriod: number;
  };

  // Validate participants
  if (!channelData.participants || channelData.participants.length !== 2) {
    return left(createMachineError(
      'INVALID_STATE',
      'Channel must have exactly two participants'
    ));
  }

  // Validate balances
  if (!channelData.balances || channelData.balances.size !== 2) {
    return left(createMachineError(
      'INVALID_STATE',
      'Channel balances must match participant count'
    ));
  }

  // Validate all balances are non-negative
  const hasNegativeBalance = Array.from(channelData.balances.values()).some(balance => balance < BigInt(0));
  if (hasNegativeBalance) {
    return left(createMachineError(
      'INVALID_STATE',
      'Channel balances cannot be negative'
    ));
  }

  return right(undefined);
};

// Command processing
export const processCommand = (
  machine: ChannelMachine,
  message: Message<ChannelCommand>
): Either<MachineError, ChannelMachine> =>
  pipe(
    validateCommand(machine, message),
    chain(() => executeCommand(machine, message))
  );

// Command validation
const validateCommand = (
  machine: ChannelMachine,
  message: Message<ChannelCommand>
): Either<MachineError, void> => {
  try {
    switch (message.payload.type) {
      case 'UPDATE_BALANCE':
        return validateBalanceUpdate(machine, message.payload.balances);
        
      case 'INITIATE_DISPUTE':
        return validateDisputeInitiation(machine, message.payload.evidence);
        
      case 'RESOLVE_DISPUTE':
        return validateDisputeResolution(machine, message.payload.evidence);
        
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

// Balance update validation
const validateBalanceUpdate = (
  machine: ChannelMachine,
  newBalances: Array<[MachineId, bigint]>
): Either<MachineError, void> => {
  const data = machine.state.get('data') as ChannelData;
  if (!data) {
    return left(createMachineError(
      'INVALID_STATE',
      'Channel state must contain data object'
    ));
  }

  // Check channel is open
  if (!data.isOpen) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Cannot update balances of closed channel'
    ));
  }

  // Convert array to Map for easier processing
  const newBalancesMap = Map(newBalances);

  // Verify all participants are accounted for
  if (newBalancesMap.size !== data.participants.length) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'New balances must include all participants'
    ));
  }

  // Verify balances are non-negative
  const hasNegativeBalance = Array.from(newBalancesMap.values())
    .some(balance => balance < BigInt(0));
  if (hasNegativeBalance) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Channel balances cannot be negative'
    ));
  }

  // Verify total balance remains unchanged
  const currentTotal = Array.from(data.balances.values())
    .reduce((sum: bigint, balance: bigint) => sum + balance, BigInt(0));
  const newTotal = Array.from(newBalancesMap.values())
    .reduce((sum: bigint, balance: bigint) => sum + balance, BigInt(0));
  
  if (currentTotal !== newTotal) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Total channel balance must remain unchanged'
    ));
  }

  // Create state update
  const stateUpdate: StateUpdate = {
    sequence: data.sequence + 1,
    balances: newBalancesMap,
    timestamp: Date.now()
  };

  // Create signed state update
  const signedUpdate: SignedStateUpdate = {
    ...stateUpdate,
    signatures: Map(),
    stateHash: computeStateHash(stateUpdate)
  };

  return verifyStateUpdate(machine.state, signedUpdate);
};

// Dispute validation
const validateDisputeInitiation = (
  machine: ChannelMachine,
  evidence?: SignedStateUpdate
): Either<MachineError, void> => {
  const data = machine.state.get('data') as ChannelData;
  if (!data) {
    return left(createMachineError(
      'INVALID_STATE',
      'Channel state must contain data object'
    ));
  }

  // Check channel is open
  if (!data.isOpen) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Cannot initiate dispute on closed channel'
    ));
  }

  // Check if dispute already exists
  if (data.dispute) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Dispute already exists'
    ));
  }

  // If no evidence provided, just validate the dispute can be initiated
  if (!evidence) {
    return right(undefined);
  }

  // Verify evidence state update
  return verifyStateUpdate(machine.state, evidence);
};

const validateDisputeResolution = (
  machine: ChannelMachine,
  evidence: SignedStateUpdate
): Either<MachineError, void> => {
  const data = machine.state.get('data') as ChannelData;
  if (!data) {
    return left(createMachineError(
      'INVALID_STATE',
      'Channel state must contain data object'
    ));
  }

  // Check channel is open
  if (!data.isOpen) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Cannot resolve dispute on closed channel'
    ));
  }

  // Check if dispute exists
  if (!data.dispute) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'No active dispute to resolve'
    ));
  }

  // Check if dispute timeout has passed
  const now = Date.now();
  if (now >= data.dispute.startTime + data.dispute.timeout) {
    return left(createMachineError(
      'INVALID_OPERATION',
      'Dispute timeout has passed'
    ));
  }

  // Verify evidence
  return verifyStateUpdate(machine.state, evidence);
};

// Command execution
const executeCommand = (
  machine: ChannelMachine,
  message: Message<ChannelCommand>
): Either<MachineError, ChannelMachine> => {
  try {
    const newState = processChannelCommand(machine.state, message);
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
const processChannelCommand = (
  state: ChannelState,
  message: Message<ChannelCommand>
): ChannelState => {
  const data = state.get('data') as ChannelData;
  
  switch (message.payload.type) {
    case 'UPDATE_BALANCE': {
      // Only allow updates if no active dispute
      if (data.dispute) {
        return state;
      }

      const stateUpdate: StateUpdate = {
        sequence: data.sequence + 1,
        balances: Map(message.payload.balances),
        timestamp: Date.now()
      };

      const signedUpdate: SignedStateUpdate = {
        ...stateUpdate,
        signatures: Map(),
        stateHash: computeStateHash(stateUpdate)
      };

      return state.set('data', {
        ...data,
        balances: signedUpdate.balances,
        sequence: signedUpdate.sequence,
        stateUpdates: data.stateUpdates.set(signedUpdate.sequence, signedUpdate)
      });
    }
      
    case 'INITIATE_DISPUTE': {
      const now = Date.now();
      const initialEvidence = Map<MachineId, DisputeEvidence>();
      const disputeData: DisputeData = {
        status: 'INITIATED',
        initiator: message.sender,
        startTime: now,
        timeout: data.disputePeriod,
        evidence: message.payload.evidence 
          ? initialEvidence.set(message.sender, {
              stateUpdate: message.payload.evidence,
              timestamp: now
            })
          : initialEvidence,
        penalties: Map<MachineId, bigint>(),
        resolutionVotes: Map<MachineId, boolean>(),
        automaticResolutionTime: now + data.disputePeriod
      };

      return state.set('data', {
        ...data,
        dispute: disputeData,
        sequence: data.sequence + 1
      });
    }
      
    case 'RESOLVE_DISPUTE': {
      if (!data.dispute) {
        return state;
      }

      // Add evidence
      const updatedEvidence = data.dispute.evidence.set(
        message.sender,
        {
          stateUpdate: message.payload.evidence,
          timestamp: Date.now()
        }
      );

      // Check if all participants have submitted evidence
      const allEvidenceSubmitted = data.participants.every(
        participant => updatedEvidence.has(participant)
      );

      if (allEvidenceSubmitted) {
        // Find latest valid state update from evidence
        const evidenceArray = Array.from(updatedEvidence.values());
        if (evidenceArray.length === 0) {
          return state;
        }

        const updates = evidenceArray
          .map(e => e.stateUpdate)
          .sort((a, b) => b.sequence - a.sequence);
        
        const latestUpdate = updates[0];
        if (!latestUpdate) {
          return state;
        }

        // Apply latest state and mark dispute as resolved
        const resolvedState = state.set('data', {
          ...data,
          dispute: {
            ...data.dispute,
            status: 'RESOLVED',
            evidence: updatedEvidence
          },
          balances: latestUpdate.balances,
          sequence: latestUpdate.sequence,
          stateUpdates: data.stateUpdates.set(latestUpdate.sequence, latestUpdate)
        });

        // Automatically trigger settlement finalization
        return processChannelCommand(
          resolvedState,
          {
            id: `settle_${Date.now()}`,
            type: 'FINALIZE_SETTLEMENT',
            payload: {
              type: 'FINALIZE_SETTLEMENT',
              finalBalances: latestUpdate.balances
            },
            sender: message.sender,
            recipient: message.recipient,
            timestamp: Date.now()
          }
        );
      }

      // Update dispute with new evidence
      return state.set('data', {
        ...data,
        dispute: {
          ...data.dispute,
          evidence: updatedEvidence,
          status: 'EVIDENCE_SUBMITTED'
        },
        sequence: data.sequence + 1
      });
    }

    case 'FINALIZE_SETTLEMENT': {
      // Apply final balances and prepare for closure
      const finalBalances = message.payload.finalBalances;
      
      // Verify all participants are accounted for
      if (!data.participants.every(p => finalBalances.has(p))) {
        return state;
      }

      // Verify total balance remains unchanged
      const currentTotal = Array.from(data.balances.values())
        .reduce((sum, balance) => sum + balance, BigInt(0));
      const finalTotal = Array.from(finalBalances.values())
        .reduce((sum, balance) => sum + balance, BigInt(0));
      
      if (currentTotal !== finalTotal) {
        return state;
      }

      return state.set('data', {
        ...data,
        balances: finalBalances,
        dispute: undefined,
        sequence: data.sequence + 1
      });
    }

    case 'CLOSE_CHANNEL': {
      // Only allow closure if:
      // 1. No active dispute (or dispute is resolved)
      // 2. Both participants have agreed (via signatures)
      // 3. Or if there's a finalized settlement
      if (data.dispute && data.dispute.status !== 'RESOLVED') {
        return state;
      }

      return state.set('data', {
        ...data,
        isOpen: false,
        dispute: undefined,
        sequence: data.sequence + 1
      });
    }
      
    default:
      return state;
  }
};

// Add new dispute resolution functions
const processDisputeTimeout = (
  data: ChannelData,
  currentTime: number
): Either<MachineError, ChannelData> => {
  if (!data.dispute) {
    return right(data);
  }

  // Check if dispute has timed out
  if (currentTime >= data.dispute.automaticResolutionTime) {
    // Apply penalties to non-responsive participants
    const penalties = computeDisputePenalties(data);
    
    // Update balances with penalties
    const newBalances = applyPenalties(data.balances, penalties);

    return right({
      ...data,
      dispute: {
        ...data.dispute,
        status: 'TIMED_OUT',
        penalties
      },
      balances: newBalances
    });
  }

  return right(data);
};

const computeDisputePenalties = (data: ChannelData): Map<MachineId, bigint> => {
  if (!data.dispute) {
    return Map();
  }

  const penalties = Map<MachineId, bigint>().asMutable();
  
  // Calculate penalties for each participant
  for (const participant of data.participants) {
    if (!data.dispute.evidence.has(participant)) {
      // Penalize non-responsive participants
      const currentBalance = data.balances.get(participant) || BigInt(0);
      penalties.set(participant, currentBalance / BigInt(10)); // 10% penalty
    }
  }

  return penalties.asImmutable();
};

const applyPenalties = (
  balances: Map<MachineId, bigint>,
  penalties: Map<MachineId, bigint>
): Map<MachineId, bigint> => {
  let newBalances = balances;
  let totalPenalties = BigInt(0);

  // Apply penalties
  for (const [participant, penalty] of penalties) {
    const currentBalance = newBalances.get(participant) || BigInt(0);
    newBalances = newBalances.set(participant, currentBalance - penalty);
    totalPenalties += penalty;
  }

  // Distribute penalties to honest participants
  const honestParticipants = Array.from(balances.keys())
    .filter(p => !penalties.has(p));

  if (honestParticipants.length > 0) {
    const rewardPerParticipant = totalPenalties / BigInt(honestParticipants.length);
    for (const participant of honestParticipants) {
      const currentBalance = newBalances.get(participant) || BigInt(0);
      newBalances = newBalances.set(participant, currentBalance + rewardPerParticipant);
    }
  }

  return newBalances;
};

// Event-driven channel machine
export class ChannelMachineImpl extends ActorMachine implements ChannelMachine {
  public readonly type = 'CHANNEL' as const;
  private _state: ChannelState;
  private _version: number;
  public readonly parentIds: [MachineId, MachineId];

  constructor(
    id: string,
    parentIds: [MachineId, MachineId],
    eventBus: EventBus,
    initialState: ChannelState
  ) {
    super(id, eventBus);
    this.parentIds = parentIds;
    this._state = initialState;
    this._version = 1;
  }

  // Implement readonly properties
  get state(): ChannelState {
    return this._state;
  }

  get version(): number {
    return this._version;
  }

  // Handle incoming events
  async handleEvent(event: MachineEvent): Promise<Either<MachineError, void>> {
    try {
      const message = event as Message<ChannelCommand>;
      const result = await processCommand(this, message);
      return pipe(
        result,
        map(() => undefined)
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