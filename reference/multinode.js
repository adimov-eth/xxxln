/********************************************************************
 * MULTI-NODE BLOCKCHAIN DEMO
 *
 * Usage:
 *
 *   # Terminal 1: Authority node (produces blocks every 3s)
 *   node multinode.js --port=3001 --peers=3002 --authority=true --db=./db1
 *
 *   # Terminal 2: Non-authority node
 *   node multinode.js --port=3002 --peers=3001,3003 --db=./db2
 *
 *   # Terminal 3: Non-authority node
 *   node multinode.js --port=3003 --peers=3002 --db=./db3
 *
 * Then watch the logs. The authority node prints new blocks,
 * others receive and update their chain. You can also
 * send test transactions via an HTTP endpoint.
 ********************************************************************/

const crypto = require('crypto');
const level = require('level');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

// ========== ARG PARSING ==========
const args = require('minimist')(process.argv.slice(2), {
  default: {
    port: 3001,
    peers: '',
    authority: false,
    db: './db1'
  }
});
const PORT = parseInt(args.port, 10);
const PEERS = args.peers ? args.peers.split(',').map(Number) : [];
const IS_AUTHORITY = args.authority === 'true' || args.authority === true;
const DB_PATH = args.db;

// ========== BASIC BLOCKCHAIN LOGIC ==========
// (Adapted from the single-node example, minus some detail for brevity.)

function computeHash(obj) {
  const str = JSON.stringify(obj);
  return crypto.createHash('sha256').update(str).digest('hex');
}

// For real usage, properly verify cryptographic signatures
function verifySignature(tx) {
  return true;
}

function createBlock(prevHash, transactions, stateHash) {
  return {
    prevHash,
    transactions,
    stateHash,
    timestamp: Date.now()
  };
}

function createState(blockHeight = 0, submachines = new Map(), latestHash = '', nonces = new Map()) {
  return {
    blockHeight,
    submachines,
    latestHash,
    nonces
  };
}

function updateSubmachineState(state, submachineId, newRootHash) {
  const updated = new Map(state.submachines);
  updated.set(submachineId, newRootHash);
  return { ...state, submachines: updated };
}

function incrementNonce(state, address) {
  const oldNonce = state.nonces.get(address) || 0;
  const updatedNonces = new Map(state.nonces);
  updatedNonces.set(address, oldNonce + 1);
  return { ...state, nonces: updatedNonces };
}

class Chain {
  constructor(db) {
    this.db = db;
    // Keep an in-memory pointer to our "head" (latest state)
    this.currentState = createState(); 
    this.initialized = false;
  }

  async init() {
    // On startup, try to find the "latest" block in the DB by scanning
    // or keep a simple reference. For this demo, we’ll assume empty chain.
    // If you want to recover a prior chain, you'd implement that here.
    this.initialized = true;
  }

  async produceBlock(transactions) {
    let newState = { ...this.currentState };
    for (const tx of transactions) {
      if (!verifySignature(tx)) {
        console.log('Invalid tx signature', tx);
        continue;
      }
      const currentNonce = newState.nonces.get(tx.senderAddress) || 0;
      if (tx.nonce !== currentNonce) {
        console.log('Invalid nonce for tx:', tx, 'expected:', currentNonce);
        continue;
      }
      if (tx.type === 'SUBMACHINE_UPDATE') {
        newState = updateSubmachineState(newState, tx.submachineId, tx.newRootHash);
      }
      newState = incrementNonce(newState, tx.senderAddress);
    }
    newState.blockHeight += 1;

    // After applying all transactions, compute the new state's hash
    const stateHash = computeHash({
      blockHeight: newState.blockHeight,
      submachines: Object.fromEntries(newState.submachines),
      latestHash: newState.latestHash,
      nonces: Object.fromEntries(newState.nonces)
    });

    // Create block
    const block = createBlock(
      newState.latestHash, // prevHash
      transactions,
      stateHash
    );
    const blockHash = computeHash(block);
    newState.latestHash = blockHash;

    // Persist block & state
    await this.db.put(`block:${blockHash}`, JSON.stringify(block));
    await this.db.put(`state:${blockHash}`, JSON.stringify({
      ...newState,
      submachines: Array.from(newState.submachines.entries()),
      nonces: Array.from(newState.nonces.entries())
    }));

    // Update in-memory pointer
    this.currentState = newState;
    return block;
  }

  // Called when receiving a new block from a peer
  async receiveBlock(block) {
    // For real usage, you'd check:
    // 1) If block.prevHash is known
    // 2) If block is next in height or a competing chain
    // For simplicity, we just attempt to "apply" it if it references our latestHash

    // Re-compute block hash to confirm authenticity
    const blockHash = computeHash(block);

    // Quick check if this block extends our chain
    if (block.prevHash !== this.currentState.latestHash) {
      console.log('[receiveBlock] The incoming block does not link from our latestHash. (Forking not handled here.)');
      return;
    }

    // We have the transactions, let's apply them to produce state
    const newState = { ...this.currentState };
    for (const tx of block.transactions) {
      const currentNonce = newState.nonces.get(tx.senderAddress) || 0;
      if (tx.nonce === currentNonce) {
        if (tx.type === 'SUBMACHINE_UPDATE') {
          Object.assign(newState, updateSubmachineState(newState, tx.submachineId, tx.newRootHash));
        }
        Object.assign(newState, incrementNonce(newState, tx.senderAddress));
      }
    }
    newState.blockHeight += 1;

    // Check if the block's stateHash matches our computed version
    const computedStateHash = computeHash({
      blockHeight: newState.blockHeight,
      submachines: Object.fromEntries(newState.submachines),
      latestHash: newState.latestHash,
      nonces: Object.fromEntries(newState.nonces)
    });
    if (computedStateHash !== block.stateHash) {
      console.log('[receiveBlock] State hash mismatch — ignoring block.');
      return;
    }

    // Accept block
    newState.latestHash = blockHash;
    await this.db.put(`block:${blockHash}`, JSON.stringify(block));
    await this.db.put(`state:${blockHash}`, JSON.stringify({
      ...newState,
      submachines: Array.from(newState.submachines.entries()),
      nonces: Array.from(newState.nonces.entries())
    }));
    this.currentState = newState;

    console.log(`[receiveBlock] Accepted new block at height ${newState.blockHeight}, hash=${blockHash}`);
  }
}

// ========== NODE (P2P + LOCAL CHAIN) ==========

class Node {
  constructor(port, peers, isAuthority, dbPath) {
    this.port = port;
    this.peers = peers; // array of peer ports
    this.isAuthority = isAuthority;
    this.sockets = [];  // open WebSocket connections to peers

    this.db = level(dbPath);
    this.chain = new Chain(this.db);

    // A simple in-memory mempool
    this.mempool = [];

    // Start an HTTP server to accept transactions
    this.httpServer = null;
    // Start a WS server for p2p
    this.wsServer = null;
  }

  async init() {
    // Initialize local chain
    await this.chain.init();

    // Start P2P
    this.startWebSocketServer();

    // Connect to peers
    this.connectToPeers();

    // Start HTTP for transaction submission
    this.startHttpServer();

    // If this is an authority node, produce blocks periodically
    if (this.isAuthority) {
      console.log(`[Node] I am an authority node. Will produce blocks every 3s.`);
      setInterval(async () => {
        if (this.mempool.length === 0) return; // produce block only if mempool has tx
        const block = await this.chain.produceBlock(this.mempool);
        console.log(`Produced new block #${this.chain.currentState.blockHeight} => ${this.chain.currentState.latestHash}`);
        this.broadcastBlock(block);
        // Clear mempool once mined
        this.mempool = [];
      }, 3000);
    }
  }

  // ========== HTTP SERVER FOR TRANSACTIONS ==========
  startHttpServer() {
    this.httpServer = http.createServer((req, res) => {
      // e.g. POST /tx?type=SUBMACHINE_UPDATE&submachineId=0x123 ...
      if (req.method === 'POST') {
        const parsedUrl = url.parse(req.url, true);
        if (parsedUrl.pathname === '/tx') {
          // parse query params for transaction fields
          const type = parsedUrl.query.type || 'SUBMACHINE_UPDATE';
          const submachineId = parsedUrl.query.submachineId || '0x123';
          const newRootHash = parsedUrl.query.newRootHash || '0xaaa';
          const senderAddress = parsedUrl.query.senderAddress || '0xUserA';
          const nonce = parseInt(parsedUrl.query.nonce || '0', 10);

          const tx = {
            type,
            submachineId,
            newRootHash,
            senderAddress,
            nonce,
            signature: 'dummy-sign'
          };
          this.mempool.push(tx);

          res.writeHead(200);
          res.end(`Transaction queued: ${JSON.stringify(tx)}`);
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this.httpServer.listen(this.port + 1, () => {
      console.log(`[Node] HTTP server listening on port ${this.port + 1} (submit tx via POST /tx?...)`);
    });
  }

  // ========== P2P WEBSOCKETS ==========
  startWebSocketServer() {
    this.wsServer = new WebSocket.Server({ port: this.port }, () => {
      console.log(`[Node] WS server listening on port ${this.port}`);
    });

    this.wsServer.on('connection', (socket) => {
      this.initSocket(socket);
    });
  }

  connectToPeers() {
    this.peers.forEach(peerPort => {
      const peerUrl = `ws://localhost:${peerPort}`;
      console.log(`[Node] Attempting connection to peer: ${peerUrl}`);
      const socket = new WebSocket(peerUrl);
      socket.on('open', () => {
        this.initSocket(socket);
      });
      socket.on('error', (err) => {
        console.log(`[Node] Connection failed to ${peerUrl}: ${err.message}`);
      });
    });
  }

  initSocket(socket) {
    this.sockets.push(socket);
    console.log(`[Node] New connection established. Total peers: ${this.sockets.length}`);

    // Send message to identify ourselves (not strictly needed, but nice to have)
    socket.send(JSON.stringify({ type: 'hello', port: this.port }));

    socket.on('message', async (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (e) {
        console.log('Received non-JSON data:', data);
        return;
      }

      if (msg.type === 'block') {
        // Another node produced a block
        console.log(`[Node] Received block from peer`);
        await this.chain.receiveBlock(msg.block);
      } else if (msg.type === 'hello') {
        console.log(`[Node] Peer says hello from port ${msg.port}`);
      }
    });

    socket.on('close', () => {
      this.sockets = this.sockets.filter(s => s !== socket);
    });
  }

  broadcastBlock(block) {
    const message = JSON.stringify({ type: 'block', block });
    this.sockets.forEach(socket => {
      socket.send(message);
    });
  }
}

// ========== RUN NODES VIA CLI ARGS ==========
(async function run() {
  const node = new Node(PORT, PEERS, IS_AUTHORITY, DB_PATH);
  await node.init();

  console.log(`[Node] Running node on port ${PORT}. Peers = ${PEERS}, Authority = ${IS_AUTHORITY}, DB = ${DB_PATH}`);
})();
