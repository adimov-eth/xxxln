import { ServerCommand } from '@xxxln/core/src/types/Messages';
import { 
  NetworkManager,
  NodeInfo,
  NetworkMessage,
  NetworkBlock,
  CentralEventBus,
  Block,
  BlockHeader,
  MachineId,
  Message,
  BlockData,
  PublicKey,
  SignatureData,
  getKeyStorage,
  KeyStorage,
  createEcdsaSignature,
  verifyEcdsaSignature,
  MachineError,
  createMachineError,
  derivePublicKey,
  createNodeManagers,
  initializeNodeNetwork,
  stopNodeNetwork,
  subscribeToNodeEvents,
  runBlockProductionLoop,
  NodeHealth,
  LogLevel,
  createMempoolState,
  MempoolEntry
} from '@xxxln/core';
import type { Transaction, TransactionType } from '@xxxln/core/src/types/MachineTypes';
import { Map as ImmutableMap } from 'immutable';
import { createHash } from 'crypto';
import { createDashboardServer } from './dashboard.js';
import { Account, BlockchainState, NodeConfig, NodeRole, createInitialState, toDashboardState } from './types.js';
import { createLogger } from './utils/logger.js';
import { Either, isLeft, right, left } from 'fp-ts/lib/Either.js';
import { pipe } from 'fp-ts/function';
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
import * as dotenv from 'dotenv';
dotenv.config();

// Node configurations
const NODES_CONFIG: ReadonlyArray<NodeConfig> = [
  { 
    port: 3001,
    id: 'validator1',
    type: 'signer',
    host: 'localhost',
    privateKey: process.env.VALIDATOR1_PRIVATE_KEY || 'test_key_1',
    peers: ['validator2', 'validator3'],
    isBootstrap: true
  },
  {
    port: 3002, 
    id: 'validator2',
    type: 'signer',
    host: 'localhost',
    privateKey: process.env.VALIDATOR2_PRIVATE_KEY || 'test_key_2',
    peers: ['validator1', 'validator3']
  },
  {
    port: 3003,
    id: 'validator3', 
    type: 'signer',
    host: 'localhost',
    privateKey: process.env.VALIDATOR3_PRIVATE_KEY || 'test_key_3',
    peers: ['validator1', 'validator2']
  },
  {
    port: 3004,
    id: 'observer1',
    type: 'entity',
    host: 'localhost',
    privateKey: process.env.OBSERVER1_PRIVATE_KEY || 'test_key_4',
    peers: ['validator1']
  }
] as const;

/* -----------------------------
   1) CONFIG & TYPES
------------------------------ */

// Initialize logger
const logger = createLogger();

// Default accounts
const DEFAULT_ACCOUNTS: ReadonlyArray<Account> = ['account1', 'account2', 'account3', 'account4'];

// Genesis block
const GENESIS_BLOCK: NetworkBlock = {
  hash: 'GENESIS',
  data: {
    header: {
      blockNumber: 0,
      parentHash: 'GENESIS',
      proposer: 'GENESIS' as MachineId,
      timestamp: Date.now(),
      transactionsRoot: '',
      stateRoot: ''
    },
    transactions: [],
    signatures: ImmutableMap<string, string>()
  },
  signature: ''
};

/* -----------------------------
   2) RANDOM UTILS
------------------------------ */
const randomAccount = (): Account => {
  const idx = Math.floor(Math.random() * DEFAULT_ACCOUNTS.length);
  return DEFAULT_ACCOUNTS[idx]!;
};

const generateTransaction = (): Transaction => {
  const from = randomAccount();
  let to;
  do {
    to = randomAccount();
  } while (to === from);
  
  return {
    type: 'TRANSFER',
    nonce: Math.floor(Math.random() * 1000),
    timestamp: Date.now(),
    sender: from as MachineId,
    payload: {
      amount: Math.floor(Math.random() * 100) + 1,
      recipient: to
    },
    metadata: {
      chainId: 'simulator',
      validFrom: Date.now(),
      validUntil: Date.now() + 3600000,
      gasLimit: BigInt(21000),
      maxFeePerGas: BigInt(1000000000)
    }
  };
};

const simulateLatency = async (): Promise<void> => {
  const latency = Math.random() * 200 + 100; // 100-300ms latency
  await new Promise(resolve => setTimeout(resolve, latency));
};

/* -----------------------------
   3) BLOCK CREATION / HASHING
------------------------------ */

const computeStateRoot = (transactions: ReadonlyArray<Transaction>): string => {
  const txData = transactions.map(tx => 
    `${tx.sender}-${(tx.payload as any).recipient}-${(tx.payload as any).amount}-${tx.timestamp}`
  ).join('|');
  return createHash('sha256').update(txData).digest('hex');
};

const computeTransactionsRoot = (transactions: ReadonlyArray<Transaction>): string => {
  const txHashes = transactions.map(tx => 
    createHash('sha256')
      .update(`${tx.nonce}-${tx.sender}-${(tx.payload as any).recipient}-${(tx.payload as any).amount}`)
      .digest('hex')
  );
  return createHash('sha256').update(txHashes.join('')).digest('hex');
};

const createBlock = (
  height: number,
  transactions: ReadonlyArray<Transaction>,
  parentHash: string,
  proposerId: MachineId
): Block => {
  logger.debug('Creating block:', undefined, { height, proposerId, txCount: transactions.length });

  const txMessages: ReadonlyArray<Message<ServerCommand>> = transactions.map(tx => ({
    id: tx.nonce.toString(),
    type: 'COMMAND',
    payload: {
      type: 'TRANSFER',
      amount: (tx.payload as any).amount,
      from: tx.sender,
      to: (tx.payload as any).recipient
    },
    sender: tx.sender,
    recipient: (tx.payload as any).recipient,
    timestamp: tx.timestamp
  }));

  const header: BlockHeader = {
    blockNumber: height,
    parentHash,
    proposer: proposerId,
    timestamp: Date.now(),
    transactionsRoot: computeTransactionsRoot(transactions),
    stateRoot: computeStateRoot(transactions)
  };

  const block = {
    header,
    transactions: txMessages,
    signatures: ImmutableMap<string, string>()
  };

  logger.debug('Created block:', undefined, { block });
  return block as unknown as Block;
};

/* -----------------------------
   4) SIMULATION MAIN
------------------------------ */
async function main(): Promise<void> {
  const eventBus = new CentralEventBus();
  const nodeHealthMap = new Map<string, NodeHealth>();

  // Initialize KeyStorage with node private keys
  const initialKeys = new Map(
    NODES_CONFIG.map(node => [
      node.id,
      node.privateKey
    ])
  );
  KeyStorage.initialize(initialKeys);

  // Initialize dashboard server
  const dashboardServer = createDashboardServer(3100);
  await dashboardServer.start();

  // Set up logger with dashboard broadcast
  const logger = createLogger('SYSTEM', message => dashboardServer.broadcastLog(message));

  // Create network managers
  const managersResult = await pipe(
    NODES_CONFIG,
    configs => createNodeManagers(configs, eventBus, 'INFO' as any, 2000, nodeHealthMap)
  );

  if (isLeft(managersResult)) {
    console.error('Failed to create network:', managersResult.left);
    process.exit(1);
  }

  const managers = managersResult.right;

  // Initialize network
  const initResult = await initializeNodeNetwork(managers, {
    blockProductionInterval: 5000,
    maxTransactionsPerBlock: 100,
    networkTimeout: 5000,
    retryAttempts: 3,
    topology: 'MESH'
  });

  if (isLeft(initResult)) {
    console.error('Failed to initialize network:', initResult.left);
    process.exit(1);
  }

  logger.info('Network created successfully!', undefined, { nodes: [...managers.keys()] });

  // Wait a bit for peers to connect
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Create initial blockchain state
  let blockchainState = createInitialState();

  // Initialize mempool state
  let mempoolState = createMempoolState(10000);

  // Type guard for TRANSFER command
  const isTransferCommand = (cmd: ServerCommand): cmd is Extract<ServerCommand, { type: 'TRANSFER' }> => {
    return cmd.type === 'TRANSFER';
  };

  // Subscribe to transaction events
  subscribeToNodeEvents(managers, (nodeId, event) => {
    logger.debug(`[${nodeId}] Received event: ${event.type}`, undefined, { 
      event,
      eventType: typeof event,
      payloadType: typeof event.payload,
      fullPayload: JSON.stringify(event.payload, null, 2)
    });
    
    if (event.type === 'COMMAND' && event.payload && typeof event.payload === 'object' && 'event' in event.payload) {
      const message = (event.payload as { event: Message<ServerCommand> }).event;
      
      if (!message) {
        logger.debug('No message in event payload');
        return;
      }

      logger.debug(`Processing command message`, undefined, { 
        message,
        messageType: typeof message,
        payloadType: typeof message.payload,
        fullMessage: JSON.stringify(message, null, 2)
      });
      
      if (message.type === 'COMMAND' && message.payload?.type === 'TRANSFER') {
        const transferPayload = message.payload as { 
          type: 'TRANSFER'; 
          amount: number; 
          from: string; 
          to: string 
        };
        
        logger.debug(`Transfer command details:`, undefined, {
          payloadType: typeof transferPayload,
          payloadKeys: Object.keys(transferPayload),
          fullPayload: JSON.stringify(transferPayload, null, 2)
        });
        
        const tx: Transaction = {
          type: 'TRANSFER',
          nonce: parseInt(message.id),
          timestamp: message.timestamp,
          sender: message.sender,
          payload: {
            amount: transferPayload.amount,
            recipient: message.recipient
          },
          metadata: {
            chainId: 'simulator',
            validFrom: message.timestamp,
            validUntil: message.timestamp + 3600000,
            gasLimit: BigInt(21000),
            maxFeePerGas: BigInt(1000000000)
          }
        };

        const entry: MempoolEntry = {
          transaction: message,
          receivedAt: Date.now(),
          gasPrice: BigInt(1),
          nonce: parseInt(message.id)
        };

        mempoolState = {
          ...mempoolState,
          pending: mempoolState.pending.set(message.id, entry),
          currentSize: mempoolState.currentSize + 1
        };

        logger.debug(`Added to mempool`, undefined, { 
          id: message.id, 
          entry,
          pendingCount: mempoolState.currentSize,
          allPending: [...mempoolState.pending.entries()]
        });
      }
    }
  });

  // Register block handler for each manager
  for (const [nodeId, manager] of managers) {
    manager.onBlock((rawBlock: unknown) => {
      logger.debug(`[${nodeId}] Received block:`, undefined, { 
        rawBlock,
        rawBlockType: typeof rawBlock,
        rawBlockKeys: rawBlock ? Object.keys(rawBlock as object) : []
      });
      
      const block = rawBlock as NetworkBlock;
      const blockData = block.data as Block;
      
      if (!blockData || !blockData.header) {
        logger.error('Invalid block data received:', undefined, { block });
        return;
      }

      logger.info(`[${nodeId}] New block produced: #${blockData.header.blockNumber}`, undefined, {
        hash: block.hash,
        transactions: blockData.transactions.length,
        proposer: blockData.header.proposer,
        blockData: JSON.stringify(blockData, null, 2)
      });
      
      // Update state with transactions
      blockData.transactions.forEach(tx => {
        const command = tx.payload;
        if (command.type === 'TRANSFER') {
          // Update balances
          const from = tx.sender as Account;
          const to = tx.recipient as Account;
          const amount = command.amount;

          const currentFromBalance = blockchainState.balances.get(from) || 0;
          const currentToBalance = blockchainState.balances.get(to) || 0;

          logger.debug(`[${nodeId}] Updating balances: ${from}(${currentFromBalance}) -> ${to}(${currentToBalance}), amount: ${amount}`);

          blockchainState = {
            ...blockchainState,
            balances: blockchainState.balances
              .set(from, currentFromBalance - amount)
              .set(to, currentToBalance + amount)
          };

          // Remove from pending
          mempoolState = {
            ...mempoolState,
            pending: mempoolState.pending.remove(tx.id),
            currentSize: mempoolState.currentSize - 1
          };
        }
      });

      // Update block info
      blockchainState = {
        ...blockchainState,
        height: blockData.header.blockNumber,
        tipHash: block.hash
      };

      // Broadcast updated state
      dashboardServer.broadcastNetworkState({
        nodeStates: Object.fromEntries(
          [...managers.keys()].map(nodeId => [
            nodeId,
            {
              ...toDashboardState(blockchainState),
              balances: Object.fromEntries(blockchainState.balances) as Record<Account, number>
            }
          ])
        ),
        nodeConfigs: NODES_CONFIG
      });

      logger.info(`[${nodeId}] Updated balances:`, undefined, {
        before: Object.fromEntries(blockchainState.balances),
        updates: blockData.transactions.map(tx => {
          const command = tx.payload;
          return command.type === 'TRANSFER' ? {
            from: tx.sender,
            to: tx.recipient,
            amount: command.amount
          } : null;
        }).filter(Boolean)
      });
    });
  }

  // Broadcast initial state to dashboard
  dashboardServer.broadcastNetworkState({
    nodeStates: Object.fromEntries(
      [...managers.keys()].map(nodeId => [
        nodeId,
        {
          ...toDashboardState(blockchainState),
          balances: Object.fromEntries(blockchainState.balances) as Record<Account, number>
        }
      ])
    ),
    nodeConfigs: NODES_CONFIG
  });

  // Set up shutdown handler
  let running = true;
  process.on('SIGINT', async () => {
    logger.info('Shutting down simulation...');
    running = false;
    await stopNodeNetwork(managers);
    await dashboardServer.close();
    process.exit();
  });

  // Start periodic state updates
  setInterval(() => {
    dashboardServer.broadcastNetworkState({
      nodeStates: Object.fromEntries(
        [...managers.keys()].map(nodeId => [
          nodeId,
          {
            ...toDashboardState(blockchainState),
            balances: Object.fromEntries(blockchainState.balances) as Record<Account, number>
          }
        ])
      ),
      nodeConfigs: NODES_CONFIG
    });
  }, 1000);

  // Start transaction simulation
  const simulateTransactions = () => {
    if (!running) return;

    // Generate 1-3 transactions
    const txCount = Math.floor(Math.random() * 3) + 1;
    logger.debug(`Generating ${txCount} new transactions`);
    
    for (let i = 0; i < txCount; i++) {
      const tx = generateTransaction();
      logger.info(`Generated transaction: ${tx.sender} -> ${(tx.payload as any).recipient} (${(tx.payload as any).amount})`);
      
      // Broadcast to a random validator
      const validators = [...managers.keys()].filter(id => id.includes('validator'));
      const randomValidator = validators[Math.floor(Math.random() * validators.length)]!;
      const manager = managers.get(randomValidator)!;
      
      logger.info(`Broadcasting transaction to validator ${randomValidator}`);

      // Emit the message to the event bus
      const message: Message<ServerCommand> = {
        id: tx.nonce.toString(),
        type: 'COMMAND',
        payload: {
          type: 'TRANSFER',
          amount: (tx.payload as any).amount,
          from: tx.sender,
          to: (tx.payload as any).recipient
        },
        sender: tx.sender,
        recipient: (tx.payload as any).recipient,
        timestamp: tx.timestamp
      };

      manager.emit('message', {
        type: 'COMMAND',
        payload: {
          event: message
        },
        timestamp: Date.now()
      });

      logger.info(`Transaction broadcast complete: ${tx.nonce}`);
    }

    // Schedule next batch with longer interval
    setTimeout(simulateTransactions, Math.random() * 2000 + 1000); // 1-3s interval
  };

  // Start simulation
  logger.info('Starting transaction simulation...');
  simulateTransactions();

  // Run block production loop
  logger.info('Starting block production...');
  await runBlockProductionLoop(
    managers,
    () => {
      // Get all pending transactions
      const entries = [...mempoolState.pending.values()];

      // Map entries for logging, safely handling types
      const pendingTxs = entries.map(entry => {
        const payload = entry.transaction.payload;
        if (isTransferCommand(payload)) {
          return {
            id: entry.transaction.id,
            from: entry.transaction.sender,
            to: entry.transaction.recipient,
            amount: payload.amount
          };
        }
        return null;
      }).filter((tx): tx is NonNullable<typeof tx> => tx !== null);

      logger.debug(`Fetching transactions for block production. Pending count: ${entries.length}`, undefined, {
        pendingTxs
      });

      // Return first transaction if available
      if (entries.length === 0) {
        logger.debug('No pending transactions for block production');
        return undefined;
      }

      const entry = entries[0]!;
      const transferCommand = entry.transaction.payload;

      if (!isTransferCommand(transferCommand)) {
        logger.debug('Selected transaction is not a transfer');
        return undefined;
      }

      logger.debug(`Selected transaction for block: ${entry.transaction.sender} -> ${entry.transaction.recipient} (${transferCommand.amount})`);

      // Move to processing
      mempoolState = {
        ...mempoolState,
        pending: mempoolState.pending.remove(entry.transaction.id),
        processing: mempoolState.processing.set(entry.transaction.id, entry),
        currentSize: mempoolState.currentSize - 1
      };

      // Convert to Transaction type
      const tx: Transaction = {
        type: 'TRANSFER',
        nonce: parseInt(entry.transaction.id),
        timestamp: entry.transaction.timestamp,
        sender: entry.transaction.sender,
        payload: {
          amount: transferCommand.amount,
          recipient: entry.transaction.recipient
        },
        metadata: {
          chainId: 'simulator',
          validFrom: entry.transaction.timestamp,
          validUntil: entry.transaction.timestamp + 3600000,
          gasLimit: BigInt(21000),
          maxFeePerGas: BigInt(1000000000)
        }
      };

      return tx;
    },
    msg => logger.info(`[BlockProduction] ${msg}`),
    () => !running,
    5000
  );
}

function waitForAllPeers(
  managers: Map<string, NetworkManager>,
  configs: ReadonlyArray<NodeConfig>
): Promise<void> {
  return new Promise((resolve) => {
    // Checks if all managers see their expected # of peers
    const checkAllConnected = () => {
      for (const [nodeId, manager] of managers) {
        const cfg = configs.find(c => c.id === nodeId);
        if (!cfg) continue;
        if (manager.getPeers().size < cfg.peers.length) {
          return false; // Not all peers discovered yet
        }
      }
      return true;
    };

    // Whenever a new peer connects, or a handshake completes, we re-check
    for (const [, manager] of managers) {
      manager.on('newPeer', () => {
        if (checkAllConnected()) {
          resolve();
        }
      });
    }

    // Do an initial check if everything is already connected
    if (checkAllConnected()) {
      resolve();
    }
  });
}

main().catch(error => {
  console.error('Fatal error in simulation:', error);
  process.exit(1);
});
