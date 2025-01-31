# @xxxln/core

A functional, event-driven architecture for building decentralized payment networks. Built with TypeScript and fp-ts, emphasizing immutability, type safety, and mathematical correctness.

## Table of Contents

1. [Installation](#installation)  
2. [Overview](#overview)  
3. [Architecture](#architecture)  
4. [Key Components](#key-components)  
   - [Event Bus & ActorMachine](#event-bus--actormachine)  
   - [Machines (Server/Signer/Entity/Channel)](#machines)  
   - [HierarchyManager](#hierarchymanager)  
   - [NodeOrchestrator](#nodeorchestrator)  
   - [KeyStorage & ECDSA](#keystorage--ecdsa)  
5. [Getting Started](#getting-started)  
   - [1) Initialize KeyStorage](#1-initialize-keystorage)  
   - [2) Create and Start Machines](#2-create-and-start-machines)  
   - [3) Hierarchy Management](#3-hierarchy-management)  
   - [4) Running Node Simulations](#4-running-node-simulations)  
6. [Advanced Usage](#advanced-usage)  
7. [Contributing](#contributing)  
8. [License](#license)

## Key Features

- **Pure Functional Design**: Built with fp-ts, leveraging Either, TaskEither, and functional composition
- **Actor-Based Architecture**: Event-driven machines communicate via typed messages
- **Hierarchical State Management**: Immutable state trees with versioned updates
- **Cryptographic Security**: ECDSA signatures with secure key management
- **Type Safety**: Extensive use of TypeScript's type system and io-ts for runtime validation

## Installation

Because this package is part of a monorepo, it's typically installed and built with the rest of the workspace:

```bash
pnpm install
pnpm build
```

(Replace pnpm with your package manager of choice.)

If you wish to link or export this package somewhere else, ensure it's properly built so that importing from "@xxxln/core" works.

## Overview

@xxxln/core delivers fundamental building blocks for a decentralized payment network or sidechain-based system with hierarchical state updates. The code is written in TypeScript and leverages:
- fp-ts for functional patterns  
- immutable.js for immutable data structures  
- A BaseMachine / ActorMachine approach for event-driven concurrency  

You can:
- Create servers, signers, entities, and channels as distinct machines  
- Manage them through the built-in HierarchyManager  
- Run a simple multi-node network with NodeOrchestrator or your own custom scripts  
- Use ECDSA for signatures on transactions and blocks

## Architecture

1. **ServerMachine**: Top-level aggregator or "hub" that manages a mempool, produces blocks, and coordinates submachines  
2. **SignerMachine**: Represents a user or signer with private/public keys  
3. **EntityMachine**: A multi-sig or organizational submachine that can propose and approve transactions  
4. **ChannelMachine**: Represents a payment channel with dispute logic  
5. **EventBus** & **MachineRunner**: Dispatch events to machines (which are actors). Each machine has an inbox  
6. **Crypto**: ECDSA signing and verification. KeyStorage ensures each machine's private keys are stored and retrievable  
7. **Network**: WebSocket-based networking (NetworkManager, WebSocketServer) for node-to-node communication

## Key Components

### Event Bus & ActorMachine

• The EventBus (e.g., CentralEventBus) registers each machine  
• Each machine implements handleEvent(...) to process inbound events  
• The MachineRunner loops over events in the inbox, letting the machine act upon them

Example event bus interface:

```typescript
interface EventBus {
  dispatch: (event: MachineEvent) => void;
  subscribe: (machine: BaseMachine) => void;
}
```

### Machines

• ServerMachine: Maintains submachine references (like signers or entities) in its state, plus a mempool for transactions  
• SignerMachine: Holds a user's private/public key logic, can sign transactions, and maintain a nonce  
• EntityMachine: Multi-sig or organizational logic; can handle proposals that require multiple signatures  
• ChannelMachine: Payment channel with states, disputes, timeouts, etc.

### HierarchyManager

• Utility functions to connect signers to entities, attach entities to servers, etc.  
• Example usage:
  ```typescript
  import {
    createEntityForSigner,
    attachEntityToServer,
    connectSignerToEntity,
    registerEntityOnEventBus
  } from '@xxxln/core';
  ```

### NodeOrchestrator

• High-level orchestration for multi-node simulations  
• createNodeManagers(...) builds a map of node IDs → NetworkManager instances  
• runSimpleBlockProductionLoop(...) runs a naive block-producer loop among "signer" nodes  
• Great for quick local testing or demos

#### Network Management
• Handles node failures and recovery with automatic reconnection  
• Manages network partitions and topology changes  
• Implements state synchronization across nodes  
• Provides efficient block propagation mechanisms  

Example network configuration:
```typescript
const networkConfig: NodeOrchestratorConfig = {
  blockProductionInterval: 5000, // ms
  maxTransactionsPerBlock: 100,
  networkTimeout: 10000,
  retryAttempts: 3,
  topology: 'MESH' // or 'STAR' | 'RING'
};

// Initialize network
const result = await initializeNodeNetwork(managers, networkConfig);
if (result._tag === 'Right') {
  // Subscribe to network events
  subscribeToNodeEvents(managers, (nodeId, event) => {
    console.log(`Node ${nodeId} received event:`, event);
  });
  
  // Monitor health
  const healthStatus = checkNodeHealth(managers);
  for (const [nodeId, status] of healthStatus) {
    if (!status.isHealthy) {
      console.warn(`Node ${nodeId} is unhealthy:`, status.errors);
    }
  }
}
```

#### Configuration
• Environment-based configuration:
```typescript
// .env
NODE_NETWORK_TIMEOUT=10000
MAX_TRANSACTIONS_PER_BLOCK=100
BLOCK_PRODUCTION_INTERVAL=5000
NETWORK_TOPOLOGY=MESH

// Usage
const config = {
  networkTimeout: process.env.NODE_NETWORK_TIMEOUT || 10000,
  maxTransactionsPerBlock: process.env.MAX_TRANSACTIONS_PER_BLOCK || 100,
  blockProductionInterval: process.env.BLOCK_PRODUCTION_INTERVAL || 5000,
  topology: process.env.NETWORK_TOPOLOGY || 'MESH'
} as const;
```

• Network topology setup:
```typescript
type NodeRole = 'VALIDATOR' | 'OBSERVER' | 'SIGNER' | 'ENTITY';
type NetworkState = 'SYNCING' | 'ACTIVE' | 'DISCONNECTED';

interface NodeConfig {
  readonly id: string;
  readonly role: NodeRole;
  readonly peers: ReadonlyArray<string>;
  readonly state: NetworkState;
}

// Example topology setup
const topology = new Map<string, NodeConfig>([
  ['node1', { id: 'node1', role: 'VALIDATOR', peers: ['node2', 'node3'], state: 'ACTIVE' }],
  ['node2', { id: 'node2', role: 'VALIDATOR', peers: ['node1', 'node3'], state: 'ACTIVE' }],
  ['node3', { id: 'node3', role: 'OBSERVER', peers: ['node1', 'node2'], state: 'SYNCING' }]
]);
```

#### Monitoring & Debugging
• Health checks and metrics:
```typescript
interface NodeMetrics {
  readonly blockHeight: number;
  readonly peersCount: number;
  readonly lastBlockTime: number;
  readonly pendingTransactions: number;
}

// Example monitoring
const metrics = await getNodeMetrics(managers);
for (const [nodeId, nodeMetrics] of metrics) {
  console.log(`Node ${nodeId} metrics:`, nodeMetrics);
}
```

• Debug logging levels:
```typescript
enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

// Enable debug logging
setLogLevel(LogLevel.DEBUG);
```

#### Security Considerations

• Network Security
- All node communication is encrypted using TLS
- Peer authentication using ECDSA signatures
- Rate limiting and DoS protection built-in
- Blacklisting of misbehaving nodes

• Key Management
- Secure key storage with encryption at rest
- Key rotation policies
- Multi-signature support for critical operations
- Hardware security module (HSM) integration support

• DoS Protection
- Request rate limiting
- Payload size restrictions
- Connection pooling
- Automatic blacklisting of malicious peers

#### Testing Support

The NodeOrchestrator provides utilities for testing network scenarios:

```typescript
// Create a test network
const testNetwork = await createTestNetwork(5, 'MESH');

// Simulate network conditions
simulateNetworkConditions(testNetwork, {
  latency: 100, // ms
  packetLoss: 0.1, // 10%
  partition: false
});

// Run test scenarios
await runNetworkScenario(testNetwork, {
  scenario: 'PARTITION',
  duration: 5000,
  healNetwork: true
});
```

### KeyStorage & ECDSA

• KeyStorage: Manages private key lookup for each machine ID or node ID  
• EcdsaSignatures: createEcdsaSignature(...) / verifyEcdsaSignature(...) wrap secp256k1 signing for transactions, blocks, etc.

## Getting Started

### 1) Initialize KeyStorage

When your app starts, populate KeyStorage with private keys:

```typescript
import { KeyStorage } from '@xxxln/core';

const keys = new Map<string, string>();
keys.set('signerA', 'abcdef123456...'); // your private key in hex
KeyStorage.initialize(keys);
```

### 2) Create and Start Machines

• Create a ServerMachine, SignerMachine, etc.  
• Register them on the EventBus  
• Start a MachineRunner for each if you need continuous event polling

```typescript
import { ServerMachineImpl } from '@xxxln/core';
import { CentralEventBus } from '@xxxln/core';
import { MachineRunner } from '@xxxln/core';

const eventBus = new CentralEventBus();
const server = new ServerMachineImpl('server1', eventBus);

// Start runner
const serverRunner = new MachineRunner(server);
await serverRunner.start();
```

### 3) Hierarchy Management

Use HierarchyManager to link signers and entities:

```typescript
import {
  createEntityForSigner,
  attachEntityToServer,
  connectSignerToEntity,
  registerEntityOnEventBus
} from '@xxxln/core';

// Suppose we have a signerMachine and serverMachine
const entityResult = createEntityForSigner(signerMachine, config, myEntityFactory);
if (entityResult._tag === 'Right') {
  // Attach to server
  const updatedServer = attachEntityToServer(serverMachine, entityResult.right);
  // Connect a second signer
  connectSignerToEntity(entityResult.right, anotherSignerMachine, 1);
  // Register entity on event bus
  registerEntityOnEventBus(eventBus, entityResult.right);
}
```

### 4) Running Node Simulations

NodeOrchestrator helps you spin up multiple nodes:

```typescript
import { createNodeManagers, runSimpleBlockProductionLoop } from '@xxxln/core';

const configs = [
  { id: 'SIGNER1', type: 'signer', privateKey: '...', peers: ['SIGNER2'], port: 3001, host: 'localhost' },
  { id: 'SIGNER2', type: 'signer', privateKey: '...', peers: ['SIGNER1'], port: 3002, host: 'localhost' }
];

// Create managers
const managersResult = createNodeManagers(configs);
if (managersResult._tag === 'Right') {
  // Start a naive block production
  runSimpleBlockProductionLoop(
    managersResult.right,
    () => ({ id: 'tx1', from: 'Alice', to: 'Bob', amount: 5, timestamp: Date.now() }),
    msg => console.log(msg)
  );
}
```

## Advanced Usage

• Implement custom block logic inside a specialized ServerMachine or your NodeOrchestrator  
• Override signatures with BLS or multi-sig aggregator  
• Introduce real-world networking by connecting actual IP addresses or domain names  
• Add more error handling or concurrency controls in the MachineRunner  

The system is intentionally modular—plug in specialized logic for your domain's needs.

## Contributing

1. Fork and clone the repository  
2. Make your changes in a branch  
3. Ensure the code passes lint checks, type checks, and tests (pnpm test)  
4. Open a pull request describing your changes

We welcome feedback, issues, and pull requests to improve the functional architecture and expand the feature set.

## License

MIT License - see LICENSE file for details. 