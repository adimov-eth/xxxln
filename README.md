# Extended Payment Network

## Overview
A scalable, decentralized payment network built on an actor-based architecture with hierarchical state management. The system combines off-chain payment channels with multi-signature capabilities and event-driven communication to enable efficient, secure transactions.

## Key Features
- 🏗️ Hierarchical State-Time Machine (HSTM) architecture
- 🔐 Multi-signature entity support
- 📨 Actor-based message passing
- ⚡ Off-chain payment channels
- 🔄 Event-driven state management
- 🌐 Distributed consensus mechanism

## Documentation

### Architecture
- [Overview](docs/architecture/overview.md) - High-level system architecture
- [Components](docs/architecture/components.md) - Detailed component descriptions
- [Protocols](docs/architecture/protocols.md) - Communication and consensus protocols

### Implementation
- [State Management](docs/implementation/state-management.md)
- [Entities](docs/implementation/entities.md)
- [Channels](docs/implementation/channels.md)

### Technical Details
- [Merkle Trees](docs/technical/merkle.md)
- [Consensus](docs/technical/consensus.md)
- [Storage](docs/technical/storage.md)

## Repository Structure
```
packages/
├── contracts/    # Smart contracts
├── node/        # Node implementation
├── types/       # TypeScript types
├── webapp/      # Web interface
└── devtools/    # Development tools

docs/
├── architecture/  # System architecture
├── implementation/# Implementation details
└── technical/     # Technical specifications
```

## Getting Started

### Prerequisites
- Node.js 16+
- TypeScript 4.5+
- Ethereum development environment

### Installation
```bash
# Clone the repository
git clone https://github.com/yourusername/payment-network.git

# Install dependencies
yarn install

# Build all packages
yarn build

# Run tests
yarn test
```

### Quick Start
```typescript
import { SignerMachine } from '@payment-network/node';

// Create a signer
const signer = await SignerMachine.create({
  privateKey: '0x...',
  network: 'testnet'
});

// Create an entity
const entity = await signer.createEntity({
  name: 'MyEntity',
  threshold: 1
});

// Open a payment channel
const channel = await entity.openChannel({
  counterparty: '0xCounterpartyAddress',
  deposit: '1.0',
  token: 'ETH'
});
```

## Contributing
Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.