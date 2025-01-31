// Network exports
export * from './network/NetworkManager';
export type { 
  NodeInfo, 
  NetworkMessage, 
  NetworkBlock
} from './network/WebSocketServer';

// Event bus exports
export * from './eventbus/EventBus';

// Type exports
export {
    // From BlockTypes
    type Block as BlockType,
    type BlockHeader,
    type MempoolEntry,
    type MempoolState,
    type BlockProductionConfig,
    type BlockValidationResult,
    type BlockStore,
    createMempoolState,
    createBlockProductionConfig
} from './types/BlockTypes';

export {
    // From Core
    type MachineId,
    type Hash,
    type Machine,
    type MachineError,
    type State,
    type Message,
    type MachineEvent,
    type Block as CoreBlock,
    type Event as CoreEvent,
    createMachineError
} from './types/Core';

export {
    // From Messages
    type MessageKind,
    type ServerCommand,
    type SignerCommand,
    type EntityCommand,
    type ChannelCommand,
    type Command,
    type Event as MessageEvent,
    type Query,
    type Response,
    type ValidationResult,
    type Route
} from './types/Messages';

export {
    // From MachineTypes
    type Transaction,
    type TransactionType,
    type SignedTransaction,
    type EntityConfig,
    type EntityMachine,
    type EntityState,
    type EntityStateData
} from './types/MachineTypes';

// Crypto exports
export { KeyStorage, getKeyStorage } from './crypto/KeyStorage';
export { createEcdsaSignature, verifyEcdsaSignature, derivePublicKey } from './crypto/EcdsaSignatures';

// Hierarchy Management exports
export {
  createEntityForSigner,
  attachEntityToServer,
  connectSignerToEntity,
  registerEntityOnEventBus
} from './state/HierarchyManager';

// Node Orchestrator exports
export {
  createNodeManagers,
  initializeNodeNetwork,
  stopNodeNetwork,
  subscribeToNodeEvents,
  runBlockProductionLoop,
  createTestNetwork,
  simulateNetworkConditions,
  runNetworkScenario,
  setLogLevel,
  checkNodeHealth,
  reconnectFailedNodes
} from './api/NodeOrchestrator';

// Node Orchestrator Types exports
export type {
  NodeHealth,
  NodeConfig,
  NodeMetrics,
  NetworkState,
  NetworkTopology,
  NetworkConditions,
  NetworkScenario,
  NodeEventHandler,
  OrchestratorNodeConfig
} from './api/NodeOrchestrator'; 