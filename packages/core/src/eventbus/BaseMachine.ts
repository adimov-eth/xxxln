import { Either } from 'fp-ts/Either';
import { MachineError, MachineEvent } from '../types/Core';
import { EventBus } from './EventBus';

/**
 * Base interface for all actor machines in the system
 */
export interface BaseMachine {
  // Unique identifier for this machine
  readonly id: string;

  // Event queue (inbox) for this machine
  readonly inbox: Array<MachineEvent>;

  // Reference to event bus for publishing events
  readonly eventBus: EventBus;

  // Process an event from the inbox
  handleEvent(event: MachineEvent): Promise<Either<MachineError, void>>;
}

/**
 * Abstract base class that implements common actor machine functionality
 */

export abstract class ActorMachine {
  constructor(
    public readonly id: string,
    public readonly eventBus: EventBus
  ) {}

  abstract handleEvent(event: MachineEvent): Promise<Either<MachineError, void>>;
} 