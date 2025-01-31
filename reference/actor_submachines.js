/**
 * DEMO: Single-Node Blockchain with Actor-Like Submachines
 *
 * This example expands on the single-node logic to store submachine "actors"
 * in state. Each submachine has:
 *   - A unique submachineId
 *   - A type (e.g., "COUNTER" actor)
 *   - An internal "state" object
 *
 * Transactions can:
 *   - SPAWN_ACTOR       -> create a new submachine
 *   - ACTOR_MESSAGE     -> send a message to an existing actor
 *
 * For demonstration, we define a "COUNTER" actor that increments/decrements
 * a simple integer count on messages like { cmd: "INC" } or { cmd: "DEC" }.
 *
 * The chain stores all submachines in `state.submachines` as a Map:
 *   submachineId -> { type: string, state: any }
 *
 * When a transaction references an actor, we look up the actor "type" and
 * "state," apply logic, and store the updated actor state back in submachines.
 *
 * Usage:
 *   node actor_submachines.js
 *     - Produces blocks every 100ms
 *     - Submits some sample "SPAWN_ACTOR" & "ACTOR_MESSAGE" transactions
 *     - Logs final chain state
 */

const crypto = require('crypto');
const level = require('level');

/* ------------------------------------------------------------------
 *  HELPER: Compute SHA-256 Hash of a JS object
 * ------------------------------------------------------------------ */
function computeHash(obj) {
  const str = JSON.stringify(obj);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/* ------------------------------------------------------------------
 *  HELPER: Signature Verification (STUB)
 * ------------------------------------------------------------------ */
function verifySignature(_tx) {
  // Real systems must implement cryptographic checks.
  return true;
}

/* ------------------------------------------------------------------
 *  SUBMACHINE (ACTOR) LOGIC
 * ------------------------------------------------------------------ */

/**
 * applyActorMessage(actor, message) -> newActor
 *
 * `actor` = { type: string, state: any }
 * `message` = user-defined object, e.g. { cmd: "INC" }
 *
 * Returns an updated { type, state } after applying the message.
 * You can also return additional “spawn” commands or new transactions,
 * but we'll keep it simple for now.
 */
function applyActorMessage(actor, message) {
  switch (actor.type) {
    case 'COUNTER':
      // We assume actor.state = { count: number }
      if (message.cmd === 'INC') {
        return {
          type: 'COUNTER',
          state: { count: actor.state.count + 1 }
        };
      } else if (message.cmd === 'DEC') {
        return {
          type: 'COUNTER',
          state: { count: actor.state.count - 1 }
        };
      }
      // No known command => no change
      return actor;

    default:
      // Unrecognized actor type => no change
      return actor;
  }
}

/* ------------------------------------------------------------------
 *  CREATE / SPAWN ACTORS
 * ------------------------------------------------------------------ */
/**
 * spawnActor(type, initialState?)
 * For example:
 *   spawnActor("COUNTER", { count: 0 })
 *
 * Returns a new actor structure: { type, state }.
 * In a real system, you'd check if `type` is valid.
 */
function spawnActor(type, initialState) {
  return { type, state: initialState };
}

/* ------------------------------------------------------------------
 *  BLOCKCHAIN STATE
 * ------------------------------------------------------------------ */

/**
 * Our global state includes:
 *  - blockHeight: number
 *  - submachines: Map<submachineId, { type, state }>
 *  - latestHash:  string (hash of the latest block)
 *  - nonces:      Map<account, number>
 */
function createState(blockHeight = 0, submachines = new Map(), latestHash = '', nonces = new Map()) {
  return {
    blockHeight,
    submachines,
    latestHash,
    nonces
  };
}

function incrementNonce(state, address) {
  const oldNonce = state.nonces.get(address) || 0;
  const newMap = new Map(state.nonces);
  newMap.set(address, oldNonce + 1);
  return { ...state, nonces: newMap };
}

/* ------------------------------------------------------------------
 *  BLOCK, TRANSACTIONS, MEMPOOL
 * ------------------------------------------------------------------ */

function createBlock(prevHash, transactions, stateHash) {
  return {
    prevHash,
    transactions,
    stateHash,
    timestamp: Date.now()
  };
}

function createMempool() {
  return [];
}

/* ------------------------------------------------------------------
 *  CHAIN CLASS
 * ------------------------------------------------------------------ */
class Chain {
  constructor(db) {
    this.db = db;
    this.currentState = createState();
  }

  async init() {
    // For simplicity, we assume a fresh chain each time
    // or that the chain is empty. A real system would attempt
    // to load the latest block from db, replay, etc.
    // We'll skip that for brevity.
  }

  /**
   * Produce a new block from the mempool transactions, updating submachines
   */
  async produceBlock(transactions) {
    let newState = { ...this.currentState };

    // Process each transaction
    for (const tx of transactions) {
      if (!verifySignature(tx)) {
        console.log('Invalid signature:', tx);
        continue;
      }
      const currentNonce = newState.nonces.get(tx.senderAddress) || 0;
      if (tx.nonce !== currentNonce) {
        console.log('Invalid nonce for tx:', tx, 'expected:', currentNonce);
        continue;
      }

      // Handle transaction type
      switch (tx.type) {
        case 'SPAWN_ACTOR': {
          // Create new submachine with the given "actor" type
          const newSubmachineId = tx.submachineId; // or generate random ID
          const newActorsMap = new Map(newState.submachines);

          // e.g. we spawn a "COUNTER" actor with initial { count: 0 }
          // or use tx.initialState if provided
          const actor = spawnActor(tx.actorType, tx.initialState || {});
          newActorsMap.set(newSubmachineId, actor);

          newState = { ...newState, submachines: newActorsMap };
          break;
        }
        case 'ACTOR_MESSAGE': {
          // Retrieve the target submachine
          const actor = newState.submachines.get(tx.submachineId);
          if (!actor) {
            console.log('Unknown submachineId:', tx.submachineId);
            break;
          }
          // Apply the message to the actor
          const updatedActor = applyActorMessage(actor, tx.message);
          const updatedMap = new Map(newState.submachines);
          updatedMap.set(tx.submachineId, updatedActor);
          newState = { ...newState, submachines: updatedMap };
          break;
        }
        // Possibly handle other transaction types, e.g. TRANSFER, etc.
        default:
          console.log('Unknown tx type:', tx.type);
      }

      // Increment nonce after successful processing
      newState = incrementNonce(newState, tx.senderAddress);
    }

    // Bump block height
    newState.blockHeight += 1;

    // Compute stateHash
    const stateHash = computeHash({
      blockHeight: newState.blockHeight,
      latestHash: newState.latestHash,
      nonces: Object.fromEntries(newState.nonces),
      // Transform submachines map => object
      submachines: Object.fromEntries(newState.submachines)
    });

    // Create new block
    const block = createBlock(
      newState.latestHash,
      transactions,
      stateHash
    );
    const blockHash = computeHash(block);

    // Update newState with the latest block hash
    newState.latestHash = blockHash;

    // Persist block and newState
    await this.db.put(`block:${blockHash}`, JSON.stringify(block));
    await this.db.put(
      `state:${blockHash}`,
      JSON.stringify({
        ...newState,
        // Convert maps to arrays for storage
        nonces: Array.from(newState.nonces.entries()),
        submachines: Array.from(newState.submachines.entries())
      })
    );

    // Update in-memory pointer
    this.currentState = newState;
    return block;
  }
}

/* ------------------------------------------------------------------
 *  SERVER-ISH CLASS (SINGLE-NODE)
 * ------------------------------------------------------------------ */
class ActorNode {
  constructor(dbPath) {
    this.db = level(dbPath);
    this.chain = new Chain(this.db);
    this.mempool = createMempool();
    this.intervalId = null;
  }

  async init() {
    await this.chain.init();
    console.log('[ActorNode] Initialized chain.');
  }

  // Add transaction to mempool
  async processTransaction(tx) {
    // Real systems might do preliminary checks here
    this.mempool.push(tx);
  }

  // Produce block from mempool
  async produceBlock() {
    if (this.mempool.length === 0) return null;
    const block = await this.chain.produceBlock(this.mempool);
    this.mempool = createMempool();
    return block;
  }

  // Start periodic block production
  start() {
    this.intervalId = setInterval(async () => {
      const block = await this.produceBlock();
      if (block) {
        console.log(`[ActorNode] Produced block #${this.chain.currentState.blockHeight} with hash=${this.chain.currentState.latestHash}`);
      }
    }, 100); // produce blocks every 100ms for demo
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  getCurrentState() {
    return this.chain.currentState;
  }
}

/* ------------------------------------------------------------------
 *  DEMO USAGE
 * ------------------------------------------------------------------ */

/**
 * 1. Initialize the node
 * 2. Spawn a new actor "COUNTER" with submachineId "actor1"
 * 3. Send a few "INC" messages
 * 4. Wait for blocks to finalize
 * 5. Inspect final state
 */
async function runDemo() {
  const node = new ActorNode('./actordb');
  await node.init();

  // Start block production
  node.start();

  // 1) Spawn new actor
  await node.processTransaction({
    type: 'SPAWN_ACTOR',
    submachineId: 'actor1',  // Chosen ID or random
    actorType: 'COUNTER',
    initialState: { count: 0 },
    senderAddress: '0xUserA',
    nonce: 0,
    signature: 'dummy'
  });

  // 2) Send some ACTOR_MESSAGE transactions
  // "INC" the counter
  await node.processTransaction({
    type: 'ACTOR_MESSAGE',
    submachineId: 'actor1',
    message: { cmd: 'INC' },
    senderAddress: '0xUserA',
    nonce: 1,
    signature: 'dummy'
  });

  await node.processTransaction({
    type: 'ACTOR_MESSAGE',
    submachineId: 'actor1',
    message: { cmd: 'INC' },
    senderAddress: '0xUserA',
    nonce: 2,
    signature: 'dummy'
  });

  // Another increment
  await node.processTransaction({
    type: 'ACTOR_MESSAGE',
    submachineId: 'actor1',
    message: { cmd: 'INC' },
    senderAddress: '0xUserA',
    nonce: 3,
    signature: 'dummy'
  });

  // A decrement
  await node.processTransaction({
    type: 'ACTOR_MESSAGE',
    submachineId: 'actor1',
    message: { cmd: 'DEC' },
    senderAddress: '0xUserA',
    nonce: 4,
    signature: 'dummy'
  });

  // Let the node produce a few blocks
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Stop block production
  node.stop();

  // Check final in-memory state
  const finalState = node.getCurrentState();
  console.log('=== Final State ===');
  console.log({
    blockHeight: finalState.blockHeight,
    latestHash: finalState.latestHash,
    submachines: Object.fromEntries(finalState.submachines),
    nonces: Object.fromEntries(finalState.nonces)
  });

  // The "COUNTER" actor at submachineId "actor1" should have count=2
  // Explanation: Started at 0, +1, +1, +1, -1 => ends at 2
}

if (require.main === module) {
  runDemo().catch(err => console.error(err));
}
