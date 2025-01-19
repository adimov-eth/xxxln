* Depository The smart contract that manages reserves, channels, and disputes.
* Server
   * A Server is the root machine initially created for each user - their personal unique machine.
   * Every 100 milliseconds, it aggregates all incoming requests/messages and forms a block with a transaction map.
   * Sends this block/map to signers for signature.
   * Each signer creates their own block where they change their state according to received data.
   * The server waits for finalized blocks from all signers, aggregates these blocks into a Merkle tree, updates its state, and finalizes the block.
   * Forms a set of messages that need to be sent to other servers.
   * Distributes these messages to other servers.
* Signer
   * A Signer encapsulates all entities associated with a specific private key.
   * Its root machine stores the private key used for signing transactions.
   * The Signer receives messages from other signers and directs them to Entities. Signers communicate with each other as representatives of certain entities.
   * Signer is a parent or super-machine for Entities. They handle entity-level consensus, which can be automatic if consisting of a single signer acting as both proposer and validator for that entity.
   * Or a signer, as a DAO participant, can act as a proposer, validator, or observer.
* Entity
   * An Entity is essentially an account abstraction. An entity can be anything, for example: a personal wallet, company wallet (DAO), payment hub/exchange, and essentially decentralized applications of any complexity.
   * All entity management always happens through a proposal mechanism. A quorum of signers decides all entity management issues.
* Channel
   * A Channel is an abstraction for message transmission between entities. It's essentially a machine that is replicated in both entities.
   * The channel is effectively a bilateral account.


Mempool Building at Server Level:

The server receives requests that are either:
Directed to sub-machines (signers)
Executed in the context of the server machine itself
Mempool Structure:

Uses Ethereum RLP encoding
Contains an array of bytes32 keys and corresponding values
Example: If there are 5 keys and 7 values:
First 5 values go to sub-machines (signers)
Last 2 values are machine-level transactions (e.g., creating a new signer)
Block Structure:

Reference to previous block
Mempool (long buffer string)
State hash (contains content of all sub-machines and machine state)
Stored in LevelDB under block hash
Root machine state stored under server ID (0) in LevelDB
Message Flow:

Messages can come through:
WebSocket from user wallet (with special token for authorization)
Directed to specific entities
Server receives and accumulates all external messages
Signer receives messages from user wallet
Transaction Processing:

Server acts as entry point for all incoming messages
Processes them every 100ms:
Aggregates incoming messages
Forms block with transaction map
Distributes to appropriate sub-machines
Uses Promise.all for parallel processing
Handles machine-level transactions directly
Security Model:

Initial implementation focuses on basic functionality without signatures
Signatures become relevant at entity level, not needed at server/signer level
Authentication uses API tokens rather than private keys
Hierarchical access control based on machine level (higher level = more control)


