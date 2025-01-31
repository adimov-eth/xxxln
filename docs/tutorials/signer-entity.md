# Creating Signers and Entities

This tutorial demonstrates how to create and work with SignerMachines and EntityMachines, including setting up multi-signature transactions.

## Prerequisites

- Completed the [Local Network](./local-network.md) tutorial
- Understanding of the actor model and state machines
- Familiarity with functional programming concepts

## Overview

In this tutorial, you'll learn how to:
1. Create a SignerMachine
2. Create an EntityMachine
3. Link signers to entities
4. Propose and approve transactions
5. Monitor state changes

## Step 1: Create a SignerMachine

First, let's create a signer with its own key pair:

```typescript
import { 
  SignerMachineImpl,
  CentralEventBus,
  KeyStorage,
  createMachineError
} from '@xxxln/core';

// Initialize key storage
const keyStorage = new Map<string, string>();
keyStorage.set('signer1', 'test_private_key_1');
keyStorage.set('signer2', 'test_private_key_2');
KeyStorage.initialize(keyStorage);

// Create event bus
const eventBus = new CentralEventBus();

// Create signer machine
const signer1 = new SignerMachineImpl(
  'signer1',
  eventBus,
  'server1' // parent server ID
);

const signer2 = new SignerMachineImpl(
  'signer2',
  eventBus,
  'server1'
);
```

## Step 2: Create an EntityMachine

Now create an entity that will be controlled by these signers:

```typescript
import { 
  createEntityMachine,
  EntityConfig,
  Map
} from '@xxxln/core';

// Define entity configuration
const entityConfig: EntityConfig = {
  threshold: 2, // Requires 2 signatures
  signers: Map({
    'signer1': 1, // Weight of 1
    'signer2': 1  // Weight of 1
  }),
  admins: ['signer1'] // Optional admin list
};

// Create entity machine
const entityResult = createEntityMachine(
  'entity1',
  'server1',
  entityConfig,
  eventBus
);

if (entityResult._tag === 'Left') {
  console.error('Failed to create entity:', entityResult.left);
  process.exit(1);
}

const entity = entityResult.right;
```

## Step 3: Link Components

Connect the signers to the entity and register everything with the event bus:

```typescript
import {
  connectSignerToEntity,
  registerEntityOnEventBus
} from '@xxxln/core';

// Connect signers to entity
const connection1 = connectSignerToEntity(entity, signer1, 1);
if (connection1._tag === 'Left') {
  console.error('Failed to connect signer1:', connection1.left);
  process.exit(1);
}

const connection2 = connectSignerToEntity(entity, signer2, 1);
if (connection2._tag === 'Left') {
  console.error('Failed to connect signer2:', connection2.left);
  process.exit(1);
}

// Register entity on event bus
const registration = registerEntityOnEventBus(eventBus, entity);
if (registration._tag === 'Left') {
  console.error('Failed to register entity:', registration.left);
  process.exit(1);
}
```

## Step 4: Propose a Transaction

Create and propose a multi-sig transaction:

```typescript
import { Message, Transaction } from '@xxxln/core';

// Create transaction
const transaction: Transaction = {
  type: 'TRANSFER',
  nonce: Date.now(),
  sender: entity.id,
  payload: {
    amount: 100,
    recipient: 'account2'
  },
  timestamp: Date.now(),
  metadata: {
    chainId: 'local',
    validFrom: Date.now(),
    validUntil: Date.now() + 3600000,
    gasLimit: BigInt(21000),
    maxFeePerGas: BigInt(1000000000)
  }
};

// Create proposal message
const proposalMessage: Message = {
  id: `proposal_${Date.now()}`,
  type: 'COMMAND',
  payload: {
    type: 'PROPOSE_TRANSACTION',
    transaction
  },
  timestamp: Date.now(),
  sender: signer1.id,
  recipient: entity.id
};

// Submit proposal
await entity.handleEvent(proposalMessage);
```

## Step 5: Approve the Transaction

Have the second signer approve the transaction:

```typescript
// Create approval message
const approvalMessage: Message = {
  id: `approval_${Date.now()}`,
  type: 'COMMAND',
  payload: {
    type: 'APPROVE_PROPOSAL',
    proposalId: proposalMessage.id
  },
  timestamp: Date.now(),
  sender: signer2.id,
  recipient: entity.id
};

// Submit approval
await entity.handleEvent(approvalMessage);
```

## Step 6: Monitor State Changes

Subscribe to entity events to monitor the transaction lifecycle:

```typescript
eventBus.subscribe('PROPOSAL_CREATED', event => {
  console.log('New proposal created:', event);
});

eventBus.subscribe('PROPOSAL_APPROVED', event => {
  console.log('Proposal approved:', event);
});

eventBus.subscribe('PROPOSAL_EXECUTED', event => {
  console.log('Proposal executed:', event);
});
```

## Complete Example

Here's a complete script that puts it all together:

```typescript
import { 
  SignerMachineImpl,
  CentralEventBus,
  KeyStorage,
  createEntityMachine,
  EntityConfig,
  Map,
  connectSignerToEntity,
  registerEntityOnEventBus
} from '@xxxln/core';

async function main() {
  // Initialize key storage
  const keyStorage = new Map<string, string>();
  keyStorage.set('signer1', 'test_private_key_1');
  keyStorage.set('signer2', 'test_private_key_2');
  KeyStorage.initialize(keyStorage);

  // Create event bus
  const eventBus = new CentralEventBus();

  // Create signers
  const signer1 = new SignerMachineImpl('signer1', eventBus, 'server1');
  const signer2 = new SignerMachineImpl('signer2', eventBus, 'server1');

  // Create entity
  const entityConfig: EntityConfig = {
    threshold: 2,
    signers: Map({
      'signer1': 1,
      'signer2': 1
    })
  };

  const entityResult = await createEntityMachine(
    'entity1',
    'server1',
    entityConfig,
    eventBus
  );

  if (entityResult._tag === 'Left') {
    throw new Error(`Failed to create entity: ${entityResult.left.message}`);
  }

  const entity = entityResult.right;

  // Connect signers
  await connectSignerToEntity(entity, signer1, 1);
  await connectSignerToEntity(entity, signer2, 1);
  await registerEntityOnEventBus(eventBus, entity);

  // Set up event monitoring
  eventBus.subscribe('PROPOSAL_CREATED', console.log);
  eventBus.subscribe('PROPOSAL_APPROVED', console.log);
  eventBus.subscribe('PROPOSAL_EXECUTED', console.log);

  // Create and submit proposal
  const transaction = {
    type: 'TRANSFER',
    nonce: Date.now(),
    sender: entity.id,
    payload: {
      amount: 100,
      recipient: 'account2'
    },
    timestamp: Date.now(),
    metadata: {
      chainId: 'local',
      validFrom: Date.now(),
      validUntil: Date.now() + 3600000,
      gasLimit: BigInt(21000),
      maxFeePerGas: BigInt(1000000000)
    }
  };

  const proposalMessage = {
    id: `proposal_${Date.now()}`,
    type: 'COMMAND',
    payload: {
      type: 'PROPOSE_TRANSACTION',
      transaction
    },
    timestamp: Date.now(),
    sender: signer1.id,
    recipient: entity.id
  };

  await entity.handleEvent(proposalMessage);

  // Submit approval
  const approvalMessage = {
    id: `approval_${Date.now()}`,
    type: 'COMMAND',
    payload: {
      type: 'APPROVE_PROPOSAL',
      proposalId: proposalMessage.id
    },
    timestamp: Date.now(),
    sender: signer2.id,
    recipient: entity.id
  };

  await entity.handleEvent(approvalMessage);
}

main().catch(console.error);
```

## Next Steps

- Learn about [Working with Channels](./channels.md)
- Explore [State Management](../implementation/state-management.md)
- Read about [Entity Implementation](../implementation/entities.md)

## Common Issues

1. **Key Storage Errors**
   - Ensure keys are properly initialized
   - Verify key format and encoding

2. **Event Bus Issues**
   - Check event subscriptions
   - Verify message routing

3. **State Transition Errors**
   - Validate transaction format
   - Check signer permissions
   - Verify threshold requirements

For more details on error handling, see the [Entity Implementation](../implementation/entities.md) documentation. 