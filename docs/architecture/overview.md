# Extended Payment Network Architecture Overview

## Introduction

The Extended Payment Network is a scalable, decentralized payment system built on an actor-based architecture with hierarchical state management. The system combines off-chain payment channels with multi-signature capabilities and event-driven communication to enable efficient, secure transactions.

## Core Architecture Principles

1. **Actor-Based Design**
   - System built using the actor model pattern
   - Each component is an isolated actor communicating through messages
   - Hierarchical structure with clear parent-child relationships
   - Event-driven state updates

2. **Layered Architecture**
   - Base Layer: Depository contract for core mechanics
   - Protocol Layer: Message handling and state synchronization
   - Application Layer: User interfaces and API endpoints

3. **State Management**
   - Hierarchical State-Time Machine (HSTM)
   - Merkle-based state verification
   - Event-sourced state updates
   - Consensus-driven finality

## System Components

For detailed information about each component, see [Components](./components.md).

1. **Core Machines**
   - Signer Machine (Root)
   - Entity Machine
   - Channel Machine
   - Depository Machine

2. **Communication System**
   - Transaction Inboxes/Outboxes
   - Event Propagation
   - Message Validation

3. **State Infrastructure**
   - LevelDB Storage
   - Merkle Tree Verification
   - Block Processing
   - Consensus Mechanism

## Key Features

1. **Scalability**
   - Off-chain state channels
   - Batched state updates
   - Efficient state synchronization
   - Hierarchical state management

2. **Security**
   - Multi-signature support
   - Cryptographic state verification
   - Dispute resolution
   - Byzantine fault tolerance

3. **Flexibility**
   - Programmable entities
   - Custom governance rules
   - Extensible protocol
   - Multiple token support

## Implementation

For technical details and implementation guides, see:
- [State Management](../implementation/state-management.md)
- [Entities](../implementation/entities.md)
- [Channels](../implementation/channels.md)

## Technical Details

For in-depth technical documentation, see:
- [Merkle Trees](../technical/merkle.md)
- [Consensus](../technical/consensus.md)
- [Storage](../technical/storage.md) 