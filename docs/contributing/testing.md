# Testing Guidelines

This guide outlines our testing practices, with a focus on testing functional code and maintaining type safety.

## Testing Philosophy

1. **Pure Function Testing**
   - Test input/output relationships
   - No mocks for pure functions
   - Property-based testing where possible
   - Exhaustive error case coverage

2. **Side Effect Testing**
   - Isolate side effects
   - Use dependency injection
   - Mock external dependencies
   - Test error handling

3. **State Management**
   - Test state transitions
   - Verify immutability
   - Test concurrent operations
   - Validate state invariants

## Test Structure

### Directory Organization

```
packages/core/
  ├── src/
  │   └── machines/
  │       ├── EntityMachine.ts
  │       └── SignerMachine.ts
  └── tests/
      ├── unit/
      │   └── machines/
      │       ├── EntityMachine.test.ts
      │       └── SignerMachine.test.ts
      ├── integration/
      │   └── machines/
      │       └── EntitySigner.test.ts
      └── property/
          └── machines/
              └── EntityProperties.test.ts
```

### Test File Structure

```typescript
import { describe, it, expect } from 'vitest';
import { isLeft, isRight } from 'fp-ts/Either';
import { Map } from 'immutable';

// 1. Imports
import { EntityMachine, createEntityMachine } from '../src/machines/EntityMachine';

// 2. Test Data
const testConfig = {
  threshold: 2,
  signers: Map({
    'signer1': 1,
    'signer2': 1
  })
};

// 3. Test Suites
describe('EntityMachine', () => {
  // 3.1 Unit Tests
  describe('creation', () => {
    it('should create with valid config', () => {
      const result = createEntityMachine('test', 'server1', testConfig);
      expect(isRight(result)).toBe(true);
    });
  });

  // 3.2 Property Tests
  describe('properties', () => {
    // Property test implementations
  });

  // 3.3 Integration Tests
  describe('integration', () => {
    // Integration test implementations
  });
});
```

## Unit Testing

### Pure Function Testing

```typescript
import { Either, isLeft, isRight } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';

// Function to test
const validateAmount = (
  amount: number
): Either<Error, number> =>
  amount > 0
    ? right(amount)
    : left(new Error('Invalid amount'));

// Tests
describe('validateAmount', () => {
  it('should accept positive amounts', () => {
    const result = validateAmount(100);
    expect(isRight(result)).toBe(true);
    if (isRight(result)) {
      expect(result.right).toBe(100);
    }
  });

  it('should reject negative amounts', () => {
    const result = validateAmount(-100);
    expect(isLeft(result)).toBe(true);
    if (isLeft(result)) {
      expect(result.left.message).toBe('Invalid amount');
    }
  });

  it('should reject zero', () => {
    const result = validateAmount(0);
    expect(isLeft(result)).toBe(true);
  });
});
```

### State Transition Testing

```typescript
import { Map } from 'immutable';

interface State {
  readonly balances: Map<string, number>;
  readonly nonce: number;
}

describe('State Transitions', () => {
  const initialState: State = {
    balances: Map({
      'alice': 100,
      'bob': 50
    }),
    nonce: 0
  };

  it('should handle balance updates immutably', () => {
    const newState = updateBalance(
      initialState,
      'alice',
      -30
    );

    // Original state unchanged
    expect(initialState.balances.get('alice')).toBe(100);
    
    // New state has updated balance
    expect(newState.balances.get('alice')).toBe(70);
    
    // Structure is immutable
    expect(newState).not.toBe(initialState);
    expect(newState.balances).not.toBe(initialState.balances);
  });
});
```

## Property Testing

Using fast-check for property-based testing:

```typescript
import * as fc from 'fast-check';
import { isRight } from 'fp-ts/Either';

describe('Transaction Properties', () => {
  // Generator for valid transactions
  const validTransaction = fc.record({
    amount: fc.integer({ min: 1 }),
    recipient: fc.hexaString({ minLength: 40, maxLength: 40 }),
    nonce: fc.nat()
  });

  it('should preserve balance sum', () => {
    fc.assert(
      fc.property(validTransaction, tx => {
        const result = processTransaction(tx);
        if (isRight(result)) {
          const state = result.right;
          const totalBefore = sumBalances(initialState);
          const totalAfter = sumBalances(state);
          return totalBefore === totalAfter;
        }
        return true;
      })
    );
  });

  it('should maintain non-negative balances', () => {
    fc.assert(
      fc.property(validTransaction, tx => {
        const result = processTransaction(tx);
        if (isRight(result)) {
          const state = result.right;
          return Array.from(state.balances.values())
            .every(balance => balance >= 0);
        }
        return true;
      })
    );
  });
});
```

## Integration Testing

### Machine Interaction Testing

```typescript
describe('Entity-Signer Integration', () => {
  it('should process multi-sig transaction', async () => {
    // Setup
    const eventBus = new CentralEventBus();
    const signer1 = new SignerMachine('signer1', eventBus);
    const signer2 = new SignerMachine('signer2', eventBus);
    
    const entityResult = await createEntityMachine(
      'entity1',
      'server1',
      {
        threshold: 2,
        signers: Map({
          [signer1.id]: 1,
          [signer2.id]: 1
        })
      },
      eventBus
    );

    expect(isRight(entityResult)).toBe(true);
    if (!isRight(entityResult)) return;
    
    const entity = entityResult.right;

    // Test multi-sig flow
    const proposal = await entity.handleEvent({
      type: 'PROPOSE_TRANSACTION',
      sender: signer1.id,
      transaction: {
        amount: 100,
        recipient: 'bob'
      }
    });

    expect(isRight(proposal)).toBe(true);

    const approval = await entity.handleEvent({
      type: 'APPROVE_TRANSACTION',
      sender: signer2.id,
      proposalId: proposal.right.id
    });

    expect(isRight(approval)).toBe(true);
    
    // Verify final state
    const state = entity.getState();
    expect(state.proposals.size).toBe(0);
    expect(state.transactions.size).toBe(1);
  });
});
```

## Error Testing

### Network Error Simulation

```typescript
describe('Network Error Handling', () => {
  it('should handle connection failures', async () => {
    const network = new NetworkManager({
      timeout: 100,
      retries: 1
    });

    // Simulate network failure
    network.simulateError('CONNECTION_FAILED');

    const result = await network.connect();
    expect(isLeft(result)).toBe(true);
    if (isLeft(result)) {
      expect(result.left.code).toBe('CONNECTION_FAILED');
    }
  });
});
```

### Timeout Testing

```typescript
describe('Timeout Handling', () => {
  it('should timeout long operations', async () => {
    vi.useFakeTimers();

    const operation = async () => {
      await new Promise(resolve => 
        setTimeout(resolve, 5000)
      );
      return right('success');
    };

    const result = withTimeout(operation, 1000);
    
    vi.advanceTimersByTime(2000);
    
    expect(isLeft(await result)).toBe(true);
    
    vi.useRealTimers();
  });
});
```

## Test Helpers

### State Generators

```typescript
const createTestState = (
  config: Partial<State> = {}
): State => ({
  balances: Map(),
  nonce: 0,
  proposals: Map(),
  ...config
});

const createTestTransaction = (
  config: Partial<Transaction> = {}
): Transaction => ({
  amount: 100,
  recipient: 'test',
  nonce: 0,
  timestamp: Date.now(),
  ...config
});
```

### Error Matchers

```typescript
const expectLeft = <E, A>(
  result: Either<E, A>,
  predicate: (error: E) => boolean
) => {
  expect(isLeft(result)).toBe(true);
  if (isLeft(result)) {
    expect(predicate(result.left)).toBe(true);
  }
};

const expectRight = <E, A>(
  result: Either<E, A>,
  predicate: (value: A) => boolean
) => {
  expect(isRight(result)).toBe(true);
  if (isRight(result)) {
    expect(predicate(result.right)).toBe(true);
  }
};
```

## Test Coverage

### Coverage Requirements

- Minimum 90% line coverage
- 100% coverage of error paths
- All public APIs must be tested
- Property tests for core functionality

### Running Coverage

```bash
# Run tests with coverage
pnpm test --coverage

# Generate HTML report
pnpm test --coverage --reporter=html

# Check coverage thresholds
pnpm test --coverage --threshold=90
```

## Continuous Integration

### GitHub Actions Configuration

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: pnpm install
      - run: pnpm test
      - run: pnpm test:coverage
```

## Best Practices

1. **Test Organization**
   - Group related tests
   - Use descriptive names
   - Follow AAA pattern (Arrange, Act, Assert)
   - Keep tests focused

2. **Test Independence**
   - No shared mutable state
   - Clean up after each test
   - Avoid test ordering dependencies
   - Use fresh instances

3. **Error Testing**
   - Test all error paths
   - Verify error messages
   - Check error types
   - Test recovery paths

4. **Performance**
   - Keep tests fast
   - Avoid unnecessary setup
   - Mock heavy operations
   - Use test doubles wisely 