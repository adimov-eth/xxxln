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
  ServerCommand,
  BlockData,
  PublicKey,
  SignatureData,
  getKeyStorage,
  KeyStorage,
  createEcdsaSignature,
  verifyEcdsaSignature,
  MachineError,
  createMachineError,
  derivePublicKey
} from '@xxxln/core';
import { Map as ImmutableMap } from 'immutable';
import { createHash } from 'crypto';
import { createDashboardServer } from './dashboard.js';
import { Account, BlockchainState, NodeConfig, NodeRole, Transaction, createInitialState } from './types.js';
import { createLogger } from './utils/logger.js';
import { Either, isLeft, right, left } from 'fp-ts/lib/Either.js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

// Validate required environment variables
const requiredKeys = ['SIGNER1', 'SIGNER2', 'SIGNER3', 'ENTITY1'].map(id => `SIGNER_PRIVATE_KEY_${id}`);
const missingKeys = requiredKeys.filter(key => !process.env[key]);
if (missingKeys.length > 0) {
  throw new Error(`Missing required environment variables: ${missingKeys.join(', ')}`);
}

// Initialize KeyStorage with keys from environment
const keys = new Map<string, string>();
for (const nodeId of ['SIGNER1', 'SIGNER2', 'SIGNER3', 'ENTITY1']) {
  const key = process.env[`SIGNER_PRIVATE_KEY_${nodeId}`];
  if (key) {
    // Store by both public key and node ID
    const publicKey = derivePublicKey(key);
    if (isLeft(publicKey)) {
      throw new Error(`Failed to derive public key for ${nodeId}: ${publicKey.left}`);
    }
    keys.set(publicKey.right, key); // Store by public key
    keys.set(nodeId, key); // Also store by node ID
  }
}
KeyStorage.initialize(keys);

// Node configurations
export const NODES_CONFIG: ReadonlyArray<NodeConfig> = [
  {
    id: 'SIGNER1',
    type: 'signer',
    privateKey: process.env.SIGNER_PRIVATE_KEY_SIGNER1!,
    peers: ['SIGNER2', 'SIGNER3'],
    isBootstrap: true,
    port: 3001,
    host: 'localhost'
  },
  {
    id: 'SIGNER2',
    type: 'signer',
    privateKey: process.env.SIGNER_PRIVATE_KEY_SIGNER2!,
    peers: ['SIGNER1', 'SIGNER3'],
    port: 3002,
    host: 'localhost'
  },
  {
    id: 'SIGNER3',
    type: 'signer',
    privateKey: process.env.SIGNER_PRIVATE_KEY_SIGNER3!,
    peers: ['SIGNER1', 'SIGNER2'],
    port: 3003,
    host: 'localhost'
  },
  {
    id: 'ENTITY1',
    type: 'entity',
    privateKey: process.env.SIGNER_PRIVATE_KEY_ENTITY1!,
    peers: ['SIGNER1'],
    port: 3004,
    host: 'localhost'
  }
] as const;

// KeyStorage will automatically load keys from environment variables

/* -----------------------------
   1) CONFIG & TYPES
------------------------------ */

// Initialize logger
const logger = createLogger();

// Default accounts
const DEFAULT_ACCOUNTS: Account[] = ['account1', 'account2', 'account3', 'account4'];

// Add after DEFAULT_ACCOUNTS definition
const GENESIS_BLOCK: NetworkBlock = {
  hash: 'GENESIS',
  data: createBlock(0, [], 'GENESIS', 'GENESIS' as MachineId),
  signature: '' // Genesis block has no signature
};

/* -----------------------------
   2) RANDOM UTILS
------------------------------ */
const randomAccount = (): Account => {
  const idx = Math.floor(Math.random() * DEFAULT_ACCOUNTS.length);
  return DEFAULT_ACCOUNTS[idx]!; // Non-null assertion since array is constant
};

const generateTransaction = (): Transaction => {
  // pick two distinct random accounts
  let from = randomAccount();
  let to = randomAccount();
  while (to === from) {
    to = randomAccount();
  }
  return {
    id: Math.random().toString(36).substring(7),
    from,
    to,
    amount: Math.floor(Math.random() * 100) + 1,
    timestamp: Date.now()
  };
};

const simulateLatency = async () => {
  const latency = Math.random() * 200 + 100; // 100-300ms latency
  return new Promise(resolve => setTimeout(resolve, latency));
};

/* -----------------------------
   3) BLOCK CREATION / HASHING
------------------------------ */

// Function declarations first
function computeStateRoot(transactions: Transaction[]): string {
  const txData = transactions.map(tx => 
    `${tx.from}-${tx.to}-${tx.amount}-${tx.timestamp}`
  ).join('|');
  return createHash('sha256').update(txData).digest('hex');
}

function computeTransactionsRoot(transactions: Transaction[]): string {
  const txHashes = transactions.map(tx => 
    createHash('sha256')
      .update(`${tx.id}-${tx.from}-${tx.to}-${tx.amount}`)
      .digest('hex')
  );
  return createHash('sha256').update(txHashes.join('')).digest('hex');
}

function createBlock(
  height: number,
  transactions: Transaction[],
  parentHash: string,
  proposerId: MachineId
): Block {
  // Convert transactions to messages
  const txMessages: ReadonlyArray<Message<ServerCommand>> = transactions.map(tx => {
    const msg: Message<ServerCommand> = {
      id: tx.id,
      type: 'COMMAND',
      payload: {
        type: 'TRANSFER',
        amount: tx.amount
      },
      sender: tx.from as MachineId,
      recipient: tx.to as MachineId,
      timestamp: tx.timestamp
    };
    return msg;
  });

  // Create block header
  const header: BlockHeader = {
    blockNumber: height,
    parentHash,
    proposer: proposerId,
    timestamp: Date.now(),
    transactionsRoot: computeTransactionsRoot(transactions),
    stateRoot: computeStateRoot(transactions)
  };

  // Create block data with explicit type cast
  const blockData = {
    header,
    transactions: txMessages,
    signatures: ImmutableMap<string, string>()
  } as unknown as Block;

  return blockData;
}

// Add signature verification function
async function verifyBlockSignature(
  block: NetworkBlock,
  proposerId: string
): Promise<Either<MachineError, boolean>> {
  if (!block.signature) {
    return right(false);
  }

  // Get proposer's public key
  const publicKeyResult = getKeyStorage().getPublicKey(proposerId);
  if (isLeft(publicKeyResult)) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      `Failed to get public key for proposer ${proposerId}`,
      publicKeyResult.left
    ));
  }

  // Compute block hash for verification
  const blockHash = createHash('sha256')
    .update(JSON.stringify(block.data))
    .digest();

  // Verify signature
  return verifyEcdsaSignature(blockHash, block.signature, publicKeyResult.right);
}

// Add block signing function
async function signBlock(
  block: Block,
  proposerId: string
): Promise<Either<MachineError, string>> {
  // Get private key from storage
  const privateKeyResult = getKeyStorage().getPrivateKey(proposerId);
  if (isLeft(privateKeyResult)) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      `Failed to get private key for proposer ${proposerId}`,
      privateKeyResult.left
    ));
  }

  // Compute block hash
  const blockHash = createHash('sha256')
    .update(JSON.stringify(block))
    .digest();

  // Sign block hash
  return createEcdsaSignature(blockHash, privateKeyResult.right);
}

/* -----------------------------
   4) SIMULATION MAIN
------------------------------ */
async function main() {
  const nodes: NetworkManager[] = [];
  const eventBus = new CentralEventBus();
  const dashboard = createDashboardServer(4000);

  // Initialize logger with dashboard broadcasting
  const logger = createLogger('SYSTEM', message => dashboard.broadcastLog(message));

  // For demonstration, we store a local chain state for each node by ID
  const localStates: Record<string, BlockchainState> = {};

  // Initialize local chain states
  for (const config of NODES_CONFIG) {
    localStates[config.id] = {
      ...createInitialState(),
      blocks: ImmutableMap<string, NetworkBlock>().set('GENESIS', GENESIS_BLOCK),
      tipHash: 'GENESIS'
    };
  }

  /* -----------------------------
     4.1 CREATE NETWORK NODES
  ------------------------------ */
  for (const config of NODES_CONFIG) {
    const nodeInfo: NodeInfo = {
      id: config.id,
      address: config.host,
      port: config.port,
      publicKey: `key_${config.id}`,
      status: 'ACTIVE'
    };

    // initial peers = all others
    const initialPeers = NODES_CONFIG
      .filter(c => c.id !== config.id)
      .map(c => ({
        id: c.id,
        address: c.host,
        port: c.port,
        publicKey: `key_${c.id}`,
        status: 'ACTIVE' as const
      }));

    const node = new NetworkManager(
      config.port,
      initialPeers,
      config.id
    );
    logger.debug(`Created node with config ID ${config.id}, actual ID: ${node.getNodeInfo().id}`);
    logger.debug(`Node info:`, config.id, node.getNodeInfo());
    nodes.push(node);
    
    // Wait for WebSocket server to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    /* --------------------------------
       4.2 BLOCK REQUEST HANDLER
    --------------------------------- */
    node.onBlockRequest(async (blockHash: string) => {
      await simulateLatency();
      const nodeState = localStates[config.id];
      
      if (!nodeState) {
        logger.error(`No local state found for block request`, config.id);
        return undefined;
      }

      const requestedBlock = nodeState.blocks.get(blockHash);
      if (requestedBlock) {
        logger.info(`Responding to block request for ${blockHash}`, config.id);
        return requestedBlock;
      }
      return undefined;
    });

    /* --------------------------------
       4.3 BLOCK HANDLER
    --------------------------------- */
    node.onBlock(async (blockData: unknown) => {
      await simulateLatency();
      const networkBlock = blockData as NetworkBlock;
      const block = networkBlock.data as Block;
      const nodeState = localStates[config.id];
      
      if (!nodeState) {
        logger.error(`No local state found`, config.id);
        return;
      }

      logger.info(`Received BLOCK #${block.header.blockNumber} hash=${networkBlock.hash}`, config.id);

      // If we already have it, ignore
      if (nodeState.blocks.has(networkBlock.hash)) {
        return;
      }

      // Verify block signature
      const signatureResult = await verifyBlockSignature(networkBlock, block.header.proposer);
      if (isLeft(signatureResult)) {
        logger.error(`Failed to verify block signature: ${signatureResult.left.message}`, config.id);
        return;
      }
      if (!signatureResult.right) {
        logger.error(`Invalid block signature`, config.id);
        return;
      }

      // Store the block in local DB
      localStates[config.id] = {
        ...nodeState,
        blocks: nodeState.blocks.set(networkBlock.hash, networkBlock)
      };
      
      // Handle genesis block request
      if (block.header.parentHash === 'GENESIS' && !nodeState.blocks.has('GENESIS')) {
        logger.info(`Requesting missing parent GENESIS`, config.id);
        localStates[config.id] = {
          ...localStates[config.id],
          blocks: localStates[config.id].blocks.set('GENESIS', GENESIS_BLOCK),
          tipHash: 'GENESIS'
        };
      }

      // Fork choice rule: accept block only if:
      // 1. It extends our current chain (parent is our tip)
      // 2. OR it has higher block number than our current tip AND we have its parent
      // 3. OR it's a block with parentHash === 'GENESIS' and we have the GENESIS block
      const shouldAccept = 
        block.header.parentHash === nodeState.tipHash ||
        (block.header.blockNumber > nodeState.height && nodeState.blocks.has(block.header.parentHash)) ||
        (block.header.parentHash === 'GENESIS' && nodeState.blocks.has('GENESIS'));

      // Debug logging for OBSERVER nodes
      if (config.type === 'entity') {
        const condition1 = block.header.parentHash === nodeState.tipHash;
        const condition2 = block.header.blockNumber > nodeState.height && nodeState.blocks.has(block.header.parentHash);
        const condition3 = block.header.parentHash === 'GENESIS' && nodeState.blocks.has('GENESIS');
        logger.debug(`Block #${block.header.blockNumber} validation:
          parentHash=${block.header.parentHash}, tipHash=${nodeState.tipHash}, height=${nodeState.height}
          hasParent=${nodeState.blocks.has(block.header.parentHash)}, hasGenesis=${nodeState.blocks.has('GENESIS')}
          c1=${condition1}, c2=${condition2}, c3=${condition3}, shouldAccept=${shouldAccept}`, config.id);
      }

      if (shouldAccept) {
        // Reconstruct transaction data
        const transactions = block.transactions.map((txMsg: Message<ServerCommand>) => ({
          id: txMsg.id,
          from: txMsg.sender as Account,
          to: txMsg.recipient as Account,
          amount: (txMsg.payload as Extract<ServerCommand, { type: 'TRANSFER' }>).amount,
          timestamp: txMsg.timestamp
        } as Transaction));

        // Log transactions
        logger.info(`Processing ${transactions.length} transactions from block #${block.header.blockNumber}`, config.id);
        
        // Apply to local balances using immutable updates
        localStates[config.id] = transactions.reduce((state, tx) => {
          const newState = {
            ...state,
            balances: state.balances
              .update(tx.from, (balance = 0) => balance - tx.amount)
              .update(tx.to, (balance = 0) => balance + tx.amount)
          };
          
          // Log transaction and balances
          logger.transaction(tx.from, tx.to, tx.amount, config.id);
          logger.balance(tx.from, newState.balances.get(tx.from) || 0, config.id);
          logger.balance(tx.to, newState.balances.get(tx.to) || 0, config.id);
          
          return newState;
        }, localStates[config.id]);

        // Update height and tip hash
        localStates[config.id] = {
          ...localStates[config.id],
          height: block.header.blockNumber,
          tipHash: networkBlock.hash
        };

        // Broadcast updated state to dashboard
        const dashboardState = Object.fromEntries(
          Object.entries(localStates).map(([id, state]) => [
            id,
            {
              height: state.height,
              balances: ImmutableMap(
                Object.entries(state.balances.toObject()).map(([key, value]) => [
                  key as Account,
                  value
                ])
              ),
              tipHash: state.tipHash,
              blocks: state.blocks
            }
          ])
        );

        dashboard.broadcastNetworkState({
          nodeStates: dashboardState,
          nodeConfigs: NODES_CONFIG
        });
      } else {
        // Request missing parent if needed
        if (block.header.parentHash && !nodeState.blocks.has(block.header.parentHash)) {
          logger.info(`Requesting missing parent ${block.header.parentHash}`, config.id);
          // For OBSERVER nodes, also log the request
          if (config.type === 'entity') {
            logger.debug(`Requesting block ${block.header.parentHash} from peers`, config.id);
          }
          await node.requestBlock(block.header.parentHash);
          
          // Wait a bit for the parent block to arrive
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Re-evaluate the block with the new parent
          if (nodeState.blocks.has(block.header.parentHash)) {
            logger.info(`Successfully received requested block ${block.header.parentHash}`, config.id);
            // Re-evaluate shouldAccept conditions
            const shouldAcceptAfterParent = 
              block.header.parentHash === nodeState.tipHash ||
              (block.header.blockNumber > nodeState.height && nodeState.blocks.has(block.header.parentHash)) ||
              (block.header.parentHash === 'GENESIS' && nodeState.blocks.has('GENESIS'));

            if (shouldAcceptAfterParent) {
              // Process the block's transactions
              const transactions = block.transactions.map((txMsg: Message<ServerCommand>) => ({
                id: txMsg.id,
                from: txMsg.sender as Account,
                to: txMsg.recipient as Account,
                amount: (txMsg.payload as Extract<ServerCommand, { type: 'TRANSFER' }>).amount,
                timestamp: txMsg.timestamp
              } as Transaction));

              logger.info(`Processing ${transactions.length} transactions from block #${block.header.blockNumber} after receiving parent`, config.id);
              
              // Apply transactions
              localStates[config.id] = transactions.reduce((state, tx) => {
                const newState = {
                  ...state,
                  balances: state.balances
                    .update(tx.from, (balance = 0) => balance - tx.amount)
                    .update(tx.to, (balance = 0) => balance + tx.amount)
                };
                
                // Log transaction and balances
                logger.transaction(tx.from, tx.to, tx.amount, config.id);
                logger.balance(tx.from, newState.balances.get(tx.from) || 0, config.id);
                logger.balance(tx.to, newState.balances.get(tx.to) || 0, config.id);
                
                return newState;
              }, localStates[config.id]);

              // Update height and tip hash
              localStates[config.id] = {
                ...localStates[config.id],
                height: block.header.blockNumber,
                tipHash: networkBlock.hash
              };

              logger.info(`Successfully processed block #${block.header.blockNumber} after receiving parent`, config.id);
            } else {
              logger.warn(`Block #${block.header.blockNumber} still not acceptable after receiving parent`, config.id);
            }
          }
        }
      }
    });

    /* --------------------------------
       4.3 STATE UPDATE HANDLER
    --------------------------------- */
    node.onStateUpdate(async (update: any) => {
      await simulateLatency();
      logger.info(`STATE from node=${update.nodeId}, height=${update.height}, tip=${update.tip}`, config.id);
      logger.debug(`Balances:`, config.id, update.balances);
    });
  }

  /* -----------------------------
     5) START DASHBOARD & WAIT FOR CONNECTIONS
  ------------------------------ */
  await dashboard.start();
  await new Promise(resolve => setTimeout(resolve, 1000));
  logger.info('\nNetwork established, starting improved simulation...\n');

  /* -----------------------------
     6) SIMULATION LOOP
  ------------------------------ */
  let running = true;
  
  const runSimulation = async () => {
    while (running) {
      // Generate random transactions
      const numTx = Math.floor(Math.random() * 3) + 1;
      const transactions = Array.from({ length: numTx }, () => generateTransaction());
      
      // Pick a random validator to produce the block
      const validatorNodes = NODES_CONFIG.filter(n => n.type === 'signer');
      if (validatorNodes.length > 0) {
        const proposerConfig = validatorNodes[Math.floor(Math.random() * validatorNodes.length)]!;
        const proposerNode = nodes.find(n => n.getNodeInfo().id === proposerConfig.id);
        
        if (!proposerNode) {
          logger.error(`No node found for proposer ${proposerConfig.id}`);
          continue;
        }

        const nodeState = localStates[proposerConfig.id];
        if (!nodeState) {
          logger.error(`No state found for proposer ${proposerConfig.id}`);
          continue;
        }

        const newHeight = nodeState.height + 1;
        const parentHash = nodeState.tipHash || 'GENESIS';

        // Build a new block
        const block = createBlock(
          newHeight,
          transactions,
          parentHash,
          proposerConfig.id as MachineId
        );

        // Sign the block
        const signatureResult = await signBlock(block, proposerConfig.id);
        if (isLeft(signatureResult)) {
          logger.error(`Failed to sign block: ${signatureResult.left.message}`, proposerConfig.id);
          continue;
        }

        const networkBlock: NetworkBlock = {
          hash: createHash('sha256').update(JSON.stringify(block)).digest('hex'),
          data: block,
          signature: signatureResult.right
        };
        
        // Process the block locally first
        // Apply transactions to local state
        localStates[proposerConfig.id] = transactions.reduce((state, tx) => {
          const newState = {
            ...state,
            balances: state.balances
              .update(tx.from, (balance = 0) => balance - tx.amount)
              .update(tx.to, (balance = 0) => balance + tx.amount)
          };
          
          // Log transaction and balances
          logger.transaction(tx.from, tx.to, tx.amount, proposerConfig.id);
          logger.balance(tx.from, newState.balances.get(tx.from) || 0, proposerConfig.id);
          logger.balance(tx.to, newState.balances.get(tx.to) || 0, proposerConfig.id);
          
          return newState;
        }, localStates[proposerConfig.id]);

        // Update height and store block
        localStates[proposerConfig.id] = {
          ...localStates[proposerConfig.id],
          height: newHeight,
          blocks: localStates[proposerConfig.id].blocks.set(networkBlock.hash, networkBlock),
          tipHash: networkBlock.hash
        };
        
        logger.block(newHeight, networkBlock.hash, proposerConfig.id);
        // Broadcast to all peers
        proposerNode.broadcastBlock(networkBlock);

        // Update dashboard immediately with new state
        const dashboardState = Object.fromEntries(
          Object.entries(localStates).map(([id, state]) => [
            id,
            {
              height: state.height,
              balances: ImmutableMap(
                Object.entries(state.balances.toObject()).map(([key, value]) => [
                  key as Account,
                  value
                ])
              ),
              tipHash: state.tipHash,
              blocks: state.blocks
            }
          ])
        );

        dashboard.broadcastNetworkState({
          nodeStates: dashboardState,
          nodeConfigs: NODES_CONFIG
        });
      }

      // Sleep a bit
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
    }
  };

  runSimulation();

  // Cleanup
  process.on('SIGINT', async () => {
    logger.info('\nShutting down simulation...');
    running = false;
    nodes.forEach(n => n.close());
    await dashboard.close();
    process.exit();
  });
}

main().catch(error => {
  logger.error('Fatal error:', undefined, error);
  process.exit(1);
});
