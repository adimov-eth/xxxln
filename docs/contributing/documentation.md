# Documentation Guidelines

This guide outlines our documentation standards and best practices for maintaining clear, accurate, and useful documentation.

## Documentation Structure

### Repository Documentation

```
docs/
├── README.md              # Overview and getting started
├── SUMMARY.md            # Documentation index
├── architecture/         # System architecture
│   ├── overview.md
│   ├── components.md
│   └── protocols.md
├── implementation/       # Implementation details
│   ├── state-management.md
│   ├── entities.md
│   └── channels.md
├── technical/           # Technical specifications
│   ├── merkle.md
│   ├── consensus.md
│   └── storage.md
├── tutorials/           # Step-by-step guides
│   ├── local-network.md
│   ├── signer-entity.md
│   └── channels.md
└── contributing/        # Contribution guides
    ├── setup.md
    ├── guidelines.md
    ├── testing.md
    └── documentation.md
```

## Documentation Standards

### Markdown Style

1. **Headers**
```markdown
# Top-Level Header
## Section Header
### Subsection Header
#### Minor Section
```

2. **Code Blocks**
```markdown
\```typescript
// Always specify language
const example = "code";
\```
```

3. **Lists**
```markdown
1. Ordered List
2. Second Item
   - Nested Item
   - Another Nested Item
3. Third Item

- Unordered List
- Second Item
  - Nested Item
  - Another Nested Item
```

4. **Links**
```markdown
[Link Text](./relative/path/to/file.md)
[External Link](https://example.com)
```

### Code Documentation

1. **Function Documentation**
```typescript
/**
 * Validates and processes a transaction
 * 
 * @param transaction - The transaction to validate
 * @returns Either an error or the processed transaction
 * 
 * @example
 * ```typescript
 * const result = validateTransaction({
 *   amount: 100,
 *   recipient: 'bob'
 * });
 * ```
 */
const validateTransaction = (
  transaction: Transaction
): Either<ValidationError, Transaction> => {
  // Implementation
};
```

2. **Interface Documentation**
```typescript
/**
 * Represents a validated transaction
 * 
 * @property amount - The transaction amount (must be positive)
 * @property recipient - The recipient's address
 * @property timestamp - When the transaction was created
 */
interface Transaction {
  readonly amount: number;
  readonly recipient: string;
  readonly timestamp: number;
}
```

3. **Module Documentation**
```typescript
/**
 * @module EntityMachine
 * 
 * Provides functionality for managing multi-signature entities
 * in the payment network. Handles proposal creation, approval,
 * and execution with configurable thresholds.
 * 
 * @example
 * ```typescript
 * const entity = await createEntityMachine(config);
 * await entity.handleEvent(proposalMessage);
 * ```
 */
```

## API Documentation

### Public API Documentation

1. **Function Signatures**
```typescript
/**
 * Creates a new entity machine with the given configuration
 * 
 * @param id - Unique identifier for the entity
 * @param parentId - ID of the parent server machine
 * @param config - Entity configuration
 * @param eventBus - Event bus instance
 * 
 * @returns Either an error or the created entity machine
 * 
 * @throws {ValidationError} If config is invalid
 * 
 * @example
 * ```typescript
 * const result = await createEntityMachine(
 *   'entity1',
 *   'server1',
 *   { threshold: 2, signers: Map() },
 *   eventBus
 * );
 * ```
 */
export const createEntityMachine = (
  id: string,
  parentId: string,
  config: EntityConfig,
  eventBus: EventBus
): Promise<Either<Error, EntityMachine>>;
```

2. **Type Definitions**
```typescript
/**
 * Configuration for an entity machine
 * 
 * @property threshold - Number of signatures required
 * @property signers - Map of signer IDs to weights
 * @property admins - Optional list of admin IDs
 */
export interface EntityConfig {
  readonly threshold: number;
  readonly signers: Map<string, number>;
  readonly admins?: ReadonlyArray<string>;
}
```

3. **Error Types**
```typescript
/**
 * Possible error codes from entity operations
 * 
 * @property INVALID_CONFIG - Configuration validation failed
 * @property UNAUTHORIZED - Signer not authorized
 * @property THRESHOLD_NOT_MET - Not enough signatures
 */
export type EntityErrorCode =
  | 'INVALID_CONFIG'
  | 'UNAUTHORIZED'
  | 'THRESHOLD_NOT_MET';
```

## Tutorial Writing

### Structure

1. **Prerequisites**
```markdown
## Prerequisites

- Node.js 18+
- pnpm installed
- Basic TypeScript knowledge
- Understanding of concept X
```

2. **Step-by-Step Guide**
```markdown
## Step 1: Project Setup

First, create a new project:

\```bash
mkdir my-project
cd my-project
pnpm init
\```

## Step 2: Implementation

Add the following code:

\```typescript
// Implementation details
\```

## Step 3: Testing

Run the tests:

\```bash
pnpm test
\```
```

3. **Examples**
```markdown
## Complete Example

Here's a working example:

\```typescript
// Full working example
\```

## Next Steps

- Link to related tutorials
- Advanced topics
- Further reading
```

## Architecture Documentation

### Component Documentation

1. **Overview**
```markdown
# Entity Component

The Entity component manages multi-signature accounts with:
- Configurable signature thresholds
- Proposal-based transaction flow
- Event-driven state updates
```

2. **Diagrams**
```markdown
## State Flow

\```mermaid
stateDiagram-v2
  [*] --> Created
  Created --> Active
  Active --> Disputed
  Disputed --> Resolved
  Resolved --> [*]
\```
```

3. **Interactions**
```markdown
## Component Interactions

1. Signer -> Entity: Propose transaction
2. Entity -> EventBus: Broadcast proposal
3. Other Signers -> Entity: Approve proposal
4. Entity -> Network: Execute transaction
```

## Best Practices

1. **General Guidelines**
   - Use clear, concise language
   - Keep documentation close to code
   - Update docs with code changes
   - Include working examples

2. **Code Examples**
   - Always use TypeScript
   - Include type annotations
   - Show error handling
   - Demonstrate best practices

3. **Markdown Style**
   - Use consistent headers
   - Include table of contents
   - Proper code formatting
   - Regular link checking

4. **Versioning**
   - Document breaking changes
   - Keep version history
   - Mark deprecated features
   - Migration guides

## Documentation Review

### Review Checklist

1. **Technical Accuracy**
   - [ ] Code examples are correct
   - [ ] API signatures match implementation
   - [ ] Error cases documented
   - [ ] Types are accurate

2. **Completeness**
   - [ ] All public APIs documented
   - [ ] Examples for common uses
   - [ ] Error handling shown
   - [ ] Edge cases covered

3. **Clarity**
   - [ ] Clear explanations
   - [ ] Consistent terminology
   - [ ] Proper formatting
   - [ ] No ambiguity

4. **Maintenance**
   - [ ] No outdated content
   - [ ] Links working
   - [ ] Versions aligned
   - [ ] TOC updated

## Tools and Integration

### Documentation Tools

1. **Markdown Linting**
```json
{
  "scripts": {
    "lint:docs": "markdownlint docs/**/*.md",
    "fix:docs": "markdownlint --fix docs/**/*.md"
  }
}
```

2. **Link Checking**
```json
{
  "scripts": {
    "check:links": "markdown-link-check docs/**/*.md"
  }
}
```

3. **API Documentation**
```json
{
  "scripts": {
    "docs:api": "typedoc --out docs/api src/index.ts"
  }
}
```

### Continuous Integration

```yaml
name: Documentation
on: [push, pull_request]

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: pnpm install
      - run: pnpm lint:docs
      - run: pnpm check:links
      - run: pnpm docs:api
```

## Common Issues

1. **Documentation Drift**
   - Regular review cycles
   - Automated checks
   - Version tracking
   - Update reminders

2. **Inconsistent Style**
   - Use style guide
   - Automated linting
   - Templates
   - Peer review

3. **Missing Context**
   - Prerequisites listed
   - Architecture overview
   - Component relationships
   - Use cases

4. **Outdated Examples**
   - Version specific examples
   - Automated testing
   - Regular updates
   - Deprecation notices 