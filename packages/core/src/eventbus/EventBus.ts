import { Map } from 'immutable';
import { MachineEvent, Message } from '../types/Core';
import { BaseMachine } from './BaseMachine';

/**
 * Core event bus interface for routing events between machines
 */
export interface EventBus {
  // Register a machine to receive events
  registerMachine(machine: BaseMachine): void;

  // Unregister a machine
  unregisterMachine(machineId: string): void;

  // Post an event to a machine's inbox
  dispatch(event: MachineEvent): void;

  // Subscribe to events of a certain type
  subscribe(type: string, handler: (event: MachineEvent) => void): void;

  // Unsubscribe from events
  unsubscribe(type: string, handler: (event: MachineEvent) => void): void;
}

/**
 * Central event bus implementation that maintains machine registrations and routes events
 */
export class CentralEventBus implements EventBus {
  private machines: Map<string, BaseMachine> = Map();
  private subscriptions: Map<string, Array<(event: MachineEvent) => void>> = Map();

  registerMachine(machine: BaseMachine): void {
    this.machines = this.machines.set(machine.id, machine);
  }

  unregisterMachine(machineId: string): void {
    this.machines = this.machines.delete(machineId);
  }

  dispatch(event: MachineEvent): void {
    // If recipient specified, deliver to that machine's inbox
    if (event.recipient && this.machines.has(event.recipient)) {
      const targetMachine = this.machines.get(event.recipient)!;
      targetMachine.inbox.push(event);
    }

    // Trigger any subscriptions for this event type
    if (this.subscriptions.has(event.type)) {
      const handlers = this.subscriptions.get(event.type)!;
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  subscribe(type: string, handler: (event: MachineEvent) => void): void {
    const handlers = this.subscriptions.get(type) || [];
    this.subscriptions = this.subscriptions.set(type, [...handlers, handler]);
  }

  unsubscribe(type: string, handler: (event: MachineEvent) => void): void {
    const handlers = this.subscriptions.get(type) || [];
    this.subscriptions = this.subscriptions.set(
      type,
      handlers.filter(h => h !== handler)
    );
  }
} 