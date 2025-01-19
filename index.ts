// Types
type Address = string
type Hash = string
type Signature = string
type Timestamp = number

// Core types as readonly
type Transaction = Readonly<{
    id: string
    nonce: number
    sender: Address
    command: string
    data: any
    signature: Signature
    timestamp: Timestamp
}>

type Event = Readonly<{
    id: string
    type: string
    data: any
    source: Address
    timestamp: Timestamp
}>

type Vote = Readonly<{
    proposalId: string
    voterAddress: Address
    nonce: number
    weight: number
    signature: Signature
    timestamp: Timestamp
}>

type Proposal = Readonly<{
    id: string
    nonce: number
    creator: Address
    transaction: Transaction
    baseState: {
        readonly stateRoot: Hash
        readonly blockHeight: number
    }
    votes: Readonly<Record<Address, Vote>>
    threshold: number
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
    expiresAt: Timestamp
    timestamp: Timestamp
}>

type Block = Readonly<{
    height: number
    timestamp: Timestamp
    prevHash: Hash
    transactions: readonly Transaction[]
    events: readonly Event[]
    proposals: Readonly<{
        approved: readonly Proposal[]
        rejected: readonly Proposal[]
        expired: readonly Proposal[]
    }>
    stateRoot: Hash
    merkleRoot: Hash
    signatures: Readonly<Record<Address, Signature>>
}>

type State = Readonly<{
    blockHeight: number
    stateRoot: Hash
    data: Readonly<Record<string, any>>
    nonces: Readonly<Record<Address, number>>
}>

type HSTM = Readonly<{
    id: string
    address: Address
    parentMachine: string | null
    childMachines: readonly string[]
    state: State
    blocks: readonly Block[]
    mempool: Readonly<{
        transactions: readonly Transaction[]
        proposals: Readonly<Record<string, Proposal>>
    }>
    messageChannels: Readonly<{
        txIn: readonly Transaction[]
        txOut: readonly Transaction[]
        eventIn: readonly Event[]
        eventOut: readonly Event[]
    }>
}>

// Pure functions for state transitions
const createHSTM = (config: {
    id: string
    address: Address
    parentMachine?: string
    initialState?: State
}): HSTM => ({
    id: config.id,
    address: config.address,
    parentMachine: config.parentMachine || null,
    childMachines: [],
    state: config.initialState || {
        blockHeight: 0,
        stateRoot: '',
        data: {},
        nonces: {}
    },
    blocks: [],
    mempool: {
        transactions: [],
        proposals: {}
    },
    messageChannels: {
        txIn: [],
        txOut: [],
        eventIn: [],
        eventOut: []
    }
})

// State transitions
const transition = (hstm: HSTM, newState: Partial<State>): HSTM => ({
    ...hstm,
    state: {
        ...hstm.state,
        ...newState,
        stateRoot: computeStateRoot({ ...hstm.state, ...newState })
    }
})

// Block creation
const createBlock = (hstm: HSTM): [HSTM, Block] => {
    const block: Block = {
        height: hstm.state.blockHeight + 1,
        timestamp: Date.now(),
        prevHash: hstm.blocks[hstm.blocks.length - 1]?.stateRoot || '',
        transactions: hstm.mempool.transactions,
        events: [],
        proposals: {
            approved: [],
            rejected: [],
            expired: []
        },
        stateRoot: computeStateRoot(hstm.state),
        merkleRoot: computeMerkleRoot(hstm.mempool.transactions),
        signatures: {
            [hstm.address]: sign(hstm.address, computeMerkleRoot(hstm.mempool.transactions))
        }
    }

    return [
        {
            ...hstm,
            blocks: [...hstm.blocks, block],
            mempool: {
                transactions: [],
                proposals: {}
            }
        },
        block
    ]
}

// Proposal management
const createProposal = (
    hstm: HSTM,
    transaction: Transaction
): [HSTM, Proposal] => {
    const proposal: Proposal = {
        id: generateId(),
        nonce: getNonce(hstm.state, hstm.address),
        creator: hstm.address,
        transaction,
        baseState: {
            stateRoot: hstm.state.stateRoot,
            blockHeight: hstm.state.blockHeight
        },
        votes: {},
        threshold: getThreshold(hstm),
        status: 'PENDING',
        expiresAt: Date.now() + 3600000,
        timestamp: Date.now()
    }

    return [
        {
            ...hstm,
            mempool: {
                ...hstm.mempool,
                proposals: {
                    ...hstm.mempool.proposals,
                    [proposal.id]: proposal
                }
            }
        },
        proposal
    ]
}

const addVote = (
    hstm: HSTM,
    proposalId: string,
    vote: Vote
): [HSTM, Proposal] => {
    const proposal = hstm.mempool.proposals[proposalId]
    if (!proposal) throw new Error('Proposal not found')

    const updatedProposal: Proposal = {
        ...proposal,
        votes: {
            ...proposal.votes,
            [vote.voterAddress]: vote
        }
    }

    const [updatedHSTM, finalProposal] = checkProposalStatus(
        {
            ...hstm,
            mempool: {
                ...hstm.mempool,
                proposals: {
                    ...hstm.mempool.proposals,
                    [proposalId]: updatedProposal
                }
            }
        },
        proposalId
    )

    return [updatedHSTM, finalProposal]
}

// Message processing
const processMessages = (hstm: HSTM): HSTM => {
    const withProcessedTx = processTxIn(hstm)
    const withProcessedEvents = processEventIn(withProcessedTx)
    return cleanupMempool(withProcessedEvents)
}

const processTxIn = (hstm: HSTM): HSTM => {
    const validTxs = hstm.messageChannels.txIn.filter(verifyTransaction)
    
    return {
        ...hstm,
        mempool: {
            ...hstm.mempool,
            transactions: [...hstm.mempool.transactions, ...validTxs]
        },
        messageChannels: {
            ...hstm.messageChannels,
            txIn: []
        }
    }
}

const processEventIn = (hstm: HSTM): HSTM => {
    const processedEvents = hstm.messageChannels.eventIn.reduce(
        handleEvent,
        hstm
    )

    return {
        ...processedEvents,
        messageChannels: {
            ...processedEvents.messageChannels,
            eventIn: []
        }
    }
}

// Helper functions
const checkProposalStatus = (
    hstm: HSTM,
    proposalId: string
): [HSTM, Proposal] => {
    const proposal = hstm.mempool.proposals[proposalId]
    if (!proposal) throw new Error('Proposal not found')

    const totalWeight = Object.values(proposal.votes)
        .reduce((sum, vote) => sum + vote.weight, 0)

    if (totalWeight >= proposal.threshold) {
        const approvedProposal = {
            ...proposal,
            status: 'APPROVED' as const
        }

        return [
            {
                ...hstm,
                mempool: {
                    transactions: [...hstm.mempool.transactions, proposal.transaction],
                    proposals: omit(hstm.mempool.proposals, proposalId)
                }
            },
            approvedProposal
        ]
    }

    return [hstm, proposal]
}

const cleanupMempool = (hstm: HSTM): HSTM => {
    const now = Date.now()
    const [expiredProposals, validProposals] = partition(
        Object.entries(hstm.mempool.proposals),
        ([_, proposal]) => now > proposal.expiresAt
    )

    return {
        ...hstm,
        mempool: {
            ...hstm.mempool,
            proposals: Object.fromEntries(validProposals)
        }
    }
}

// Pure utility functions
const getNonce = (state: State, address: Address): number => 
    (state.nonces[address] || 0) + 1

const getThreshold = (hstm: HSTM): number => 7 // Implementation specific

const computeStateRoot = (state: State): Hash => 
    hash(JSON.stringify(state))

const computeMerkleRoot = (data: any): Hash =>
    hash(JSON.stringify(data))

const verifyTransaction = (tx: Transaction): boolean =>
    true // Implementation specific

const handleEvent = (hstm: HSTM, event: Event): HSTM =>
    hstm // Implementation specific

const sign = (address: Address, data: any): Signature =>
    '' // Implementation specific

const generateId = (): string =>
    Math.random().toString(36).substring(7)

const hash = (data: string): Hash =>
    data // Implementation specific

// Utility functions for immutable operations
const omit = <T extends object, K extends keyof T>(
    obj: T,
    key: K
): Omit<T, K> => {
    const { [key]: _, ...rest } = obj
    return rest
}

const partition = <T>(
    arr: T[],
    predicate: (item: T) => boolean
): [T[], T[]] => {
    const passes: T[] = []
    const fails: T[] = []
    arr.forEach(item => {
        if (predicate(item)) {
            passes.push(item)
        } else {
            fails.push(item)
        }
    })
    return [passes, fails]
}

// API functions - these compose the pure functions above
const submitTransaction = (
    hstm: HSTM,
    tx: Transaction
): HSTM =>
    verifyTransaction(tx)
        ? {
            ...hstm,
            messageChannels: {
                ...hstm.messageChannels,
                txIn: [...hstm.messageChannels.txIn, tx]
            }
        }
        : hstm

const submitProposal = (
    hstm: HSTM,
    tx: Transaction
): [HSTM, Proposal] =>
    createProposal(hstm, tx)

const submitVote = (
    hstm: HSTM,
    proposalId: string,
    vote: Vote
): [HSTM, Proposal] =>
    addVote(hstm, proposalId, vote)

export {
    // Types
    HSTM,
    Block,
    Transaction,
    Proposal,
    Vote,
    Event,
    State,
    
    // Core functions
    createHSTM,
    transition,
    createBlock,
    processMessages,
    
    // API functions
    submitTransaction,
    submitProposal,
    submitVote
}