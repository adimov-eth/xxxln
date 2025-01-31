const crypto = require('crypto');
const level = require('level');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const { Map } = require('immutable');

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

// ========== ACTOR TYPES & LOGIC ==========

// Actor message handlers
const actorHandlers = {
  COUNTER: {
    initialState: () => ({ count: 0 }),
    processMessage: (state, message) => {
      switch (message.cmd) {
        case 'INC':
          return { count: state.count + 1 };
        case 'DEC':
          return { count: state.count - 1 };
        default:
          return state;
      }
    }
  }
  // Add more actor types here
};

// ========== BLOCKCHAIN STATE ==========

function computeHash(obj) {
  const str = JSON.stringify(obj);
  return crypto.createHash('sha256').update(str).digest('hex');
}

function verifySignature(tx) {
  return true; // For demo purposes
}

function createState(
  blockHeight = 0,
  submachines = new Map(),
  latestHash = '',
  nonces = new Map()
) {
  return {
    blockHeight,
    submachines, // Map<submachineId, { type: string, state: any }>
    latestHash,
    nonces
  };
}

function createBlock(prevHash, transactions, stateHash) {
  return {
    prevHash,
    transactions,
    stateHash,
    timestamp: Date.now()
  };
}

// ========== CHAIN CLASS ==========

class Chain {
  constructor(db) {
    this.db = db;
    this.currentState = createState();
    this.initialized = false;
  }

  async init() {
    this.initialized = true;
  }

  async produceBlock(transactions) {
    let newState = { ...this.currentState };

    // Process each transaction
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

      // Handle different transaction types
      switch (tx.type) {
        case 'SPAWN_ACTOR': {
          // Create new actor instance
          const { submachineId, actorType } = tx;
          const handler = actorHandlers[actorType];
          
          if (!handler) {
            console.log('Unknown actor type:', actorType);
            continue;
          }

          const initialState = handler.initialState();
          newState.submachines = newState.submachines.set(submachineId, {
            type: actorType,
            state: initialState
          });
          break;
        }

        case 'ACTOR_MESSAGE': {
          // Process message for existing actor
          const { submachineId, message } = tx;
          const actor = newState.submachines.get(submachineId);

          if (!actor) {
            console.log('Unknown submachineId:', submachineId);
            continue;
          }

          const handler = actorHandlers[actor.type];
          if (!handler) {
            console.log('No handler for actor type:', actor.type);
            continue;
          }

          const newActorState = handler.processMessage(actor.state, message);
          newState.submachines = newState.submachines.set(submachineId, {
            ...actor,
            state: newActorState
          });
          break;
        }

        default:
          console.log('Unknown transaction type:', tx.type);
          continue;
      }

      // Update nonce after successful processing
      const newNonces = new Map(newState.nonces);
      newNonces.set(tx.senderAddress, currentNonce + 1);
      newState.nonces = newNonces;
    }

    // Update block height
    newState.blockHeight += 1;

    // Compute state hash
    const stateHash = computeHash({
      blockHeight: newState.blockHeight,
      submachines: Object.fromEntries(newState.submachines),
      latestHash: newState.latestHash,
      nonces: Object.fromEntries(newState.nonces)
    });

    // Create block
    const block = createBlock(
      newState.latestHash,
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

    // Update in-memory state
    this.currentState = newState;
    return block;
  }

  async receiveBlock(block) {
    const blockHash = computeHash(block);

    if (block.prevHash !== this.currentState.latestHash) {
      console.log('[receiveBlock] Block does not link from our latestHash');
      return;
    }

    // Replay transactions to produce state
    let newState = { ...this.currentState };
    
    for (const tx of block.transactions) {
      const currentNonce = newState.nonces.get(tx.senderAddress) || 0;
      
      if (tx.nonce === currentNonce) {
        switch (tx.type) {
          case 'SPAWN_ACTOR': {
            const { submachineId, actorType } = tx;
            const handler = actorHandlers[actorType];
            
            if (handler) {
              const initialState = handler.initialState();
              newState.submachines = newState.submachines.set(submachineId, {
                type: actorType,
                state: initialState
              });
            }
            break;
          }

          case 'ACTOR_MESSAGE': {
            const { submachineId, message } = tx;
            const actor = newState.submachines.get(submachineId);

            if (actor) {
              const handler = actorHandlers[actor.type];
              if (handler) {
                const newActorState = handler.processMessage(actor.state, message);
                newState.submachines = newState.submachines.set(submachineId, {
                  ...actor,
                  state: newActorState
                });
              }
            }
            break;
          }
        }

        // Update nonce
        const newNonces = new Map(newState.nonces);
        newNonces.set(tx.senderAddress, currentNonce + 1);
        newState.nonces = newNonces;
      }
    }

    newState.blockHeight += 1;

    // Verify state hash matches
    const computedStateHash = computeHash({
      blockHeight: newState.blockHeight,
      submachines: Object.fromEntries(newState.submachines),
      latestHash: newState.latestHash,
      nonces: Object.fromEntries(newState.nonces)
    });

    if (computedStateHash !== block.stateHash) {
      console.log('[receiveBlock] State hash mismatch');
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

    console.log(`[receiveBlock] Accepted block at height ${newState.blockHeight}, hash=${blockHash}`);
  }
}

// ========== NODE CLASS ==========

class Node {
  constructor(port, peers, isAuthority, dbPath) {
    this.port = port;
    this.peers = peers;
    this.isAuthority = isAuthority;
    this.sockets = [];

    this.db = level(dbPath);
    this.chain = new Chain(this.db);
    this.mempool = [];

    this.httpServer = null;
    this.wsServer = null;
  }

  async init() {
    await this.chain.init();
    this.startWebSocketServer();
    this.connectToPeers();
    this.startHttpServer();

    if (this.isAuthority) {
      console.log(`[Node] I am an authority node. Will produce blocks every 3s.`);
      setInterval(async () => {
        if (this.mempool.length === 0) return;
        const block = await this.chain.produceBlock(this.mempool);
        console.log(`Produced block #${this.chain.currentState.blockHeight} => ${this.chain.currentState.latestHash}`);
        this.broadcastBlock(block);
        this.mempool = [];
      }, 3000);
    }
  }

  startHttpServer() {
    this.httpServer = http.createServer((req, res) => {
      if (req.method === 'POST') {
        const parsedUrl = url.parse(req.url, true);
        
        if (parsedUrl.pathname === '/spawn') {
          // POST /spawn?actorType=COUNTER&submachineId=actor1&senderAddress=0xUser&nonce=0
          const tx = {
            type: 'SPAWN_ACTOR',
            actorType: parsedUrl.query.actorType || 'COUNTER',
            submachineId: parsedUrl.query.submachineId || `actor_${Date.now()}`,
            senderAddress: parsedUrl.query.senderAddress || '0xUser',
            nonce: parseInt(parsedUrl.query.nonce || '0', 10),
            signature: 'dummy-sign'
          };
          this.mempool.push(tx);
          res.writeHead(200);
          res.end(`Spawned actor: ${JSON.stringify(tx)}`);
          return;
        }
        
        if (parsedUrl.pathname === '/message') {
          // POST /message?submachineId=actor1&cmd=INC&senderAddress=0xUser&nonce=1
          const tx = {
            type: 'ACTOR_MESSAGE',
            submachineId: parsedUrl.query.submachineId,
            message: { cmd: parsedUrl.query.cmd },
            senderAddress: parsedUrl.query.senderAddress || '0xUser',
            nonce: parseInt(parsedUrl.query.nonce || '0', 10),
            signature: 'dummy-sign'
          };
          this.mempool.push(tx);
          res.writeHead(200);
          res.end(`Sent message: ${JSON.stringify(tx)}`);
          return;
        }

        if (parsedUrl.pathname === '/state') {
          // GET /state - returns current chain state
          res.writeHead(200);
          res.end(JSON.stringify(this.chain.currentState, null, 2));
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this.httpServer.listen(this.port + 1, () => {
      console.log(`[Node] HTTP server listening on port ${this.port + 1}`);
    });
  }

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

// ========== RUN NODE ==========
(async function run() {
  const node = new Node(PORT, PEERS, IS_AUTHORITY, DB_PATH);
  await node.init();

  console.log(`[Node] Running node on port ${PORT}. Peers = ${PEERS}, Authority = ${IS_AUTHORITY}, DB = ${DB_PATH}`);
})(); 