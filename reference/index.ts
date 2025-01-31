const level = require('level')

// -------------------- Core Types --------------------
const createBlock = (prevHash, transactions, stateHash) => ({
  prevHash,
  transactions,
  stateHash,
  timestamp: Date.now()
})

/**
 * Our main "chain state" object:
 *  - blockHeight: current chain height
 *  - submachines: Map of submachineId -> { rootHash, data }
 *  - latestHash: hash of the latest block
 */
const createState = (blockHeight = 0, submachines = new Map(), latestHash = '') => ({
  blockHeight,
  submachines,
  latestHash
})

/**
 * Minimal "RLP" helpers for demonstration.
 * In practice, you'd want a real RLP library.
 */
const encodeRLP = (input) => {
  if (typeof input === 'string') {
    return Buffer.from(input, 'hex')
  }
  if (Array.isArray(input)) {
    return Buffer.concat(input.map(encodeRLP))
  }
  return Buffer.from(String(input))
}

const decodeRLP = (buffer) => buffer.toString('hex')

// -------------------- State Management --------------------
/**
 * Update a single submachine's state object in our global chain state.
 * We'll store an object: { rootHash, data } for each submachine.
 */
const updateSubmachineState = (state, submachineId, newRootHash, newData) => {
  const updatedValue = { rootHash: newRootHash, data: newData }
  const newMap = new Map(state.submachines)
  newMap.set(submachineId, updatedValue)

  return {
    ...state,
    submachines: newMap
  }
}

/**
 * Compute a naive "stateHash" by just hashing (JSON-encoding) the state object.
 */
const computeStateHash = (state) => {
  // Convert submachines Map to a plain object for JSON.
  const submachineObj = {}
  for (const [k, v] of state.submachines.entries()) {
    submachineObj[k] = v
  }

  const stateObj = {
    blockHeight: state.blockHeight,
    submachines: submachineObj,
    latestHash: state.latestHash
  }

  // A toy "hash"—stringify + hex-encode the JSON.
  return Buffer.from(JSON.stringify(stateObj)).toString('hex')
}

// -------------------- Mempool --------------------
const createMempool = () => ({
  transactions: [],
  keyedTransactions: new Map() // submachineId -> transactions
})

const addToMempool = (mempool, transaction) => {
  // If a transaction targets a specific submachine, store separately:
  if (transaction.submachineId) {
    const existing = mempool.keyedTransactions.get(transaction.submachineId) || []
    const newKeyedMap = new Map(mempool.keyedTransactions)
    newKeyedMap.set(transaction.submachineId, [...existing, transaction])
    return {
      ...mempool,
      keyedTransactions: newKeyedMap
    }
  }
  // Otherwise, it's a top-level transaction
  return {
    ...mempool,
    transactions: [...mempool.transactions, transaction]
  }
}

const clearMempool = () => createMempool()

// -------------------- Block Production --------------------
/**
 * Produce a new block from the current mempool, apply all transactions
 * to modify the state, and store the result in LevelDB.
 */
const produceBlock = async (state, mempool, db) => {
  // Collect all transactions
  const transactions = [
    ...mempool.transactions,
    ...Array.from(mempool.keyedTransactions.values()).flat()
  ]

  // Process transactions and compute new state
  let newState = { ...state }

  transactions.forEach((tx) => {
    // If it's a submachine update with arbitrary rootHash:
    if (tx.type === 'SUBMACHINE_UPDATE') {
      const existingSub = newState.submachines.get(tx.submachineId) || { rootHash: '', data: {} }
      newState = updateSubmachineState(
        newState,
        tx.submachineId,
        tx.newRootHash,
        {
          ...existingSub.data,
          // store the entire tx.data if you want or merge as needed
          ...tx.data
        }
      )
    }

    // If it's specifically a "counter increment" transaction:
    if (tx.type === 'COUNTER_INCREMENT') {
      // Grab the existing submachine or create a new one
      const existingSub = newState.submachines.get(tx.submachineId) || {
        rootHash: '0x0',
        data: { counter: 0 }
      }
      const oldCounter = existingSub.data.counter || 0
      const newCounter = oldCounter + tx.amount

      // Recompute rootHash if you like
      const newRootHash = '0x' + newCounter.toString(16)

      newState = updateSubmachineState(
        newState,
        tx.submachineId,
        newRootHash,
        {
          ...existingSub.data,
          counter: newCounter
        }
      )
    }
  })

  // Bump the block height
  newState.blockHeight += 1

  // Construct the block with the final stateHash
  const stateHash = computeStateHash(newState)
  const block = createBlock(state.latestHash, transactions, stateHash)
  const blockHash = computeStateHash(block)

  // Update latestHash on the new state
  newState.latestHash = blockHash

  // Store block and state in LevelDB
  await db.put(`block:${blockHash}`, JSON.stringify(block))
  await db.put(`state:${blockHash}`, JSON.stringify(newState))

  return { block, newState }
}

// -------------------- Server Implementation --------------------
const createServer = (db) => {
  let currentState = createState()
  let currentMempool = createMempool()

  // Accept an incoming transaction and add it to the mempool
  const processTransaction = async (tx) => {
    currentMempool = addToMempool(currentMempool, tx)
  }

  // Manual way to force a block production if desired
  const produceNextBlock = async () => {
    const { block, newState } = await produceBlock(currentState, currentMempool, db)
    currentState = newState
    currentMempool = clearMempool()
    return block
  }

  // Automatically produce blocks every 100ms
  const start = () => {
    setInterval(async () => {
      await produceNextBlock()
    }, 100)
  }

  return {
    processTransaction,
    produceNextBlock,
    getCurrentState: () => currentState,
    start
  }
}

// -------------------- Example Usage --------------------
const initializeSystem = async () => {
  const db = level('./chaindb') // Persist data in ./chaindb directory
  const server = createServer(db)

  // Example transaction: generic SUBMACHINE_UPDATE
  await server.processTransaction({
    type: 'SUBMACHINE_UPDATE',
    submachineId: '0xABC',
    newRootHash: '0x1234',
    data: { info: 'Hello world' }
  })

  // Start block production (every 100ms)
  server.start()

  // State reconstruction: from a target block hash, walk backwards
  const reconstructState = async (targetBlockHash) => {
    let state = createState()
    let currentHash = targetBlockHash

    while (currentHash) {
      const blockData = await db.get(`block:${currentHash}`).catch(() => null)
      if (!blockData) break

      const block = JSON.parse(blockData)

      // Re-apply all transactions from this block to "rebuild" the state
      block.transactions.forEach((tx) => {
        if (tx.type === 'SUBMACHINE_UPDATE') {
          const existing = state.submachines.get(tx.submachineId) || { rootHash: '', data: {} }
          state = updateSubmachineState(
            state,
            tx.submachineId,
            tx.newRootHash,
            {
              ...existing.data,
              ...tx.data
            }
          )
        }
        if (tx.type === 'COUNTER_INCREMENT') {
          const existing = state.submachines.get(tx.submachineId) || {
            rootHash: '0x0',
            data: { counter: 0 }
          }
          const oldCounter = existing.data.counter || 0
          const newCounter = oldCounter + tx.amount
          const newRootHash = '0x' + newCounter.toString(16)
          state = updateSubmachineState(state, tx.submachineId, newRootHash, {
            ...existing.data,
            counter: newCounter
          })
        }
      })

      // Move to the previous block
      currentHash = block.prevHash
    }
    return state
  }

  return { server, db, reconstructState }
}

// -------------------- Testing Helpers --------------------
/**
 * Create a "COUNTER_INCREMENT" transaction for a given submachine ID.
 * This increments the submachine's counter by `amount`.
 */
const createCounterTx = (submachineId, amount) => ({
  type: 'COUNTER_INCREMENT',
  submachineId,
  amount
})

// -------------------- Example Test Flow --------------------
const runTest = async () => {
  const { server, reconstructState } = await initializeSystem()

  // Submit several "COUNTER_INCREMENT" transactions
  for (let i = 1; i <= 5; i++) {
    await server.processTransaction(createCounterTx('0xCOUNTER', 2))
  }

  // Wait some milliseconds so a few blocks are produced
  await new Promise((resolve) => setTimeout(resolve, 700))

  // Check current server state
  const currentState = server.getCurrentState()
  console.log('--- Current Chain State ---')
  console.log(currentState)

  // The submachine with ID '0xCOUNTER' should have a counter of 10 (5 increments * 2 each).
  const subData = currentState.submachines.get('0xCOUNTER')
  console.log('Counter submachine data:', subData)

  // Reconstruct the state from the chain
  const rebuiltState = await reconstructState(currentState.latestHash)
  console.log('--- Reconstructed State ---')
  console.log(rebuiltState.submachines.get('0xCOUNTER'))
}

runTest().catch(console.error)
