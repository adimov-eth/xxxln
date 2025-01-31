# Starting a Local Network

This tutorial walks you through setting up and running a local test network using the simulator.

## Prerequisites

- Node.js 18+ installed
- pnpm installed (`npm install -g pnpm`)
- TypeScript knowledge
- Basic understanding of the actor model

## Step 1: Project Setup

First, clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/xxxln
cd xxxln
pnpm install
```

## Step 2: Configure the Network

Create a new file `local-network.ts` in your project:

```typescript
import { 
  createNodeManagers,
  initializeNodeNetwork,
  runBlockProductionLoop,
  NodeConfig,
  NodeOrchestratorConfig
} from '@xxxln/core';

// Define node configurations
const nodes: NodeConfig[] = [
  {
    id: 'validator1',
    type: 'signer',
    privateKey: process.env.VALIDATOR1_KEY || 'test_key_1',
    peers: ['validator2', 'validator3'],
    port: 3001,
    host: 'localhost',
    isBootstrap: true
  },
  {
    id: 'validator2',
    type: 'signer',
    privateKey: process.env.VALIDATOR2_KEY || 'test_key_2',
    peers: ['validator1', 'validator3'],
    port: 3002,
    host: 'localhost'
  },
  {
    id: 'validator3',
    type: 'signer',
    privateKey: process.env.VALIDATOR3_KEY || 'test_key_3',
    peers: ['validator1', 'validator2'],
    port: 3003,
    host: 'localhost'
  }
];

// Network configuration
const networkConfig: NodeOrchestratorConfig = {
  blockProductionInterval: 5000, // 5 seconds
  maxTransactionsPerBlock: 100,
  networkTimeout: 10000,
  retryAttempts: 3,
  topology: 'MESH'
};
```

## Step 3: Initialize and Start the Network

Add the network initialization code:

```typescript
async function main() {
  // Create network managers
  const managersResult = await createNodeManagers(nodes);
  if (managersResult._tag === 'Left') {
    console.error('Failed to create managers:', managersResult.left);
    process.exit(1);
  }
  const managers = managersResult.right;

  // Initialize the network
  const initResult = await initializeNodeNetwork(managers, networkConfig);
  if (initResult._tag === 'Left') {
    console.error('Failed to initialize network:', initResult.left);
    process.exit(1);
  }

  // Start block production
  await runBlockProductionLoop(
    managers,
    () => {
      // Your transaction generation logic here
      return {
        type: 'TRANSFER',
        nonce: Date.now(),
        sender: 'account1',
        payload: {
          amount: Math.floor(Math.random() * 100),
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
    },
    msg => console.log(msg),
    () => false, // Run indefinitely
    5000 // Block interval
  );
}

main().catch(console.error);
```

## Step 4: Run the Network

1. Build the project:
```bash
pnpm build
```

2. Run your local network:
```bash
pnpm tsx local-network.ts
```

You should see output indicating block production and transaction processing.

## Step 5: Monitor the Network

1. Start the dashboard:
```bash
cd packages/dashboard
pnpm dev
```

2. Open http://localhost:5173 in your browser to view the network status.

## Next Steps

- Learn how to [Create Signers and Entities](./signer-entity.md)
- Explore [Working with Channels](./channels.md)
- Read about [Network Protocols](../architecture/protocols.md)

## Troubleshooting

### Common Issues

1. **Port already in use**
   - Change the port numbers in your configuration
   - Ensure no other instances are running

2. **Peer connection failures**
   - Check that all nodes are running
   - Verify peer configurations match
   - Ensure network ports are accessible

3. **Block production issues**
   - Verify validator configurations
   - Check log output for errors
   - Ensure enough validators are connected

For more detailed troubleshooting, see the [Network Architecture](../architecture/networking.md) documentation. 