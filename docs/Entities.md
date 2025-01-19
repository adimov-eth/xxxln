Entities are governance structures in the payment network that can represent either individual users (through a simple private key) or complex organizations (like companies or DAOs) with multiple stakeholders and custom voting rules. In both cases, entities have the power to control payment channels, but while a single-user entity makes decisions directly, a multi-stakeholder entity requires predefined voting or multi-signature processes to take action.

This two-level abstraction (individual/organizational) allows the same payment channel infrastructure to be used seamlessly by both regular users and complex organizations without changing the underlying protocol.


### Core Purpose
Entities are programmable governance structures that allow channels to be controlled by complex organizational structures rather than simple private keys. They essentially determine who has the authority to make decisions and how those decisions are made.

### Key Features

1. **Flexible Control Structures**:
- Multi-signature control of channels
- DAO-like governance structures
- Delegated control and hierarchical permissions
- Dynamic voting thresholds

2. **Board Management**:
- Each entity has a board configuration that defines:
  - A voting threshold
  - A list of delegates with voting powers
  - Can be updated through proposals and voting

3. **Delegate Types**:
Delegates can be of two types:
- EOAs (Externally Owned Accounts): Simple 20-byte addresses
- Nested Entities: Other entities that can participate in governance

### Implementation Details

The `EntityProvider` contract manages entities with these key structures:

```solidity
struct Entity {
    address tokenAddress;    // Token representing membership/stakes
    string name;            // Entity name
    bytes32 currentBoardHash;  // Current active board hash
    bytes32 proposedAuthenticatorHash;  // Proposed board hash
    bool exists;
}

struct Delegate {
    bytes entityId;     // EOA (20 bytes) or entity ID
    uint16 votingPower;  // Delegate's voting weight
}

struct Board {
    uint16 votingThreshold;  // Required voting threshold
    Delegate[] delegates;    // List of delegates with powers
}
```

### Key Operations

1. **Entity Creation**:
```solidity
function createEntity(address tokenAddress, string calldata name) 
    external onlyOwner returns (uint256 entityId)
```

2. **Board Proposal**:
```solidity
function proposeBoard(
    uint256 entityId,
    bytes calldata proposedAuthenticator,
    bytes[] calldata tokenHolders,
    bytes[] calldata signatures
)
```

3. **Signature Validation**:
```solidity
function isValidSignature(
    bytes32 messageHash,
    bytes calldata entityParams,
    bytes[] calldata delegateSignatures,
    bytes32[] calldata entityStack
) external view returns (uint16)
```

### Use Cases

1. **Multi-Signature Control**:
- Multiple parties must sign off on channel operations
- Weighted voting based on stake or role

2. **DAO Governance**:
- Token holders can vote on operations
- Configurable voting thresholds
- Delegated voting rights

3. **Hierarchical Control**:
- Parent entities can control child entities
- Nested governance structures
- Delegated authority chains

4. **Federated Groups**:
- Multiple organizations can jointly manage channels
- Weighted voting rights
- Threshold-based decision making

This entity system provides a flexible foundation for implementing complex organizational structures and governance models within the payment network, allowing for sophisticated control mechanisms while maintaining security and verifiability.