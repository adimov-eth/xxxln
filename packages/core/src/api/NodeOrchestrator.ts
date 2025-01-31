import { Either, left, right, isLeft, chain, map } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
import { MachineError, createMachineError, ErrorCode } from '../types/Core';
import { NetworkManager } from '../network/NetworkManager';
import { NodeInfo } from '../network/WebSocketServer';
import { Map as ImmutableMap } from 'immutable';
import { createHash } from 'crypto';
import { EventBus, CentralEventBus } from '../eventbus/EventBus';
import { Message } from '../types/Core';
import { ServerCommand } from '../types/Messages';
import { PublicKey } from '../types/BlockTypes';
import { createEcdsaSignature, verifyEcdsaSignature, derivePublicKey } from '../crypto/EcdsaSignatures';
import { KeyStorage, getKeyStorage } from '../crypto/KeyStorage';
import {
  NodeOrchestratorConfig,
  NodeConfig,
  NodeMetrics,
  NodeHealth,
  NetworkConditions,
  NetworkScenario,
  NetworkMessage,
  NodeEventHandler,
  HierarchyConfig,
  LogLevel,
  NetworkState,
  NetworkTopology
} from '../types/NodeOrchestrator';
import { Transaction, TransactionType } from '../types/MachineTypes';
import { Block, BlockHeader } from '../types/BlockTypes';
import { NetworkBlock } from '../network/WebSocketServer';

/**
 * Node configuration interface (similar to what you have in runNodes.ts)
 */
export interface OrchestratorNodeConfig {
  readonly id: string;
  readonly type: 'signer' | 'entity' | 'other';
  readonly privateKey: string;
  readonly peers: ReadonlyArray<string>;
  readonly port: number;
  readonly host: string;
  readonly isBootstrap?: boolean;
}

/**
 * Create node managers for each configuration.
 * @param configs Array of node configurations
 * @returns Map of nodeId => NetworkManager
 */
export function createNodeManagers(
  configs: ReadonlyArray<OrchestratorNodeConfig>,
  eventBus: EventBus,
  logLevel: LogLevel,
  blockInterval: number,
  nodeHealthMap: Map<string, NodeHealth>
): Either<MachineError, Map<string, NetworkManager>> {
  try {
    const managers = new Map<string, NetworkManager>();
    
    // Build NodeInfo array for each config
    const allNodeInfos: NodeInfo[] = configs.map(cfg => ({
      id: cfg.id,
      address: cfg.host,
      port: cfg.port,
      publicKey: `key_${cfg.id}`,
      status: 'ACTIVE'
    }));

    // Initialize managers
    for (const config of configs) {
      // Gather peer infos for this config
      const initialPeers = allNodeInfos.filter(x => config.peers.includes(x.id));
      getKeyStorage().storePrivateKey(config.id, config.privateKey); // Store keys in KeyStorage
      
      // Build a NetworkManager
      const manager = new NetworkManager(
        config.port, 
        initialPeers, 
        config.id,
        eventBus,
        logLevel
      );
      managers.set(config.id, manager);
    }

    // Return the managers
    return right(managers);
  } catch (error) {
    return left(createMachineError('INTERNAL_ERROR', 'Failed to create node managers', error));
  }
}

// BigInt-safe JSON stringify
const safeStringify = (obj: any): string => {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
};

/**
 * Function that starts a block production loop.
 * Picks a random signer to produce blocks and sends them to peers.
 */
export async function runBlockProductionLoop(
  managers: Map<string, NetworkManager>,
  fetchTransactions: () => Transaction | undefined,
  logger: (msg: string) => void,
  isStopped: () => boolean,
  intervalMs: number
): Promise<void> {
  // Keep a local chain state for each node
  const localChain = new Map<string, {
    height: number;
    tipHash: string;
    blocks: Map<string, NetworkBlock>;
  }>();

  // Initialize local chain
  for (const [nodeId] of managers) {
    localChain.set(nodeId, {
      height: 0,
      tipHash: 'GENESIS',
      blocks: new Map<string, NetworkBlock>()
    });
  }
  
  // Main loop
  while (!isStopped()) {
    // Get next transaction
    const transaction = fetchTransactions();
    if (!transaction) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    // Find only signer nodes
    const signerNodes = Array.from(managers.keys()).filter(
      k =>
        k.toLowerCase().includes('signer')
        || k.toLowerCase().includes('validator')
    );
    if (signerNodes.length === 0) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    // Choose random signer as block proposer
    const proposerId = signerNodes[Math.floor(Math.random() * signerNodes.length)]!;
    const manager = managers.get(proposerId);
    if (!manager) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    // Generate a new block
    const chainState = localChain.get(proposerId)!;
    const newHeight = chainState.height + 1;
    
    const header: BlockHeader = {
      blockNumber: newHeight,
      parentHash: chainState.tipHash,
      proposer: proposerId,
      timestamp: Date.now(),
      transactionsRoot: createHash('sha256').update(safeStringify(transaction)).digest('hex'),
      stateRoot: createHash('sha256').update(safeStringify(transaction)).digest('hex')
    };

    const transactionMessage: Message<ServerCommand> = {
      id: transaction.nonce.toString(),
      type: 'COMMAND',
      payload: {
        type: 'TRANSFER',
        amount: transaction.type === 'TRANSFER' 
          ? (transaction.payload as { amount: number }).amount 
          : 0,
        from: transaction.sender,
        to: transaction.type === 'TRANSFER'
          ? (transaction.payload as { recipient: string }).recipient
          : transaction.sender
      },
      sender: transaction.sender,
      recipient: transaction.type === 'TRANSFER'
        ? (transaction.payload as { recipient: string }).recipient
        : transaction.sender,
      timestamp: transaction.timestamp
    };

    const block: Block = {
      header,
      transactions: [transactionMessage],
      signatures: ImmutableMap<string, string>()
    };

    const blockHash = createHash('sha256').update(safeStringify(block)).digest('hex');
    
    const networkBlock: NetworkBlock = {
      hash: blockHash,
      data: block,
      signature: '' // In a real implementation, we would sign this
    };

    // Accept locally
    chainState.height = newHeight;
    chainState.tipHash = blockHash;
    chainState.blocks.set(blockHash, networkBlock);

    logger(`[${proposerId}] Produced new block #${newHeight} with transaction ${transaction.type}`);

    // Broadcast to network
    manager.broadcastBlock(networkBlock);
    
    // Sleep
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

/**
 * Helper function: sign a hex string using the stored private key for nodeId
 * This uses the ECDSA signing from EcdsaSignatures.
 */
function signHex(msgHex: string, nodeId: string): Either<MachineError, string> {
  // Try to get private key from KeyStorage
  const keyResult = getKeyStorage().getPrivateKey(nodeId);
  if (isLeft(keyResult)) {
    // keyResult is Either<MachineError, string>, so returning it is valid.
    return keyResult;
  }

  const msgBuffer = Buffer.from(msgHex, 'hex');
  return createEcdsaSignature(msgBuffer, keyResult.right);
}

// Add ErrorCode for network errors
const NETWORK_ERROR_CODES = {
  INVALID_CONFIG: 'INVALID_CONFIG' as ErrorCode,
  NETWORK_ERROR: 'NETWORK_ERROR' as ErrorCode,
  INTERNAL_ERROR: 'INTERNAL_ERROR' as ErrorCode
} as const;

type NetworkErrorCode = typeof NETWORK_ERROR_CODES[keyof typeof NETWORK_ERROR_CODES];

// Maintain network state
let currentLogLevel: LogLevel = LogLevel.INFO;
const nodeHealthMap = new Map<string, NodeHealth>();
const eventHandlers = new Set<NodeEventHandler>();

/**
 * Initialize a network of nodes with the given configuration
 */
export async function initializeNodeNetwork(
  managers: Map<string, NetworkManager>,
  config: NodeOrchestratorConfig
): Promise<Either<MachineError, void>> {
  try {
    // Validate config
    if (config.blockProductionInterval < 1000) {
      return left(createMachineError(
        NETWORK_ERROR_CODES.INVALID_CONFIG,
        'Block production interval must be at least 1000ms'
      ));
    }

    // Initialize each manager
    for (const [nodeId, manager] of managers) {
      // Set up health monitoring
      nodeHealthMap.set(nodeId, {
        isHealthy: true,
        lastSeen: Date.now(),
        errors: [],
        metrics: {
          blockHeight: 0,
          peersCount: 0,
          lastBlockTime: Date.now(),
          pendingTransactions: 0,
          networkLatency: 0,
          syncStatus: 'SYNCING'
        }
      });

      // Start health checks
      void startHealthCheck(nodeId, manager);
    }

    return right(undefined);
  } catch (error) {
    return left(createMachineError(
      NETWORK_ERROR_CODES.NETWORK_ERROR,
      'Failed to initialize network',
      error
    ));
  }
}

/**
 * Stop all nodes in the network
 */
export async function stopNodeNetwork(
  managers: Map<string, NetworkManager>
): Promise<void> {
  for (const manager of managers.values()) {
    await manager.stop();
  }
  nodeHealthMap.clear();
  eventHandlers.clear();
}

/**
 * Subscribe to network events
 */
export function subscribeToNodeEvents(
  managers: Map<string, NetworkManager>,
  handler: NodeEventHandler
): void {
  eventHandlers.add(handler);
  
  // Set up event forwarding for each manager
  for (const [nodeId, manager] of managers) {
    manager.on('message', (msg: NetworkMessage) => {
      if (currentLogLevel === LogLevel.DEBUG) {
        console.debug(`[${nodeId}] Received message:`, msg);
      }
      handler(nodeId, msg);
    });
  }
}

/**
 * Get health status for all nodes
 */
export function checkNodeHealth(
  managers: Map<string, NetworkManager>
): Map<string, NodeHealth> {
  return new Map(nodeHealthMap);
}

/**
 * Attempt to reconnect failed nodes
 */
export async function reconnectFailedNodes(
  managers: Map<string, NetworkManager>
): Promise<Either<MachineError, void>> {
  try {
    const reconnectPromises: Promise<void>[] = [];

    for (const [nodeId, health] of nodeHealthMap) {
      if (!health.isHealthy) {
        const manager = managers.get(nodeId);
        if (manager) {
          reconnectPromises.push(manager.reconnect());
        }
      }
    }

    await Promise.all(reconnectPromises);
    return right(undefined);
  } catch (error) {
    return left(createMachineError(
      'INTERNAL_ERROR',
      'Failed to reconnect nodes',
      error
    ));
  }
}

/**
 * Create a test network with the specified size and topology
 */
export async function createTestNetwork(
  size: number,
  topology: NetworkTopology,
  eventBus: EventBus = new CentralEventBus(),
  logLevel: LogLevel = LogLevel.INFO,
  blockInterval: number = 2000
): Promise<Either<MachineError, Map<string, NetworkManager>>> {
  try {
    const configs: OrchestratorNodeConfig[] = [];
    const basePort = 3000;

    for (let i = 0; i < size; i++) {
      const peers = getPeersForTopology(i, size, topology);
      configs.push({
        id: `node${i}`,
        type: i === 0 ? 'signer' : 'other',
        privateKey: `test_key_${i}`,
        peers: peers.map(p => `node${p}`),
        host: 'localhost',
        port: basePort + i,
        isBootstrap: i === 0
      });
    }

    return createNodeManagers(configs, eventBus, logLevel, blockInterval, new Map<string, NodeHealth>());
  } catch (error) {
    return left(createMachineError(
      NETWORK_ERROR_CODES.NETWORK_ERROR,
      'Failed to create test network',
      error
    ));
  }
}

/**
 * Simulate network conditions for testing
 */
export function simulateNetworkConditions(
  managers: Map<string, NetworkManager>,
  conditions: NetworkConditions
): void {
  for (const manager of managers.values()) {
    manager.setNetworkConditions(conditions);
  }
}

/**
 * Run a network scenario for testing
 */
export async function runNetworkScenario(
  managers: Map<string, NetworkManager>,
  scenario: NetworkScenario
): Promise<void> {
  // Apply scenario conditions
  if (scenario.conditions) {
    simulateNetworkConditions(managers, scenario.conditions);
  }

  // Wait for scenario duration
  await new Promise(resolve => setTimeout(resolve, scenario.duration));

  // Heal network if requested
  if (scenario.healNetwork) {
    simulateNetworkConditions(managers, {
      latency: 0,
      packetLoss: 0,
      partition: false
    });
  }
}

/**
 * Set the current logging level
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

// Private helper functions

function getPeersForTopology(
  nodeIndex: number,
  totalNodes: number,
  topology: NetworkTopology
): number[] {
  switch (topology) {
    case 'MESH':
      return Array.from(
        { length: totalNodes },
        (_, i) => i
      ).filter(i => i !== nodeIndex);
      
    case 'RING':
      return [
        (nodeIndex - 1 + totalNodes) % totalNodes,
        (nodeIndex + 1) % totalNodes
      ];
      
    case 'STAR':
      return nodeIndex === 0
        ? Array.from({ length: totalNodes - 1 }, (_, i) => i + 1)
        : [0];
      
    default:
      return [];
  }
}

async function startHealthCheck(
  nodeId: string,
  manager: NetworkManager
): Promise<void> {
  const CHECK_INTERVAL = 5000; // 5 seconds

  setInterval(async () => {
    try {
      const metrics = await manager.getMetrics();
      const health = nodeHealthMap.get(nodeId);
      
      if (health) {
        nodeHealthMap.set(nodeId, {
          ...health,
          isHealthy: true,
          lastSeen: Date.now(),
          metrics
        });
      }
    } catch (err) {
      const error = err as Error;
      const health = nodeHealthMap.get(nodeId);
      if (health) {
        nodeHealthMap.set(nodeId, {
          ...health,
          isHealthy: false,
          errors: [...health.errors, error.message]
        });
      }
    }
  }, CHECK_INTERVAL);
}

// Export additional types
export type {
  NetworkConditions,
  NetworkScenario,
  NodeEventHandler
} from '../types/NodeOrchestrator';

// Re-export types
export type {
  NodeHealth,
  NodeConfig,
  NodeMetrics,
  NetworkState,
  NetworkTopology,
  LogLevel
} from '../types/NodeOrchestrator'; 