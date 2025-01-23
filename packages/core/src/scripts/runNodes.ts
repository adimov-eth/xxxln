import { NetworkManager } from '../network/NetworkManager';
import { NodeInfo } from '../network/WebSocketServer';
import { createInterface } from 'readline';

type NodeRole = 'VALIDATOR' | 'OBSERVER';

type NodeConfig = {
  port: number;
  id: string;
  address: string;
  role: NodeRole;
};

// Configuration for multiple nodes
const NODES_CONFIG: NodeConfig[] = [
  { port: 3001, id: 'validator1', address: 'localhost', role: 'VALIDATOR' },
  { port: 3002, id: 'validator2', address: 'localhost', role: 'VALIDATOR' },
  { port: 3003, id: 'validator3', address: 'localhost', role: 'VALIDATOR' },
  { port: 3004, id: 'observer1', address: 'localhost', role: 'OBSERVER' }
];

// Default accounts for transactions
const DEFAULT_ACCOUNTS = ['account1', 'account2', 'account3', 'account4'] as const;
type Account = typeof DEFAULT_ACCOUNTS[number];

// Simulated blockchain state
type BlockchainState = {
  height: number;
  balances: Record<Account, number>;
  pendingTransactions: Array<Transaction>;
};

type Transaction = {
  id: string;
  from: Account;
  to: Account;
  amount: number;
  timestamp: number;
};

// Generate random transaction
const generateTransaction = (): Transaction => {
  // Get two different random accounts
  const account1 = DEFAULT_ACCOUNTS[0];
  const account2 = DEFAULT_ACCOUNTS[1];
  return {
    id: Math.random().toString(36).substring(7),
    from: account1,
    to: account2,
    amount: Math.floor(Math.random() * 100) + 1,
    timestamp: Date.now()
  };
};

// Simulate network latency
const simulateLatency = async () => {
  const latency = Math.random() * 200 + 100; // 100-300ms latency
  await new Promise(resolve => setTimeout(resolve, latency));
};

const COLUMN_WIDTH = 40;
const formatColumn = (text: string) => text.padEnd(COLUMN_WIDTH);

const clearScreen = () => {
  console.clear();
  // Print header
  console.log(NODES_CONFIG.map(n => formatColumn(n.id)).join(''));
  console.log(NODES_CONFIG.map(() => '-'.repeat(COLUMN_WIDTH - 1) + ' ').join(''));
};

const logNodeState = (nodeId: string, message: string) => {
  const nodeIndex = NODES_CONFIG.findIndex(n => n.id === nodeId);
  if (nodeIndex >= 0) {
    const spaces = ' '.repeat(nodeIndex * COLUMN_WIDTH);
    const paddedMessage = message.slice(0, COLUMN_WIDTH - 1).padEnd(COLUMN_WIDTH - 1);
    console.log(spaces + paddedMessage);
  }
};

async function main() {
  const nodes: NetworkManager[] = [];
  const state: BlockchainState = {
    height: 0,
    balances: {
      account1: 1000,
      account2: 1000,
      account3: 1000,
      account4: 1000
    },
    pendingTransactions: []
  };

  // Create nodes
  for (const config of NODES_CONFIG) {
    const nodeInfo: NodeInfo = {
      id: config.id,
      address: config.address,
      port: config.port,
      publicKey: `key_${config.id}`,
      status: 'ACTIVE' as const
    };

    const initialPeers = NODES_CONFIG
      .filter(c => c.id !== config.id)
      .map(c => ({
        id: c.id,
        address: c.address,
        port: c.port,
        publicKey: `key_${c.id}`,
        status: 'ACTIVE' as const
      }));

    const node = new NetworkManager(config.port, initialPeers);

    // Set up block handlers
    node.onBlock(async (block: any) => {
      await simulateLatency();
      logNodeState(config.id, `Block ${block.height}`);
      
      if (config.role === 'VALIDATOR') {
        // Validators verify and process blocks
        const transactions = block.transactions as Transaction[];
        transactions.forEach(tx => {
          state.balances[tx.to] += tx.amount;
          state.balances[tx.from] -= tx.amount;
        });
        state.height = block.height;
        
        // Broadcast state update after processing
        node.broadcastStateUpdate({
          height: state.height,
          balances: state.balances,
          timestamp: Date.now()
        });
      }
    });

    // Set up state update handlers
    node.onStateUpdate(async (update: any) => {
      await simulateLatency();
      logNodeState(config.id, `State ${update.height}`);
      
      if (config.role === 'OBSERVER') {
        const balanceStr = Object.entries(update.balances)
          .map(([k, v]) => `${k}:${v}`)
          .join(',');
        logNodeState(config.id, `Balances: ${balanceStr}`);
      }
    });

    nodes.push(node);
  }

  // Wait for connections to establish
  await new Promise(resolve => setTimeout(resolve, 1000));
  clearScreen();
  console.log('Network established, starting simulation...\n');

  // Simulation loop
  let running = true;
  const runSimulation = async () => {
    while (running) {
      // Generate new transactions
      const numTx = Math.floor(Math.random() * 3) + 1;
      const transactions = Array.from(
        { length: numTx },
        generateTransaction
      );

      // Create new block
      const block = {
        height: state.height + 1,
        transactions,
        timestamp: Date.now(),
        previousHash: Math.random().toString(36).substring(7)
      };

      // Get validators
      const validators = nodes.filter((_, i) => 
        NODES_CONFIG[i] && NODES_CONFIG[i].role === 'VALIDATOR'
      );
      
      // Select random validator if available
      if (validators.length > 0) {
        const proposer = validators[Math.floor(Math.random() * validators.length)]!;
        logNodeState(proposer.getNodeInfo().id, `Proposing ${block.height}`);
        proposer.broadcastBlock(block);
      }

      // Wait before next block
      await new Promise(resolve => 
        setTimeout(resolve, 2000 + Math.random() * 1000)
      );
    }
  };

  // Start simulation
  runSimulation();

  // Handle cleanup
  process.on('SIGINT', () => {
    console.log('\nShutting down simulation...');
    running = false;
    nodes.forEach(node => node.close());
    process.exit();
  });
}

main().catch(console.error); 