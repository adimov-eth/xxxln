const initStateRoot = {
    blockTime: 0,
    board: {},
    reserves: {},
    nonces: {},
    proposals: [],
    children: [],
}

export const machine = {
    root: {
        prev: 'hash', //genesisBlock
        prevSig: 'hash', // buffer of id of the machine that signed the previous block
        consesusBlock: 'hash', // next block which is currently proposed and not finalized  
        consensusSig: 'hash', // 
        mempool: []
    },

    genesisBlock: {
        prev: null, //hash of the previous block
        transactionList: [
            {
                signature: "0x123",
                methodName: "constructor",
                data: {
                    blockTime: 1719849600,
                    // board is data structure which describes the board of signers as (treshold, [signers]), signer is a pair (address, weight)
                    // treshold is a number of votes required to sign the block
                    // signers is a list of signers, each signer is a pair (address, weight)
                    board: {
                        treshold: 1,
                        signers: [
                            { address: "0x123", weight: 1 },
                            { address: "0x456", weight: 1 }
                        ]
                    }
                }

            }
        ],
        stateRoot: (prev) => {
            if (prev === null) {
                return initStateRoot;
            }
             
            return prev.stateRoot;
        }

      
    },

}

// proposal is a data structure containing the following fields:
// methodName: name of the method to be called
// data: data to be passed to the method

export const ProposalExample = {
    methodName: "addToMemPool",
    data: {
        machineAddress: "0x123", // address of the machine
        action: "addProposal",
        payload: {
            methodName: "addToMemPool",
            data: {}                                
        }

    }
}

export const BoardExample = {
    treshold: 1,
    signers: [
        { address: "0x123", weight: 1 },
        { address: "0x456", weight: 1 }
    ]
}

export const reservesExample = {
    "0x123": 100,
    "0x456": 100
}

export const noncesExample = {
    "0x123": 0,
    "0x456": 3
}