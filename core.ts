// Core types
const createBlock = (prevHash, transactions, stateHash) => ({
    prevHash,
    transactions,
    stateHash,
    timestamp: Date.now()
  })
  
  const createState = (blockHeight = 0, submachines = new Map(), latestHash = '') => ({
    blockHeight,
    submachines, // Map of submachineId -> rootHash
    latestHash
  })
  
  // RLP encoding helpers
  const encodeRLP = (input) => {
    if (typeof input === 'string') {
      return Buffer.from(input, 'hex')
    }
    if (Array.isArray(input)) {
      return Buffer.concat([
        ...input.map(encodeRLP)
      ])
    }
    return Buffer.from(input)
  }
  
  const decodeRLP = (buffer) => {
    // Simplified RLP decoding
    return buffer.toString('hex')
  }
  
  // State management
  const updateSubmachineState = (state, submachineId, newRootHash) => ({
    ...state,
    submachines: new Map([...state.submachines, [submachineId, newRootHash]])
  })
  
  const computeStateHash = (state) => {
    const stateObj = {
      blockHeight: state.blockHeight,
      submachines: Object.fromEntries(state.submachines),
      latestHash: state.latestHash
    }
    return Buffer.from(JSON.stringify(stateObj)).toString('hex')
  }
  
  // Mempool management
  const createMempool = () => ({
    transactions: [],
    keyedTransactions: new Map() // submachineId -> transactions
  })
  
  const addToMempool = (mempool, transaction) => {
    if (transaction.submachineId) {
      const existing = mempool.keyedTransactions.get(transaction.submachineId) || []
      return {
        ...mempool,
        keyedTransactions: new Map([
          ...mempool.keyedTransactions,
          [transaction.submachineId, [...existing, transaction]]
        ])
      }
    }
    
    return {
      ...mempool,
      transactions: [...mempool.transactions, transaction]
    }
  }
  
  const clearMempool = () => createMempool()
  
  // Block production
  const produceBlock = async (state, mempool, db) => {
    // Collect all transactions
    const transactions = [
      ...mempool.transactions,
      ...Array.from(mempool.keyedTransactions.values()).flat()
    ]
  
    // Process transactions and compute new state
    const newState = transactions.reduce((currentState, tx) => {
      if (tx.type === 'SUBMACHINE_UPDATE') {
        return updateSubmachineState(currentState, tx.submachineId, tx.newRootHash)
      }
      return currentState
    }, state)
  
    newState.blockHeight += 1
  
    // Create new block
    const block = createBlock(
      state.latestHash,
      transactions,
      computeStateHash(newState)
    )
  
    const blockHash = computeStateHash(block)
    newState.latestHash = blockHash
  
    // Store block and state
    await db.put(`block:${blockHash}`, JSON.stringify(block))
    await db.put(`state:${blockHash}`, JSON.stringify(newState))
  
    return { block, newState }
  }
  
  // Server implementation
  const createServer = (db) => {
    let currentState = createState()
    let currentMempool = createMempool()
  
    const processTransaction = async (tx) => {
      currentMempool = addToMempool(currentMempool, tx)
    }
  
    const produceNextBlock = async () => {
      const { block, newState } = await produceBlock(
        currentState, 
        currentMempool,
        db
      )
      
      currentState = newState
      currentMempool = clearMempool()
      
      return block
    }
  
    // Start block production
    const start = () => {
      setInterval(async () => {
        await produceNextBlock()
      }, 100) // Every 100ms
    }
  
    return {
      processTransaction,
      produceNextBlock,
      getCurrentState: () => currentState,
      start
    }
  }
  
  // Example usage
  const initializeSystem = async () => {
    const level = require('level')
    const db = level('./chaindb')
  
    const server = createServer(db)
  
    // Example transaction processing
    await server.processTransaction({
      type: 'SUBMACHINE_UPDATE',
      submachineId: '0x123',
      newRootHash: '0xabc',
      data: { counter: 1 }
    })
  
    // Start block production
    server.start()
  
    // State reconstruction
    const reconstructState = async (targetBlockHash) => {
      let state = createState()
      let currentHash = targetBlockHash
  
      while (currentHash) {
        const blockData = await db.get(`block:${currentHash}`)
        const block = JSON.parse(blockData)
        
        state = block.transactions.reduce((currentState, tx) => {
          if (tx.type === 'SUBMACHINE_UPDATE') {
            return updateSubmachineState(
              currentState,
              tx.submachineId,
              tx.newRootHash
            )
          }
          return currentState
        }, state)
  
        currentHash = block.prevHash
      }
  
      return state
    }
  
    return {
      server,
      db,
      reconstructState
    }
  }
  
  // Testing helper
  const createTestTransaction = (submachineId, counter) => ({
    type: 'SUBMACHINE_UPDATE',
    submachineId,
    newRootHash: `0x${counter.toString(16)}`,
    data: { counter }
  })
  
  // Example test
  const runTest = async () => {
    const { server, reconstructState } = await initializeSystem()
    
    // Create test transactions
    for (let i = 0; i < 5; i++) {
      await server.processTransaction(
        createTestTransaction('0x123', i)
      )
    }
  
    // Wait for a few blocks
    await new Promise(resolve => setTimeout(resolve, 500))
  
    // Get current state
    const currentState = server.getCurrentState()
    console.log('Current state:', currentState)
  
    // Reconstruct state from a previous block
    const reconstructedState = await reconstructState(currentState.latestHash)
    console.log('Reconstructed state:', reconstructedState)
  }