# Working with Payment Channels

This tutorial demonstrates how to create and operate payment channels between entities, including opening channels, making off-chain payments, and handling disputes.

## Prerequisites

- Completed the [Creating Signers and Entities](./signer-entity.md) tutorial
- Understanding of state channels and off-chain payments
- Familiarity with the actor model

## Channel Lifecycle

Payment channels follow this lifecycle:
1. **OPEN**: Channel is created and funded
2. **ACTIVE**: Parties exchange signed state updates
3. **DISPUTED** (optional): Parties resolve conflicts
4. **CLOSED**: Final state is settled on-chain

## Step 1: Create Channel Participants

First, set up two entities that will participate in the channel:

```typescript
import { 
  SignerMachineImpl,
  CentralEventBus,
  KeyStorage,
  createEntityMachine,
  EntityConfig,
  Map
} from '@xxxln/core';

// Initialize key storage and event bus
const keyStorage = new Map<string, string>();
keyStorage.set('alice', 'test_key_alice');
keyStorage.set('bob', 'test_key_bob');
KeyStorage.initialize(keyStorage);

const eventBus = new CentralEventBus();

// Create signers
const aliceSigner = new SignerMachineImpl('alice', eventBus, 'server1');
const bobSigner = new SignerMachineImpl('bob', eventBus, 'server1');

// Create entities
const aliceConfig: EntityConfig = {
  threshold: 1,
  signers: Map({ 'alice': 1 })
};

const bobConfig: EntityConfig = {
  threshold: 1,
  signers: Map({ 'bob': 1 })
};

const aliceEntityResult = await createEntityMachine(
  'alice_entity',
  'server1',
  aliceConfig,
  eventBus
);

const bobEntityResult = await createEntityMachine(
  'bob_entity',
  'server1',
  bobConfig,
  eventBus
);

if (aliceEntityResult._tag === 'Left' || bobEntityResult._tag === 'Left') {
  throw new Error('Failed to create entities');
}

const aliceEntity = aliceEntityResult.right;
const bobEntity = bobEntityResult.right;
```

## Step 2: Open a Channel

Create a payment channel between the entities:

```typescript
import { 
  ChannelMachine,
  createChannelMachine,
  Message
} from '@xxxln/core';

// Create channel configuration
const channelConfig = {
  participants: [aliceEntity.id, bobEntity.id] as [string, string],
  initialBalances: Map({
    [aliceEntity.id]: BigInt(100), // Alice deposits 100
    [bobEntity.id]: BigInt(100)    // Bob deposits 100
  }),
  disputePeriod: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
};

// Create channel machine
const channelResult = await createChannelMachine(
  `channel_${aliceEntity.id}_${bobEntity.id}`,
  channelConfig.participants,
  channelConfig.initialBalances
);

if (channelResult._tag === 'Left') {
  throw new Error('Failed to create channel');
}

const channel = channelResult.right;

// Register channel with event bus
eventBus.registerMachine(channel);
```

## Step 3: Make Off-Chain Payments

Exchange signed state updates between parties:

```typescript
// Create a state update (Alice sends 10 to Bob)
const stateUpdate = {
  sequence: 1,
  balances: Map({
    [aliceEntity.id]: BigInt(90),  // Alice now has 90
    [bobEntity.id]: BigInt(110)    // Bob now has 110
  }),
  timestamp: Date.now()
};

// Alice signs and sends the update
const updateMessage: Message = {
  id: `update_${Date.now()}`,
  type: 'COMMAND',
  payload: {
    type: 'UPDATE_BALANCE',
    balances: [
      [aliceEntity.id, BigInt(90)],
      [bobEntity.id, BigInt(110)]
    ]
  },
  timestamp: Date.now(),
  sender: aliceEntity.id,
  recipient: channel.id
};

await channel.handleEvent(updateMessage);

// Bob acknowledges and signs
const acknowledgement: Message = {
  id: `ack_${Date.now()}`,
  type: 'COMMAND',
  payload: {
    type: 'UPDATE_BALANCE',
    balances: [
      [aliceEntity.id, BigInt(90)],
      [bobEntity.id, BigInt(110)]
    ]
  },
  timestamp: Date.now(),
  sender: bobEntity.id,
  recipient: channel.id
};

await channel.handleEvent(acknowledgement);
```

## Step 4: Handle Disputes

If there's a disagreement, either party can initiate a dispute:

```typescript
// Alice initiates a dispute
const disputeMessage: Message = {
  id: `dispute_${Date.now()}`,
  type: 'COMMAND',
  payload: {
    type: 'INITIATE_DISPUTE',
    evidence: {
      sequence: 1,
      balances: Map({
        [aliceEntity.id]: BigInt(90),
        [bobEntity.id]: BigInt(110)
      }),
      timestamp: Date.now(),
      signatures: Map({
        [aliceEntity.id]: 'alice_signature',
        [bobEntity.id]: 'bob_signature'
      }),
      stateHash: 'hash_of_state'
    }
  },
  timestamp: Date.now(),
  sender: aliceEntity.id,
  recipient: channel.id
};

await channel.handleEvent(disputeMessage);

// Bob responds with evidence
const evidenceMessage: Message = {
  id: `evidence_${Date.now()}`,
  type: 'COMMAND',
  payload: {
    type: 'RESOLVE_DISPUTE',
    evidence: {
      sequence: 1,
      balances: Map({
        [aliceEntity.id]: BigInt(90),
        [bobEntity.id]: BigInt(110)
      }),
      timestamp: Date.now(),
      signatures: Map({
        [aliceEntity.id]: 'alice_signature',
        [bobEntity.id]: 'bob_signature'
      }),
      stateHash: 'hash_of_state'
    }
  },
  timestamp: Date.now(),
  sender: bobEntity.id,
  recipient: channel.id
};

await channel.handleEvent(evidenceMessage);
```

## Step 5: Close the Channel

When both parties agree, close the channel:

```typescript
// Finalize settlement
const settlementMessage: Message = {
  id: `settle_${Date.now()}`,
  type: 'COMMAND',
  payload: {
    type: 'FINALIZE_SETTLEMENT',
    finalBalances: Map({
      [aliceEntity.id]: BigInt(90),
      [bobEntity.id]: BigInt(110)
    })
  },
  timestamp: Date.now(),
  sender: aliceEntity.id,
  recipient: channel.id
};

await channel.handleEvent(settlementMessage);

// Close channel
const closeMessage: Message = {
  id: `close_${Date.now()}`,
  type: 'COMMAND',
  payload: {
    type: 'CLOSE_CHANNEL'
  },
  timestamp: Date.now(),
  sender: aliceEntity.id,
  recipient: channel.id
};

await channel.handleEvent(closeMessage);
```

## Complete Example

Here's a complete script demonstrating the channel lifecycle:

```typescript
import { 
  SignerMachineImpl,
  CentralEventBus,
  KeyStorage,
  createEntityMachine,
  createChannelMachine,
  EntityConfig,
  Map,
  Message
} from '@xxxln/core';

async function main() {
  // Setup key storage and event bus
  const keyStorage = new Map<string, string>();
  keyStorage.set('alice', 'test_key_alice');
  keyStorage.set('bob', 'test_key_bob');
  KeyStorage.initialize(keyStorage);

  const eventBus = new CentralEventBus();

  // Create entities
  const aliceConfig: EntityConfig = {
    threshold: 1,
    signers: Map({ 'alice': 1 })
  };

  const bobConfig: EntityConfig = {
    threshold: 1,
    signers: Map({ 'bob': 1 })
  };

  const [aliceEntity, bobEntity] = await Promise.all([
    createEntityMachine('alice_entity', 'server1', aliceConfig, eventBus),
    createEntityMachine('bob_entity', 'server1', bobConfig, eventBus)
  ]).then(([a, b]) => {
    if (a._tag === 'Left' || b._tag === 'Left') {
      throw new Error('Failed to create entities');
    }
    return [a.right, b.right];
  });

  // Create channel
  const channelResult = await createChannelMachine(
    `channel_${aliceEntity.id}_${bobEntity.id}`,
    [aliceEntity.id, bobEntity.id],
    Map({
      [aliceEntity.id]: BigInt(100),
      [bobEntity.id]: BigInt(100)
    })
  );

  if (channelResult._tag === 'Left') {
    throw new Error('Failed to create channel');
  }

  const channel = channelResult.right;
  eventBus.registerMachine(channel);

  // Monitor channel events
  eventBus.subscribe('CHANNEL_OPENED', console.log);
  eventBus.subscribe('STATE_UPDATED', console.log);
  eventBus.subscribe('DISPUTE_INITIATED', console.log);
  eventBus.subscribe('DISPUTE_RESOLVED', console.log);
  eventBus.subscribe('CHANNEL_CLOSED', console.log);

  // Make a payment
  const payment: Message = {
    id: `payment_${Date.now()}`,
    type: 'COMMAND',
    payload: {
      type: 'UPDATE_BALANCE',
      balances: [
        [aliceEntity.id, BigInt(90)],
        [bobEntity.id, BigInt(110)]
      ]
    },
    timestamp: Date.now(),
    sender: aliceEntity.id,
    recipient: channel.id
  };

  await channel.handleEvent(payment);

  // Close channel
  const close: Message = {
    id: `close_${Date.now()}`,
    type: 'COMMAND',
    payload: {
      type: 'CLOSE_CHANNEL'
    },
    timestamp: Date.now(),
    sender: aliceEntity.id,
    recipient: channel.id
  };

  await channel.handleEvent(close);
}

main().catch(console.error);
```

## Next Steps

- Learn about [State Management](../implementation/state-management.md)
- Explore [Network Protocols](../architecture/protocols.md)
- Read about [Channel Implementation](../implementation/channels.md)

## Common Issues

1. **State Update Failures**
   - Verify sequence numbers are monotonically increasing
   - Ensure all required signatures are present
   - Check balance arithmetic is correct

2. **Dispute Resolution**
   - Submit evidence within the dispute period
   - Provide valid signatures from both parties
   - Ensure state updates are properly ordered

3. **Channel Closure**
   - Wait for all pending operations to complete
   - Verify final balances match expectations
   - Ensure both parties agree to closure

For more details on channel operations and error handling, see the [Channel Implementation](../implementation/channels.md) documentation. 