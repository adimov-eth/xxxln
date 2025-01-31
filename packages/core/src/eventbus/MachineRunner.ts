import { pipe } from 'fp-ts/function';
import { fold } from 'fp-ts/Either';
import { BaseMachine } from './BaseMachine';
import { createMachineError } from '../types/Core';

/**
 * Configuration for machine runner
 */
export interface MachineRunnerConfig {
  // How long to wait between checking inbox when empty (ms)
  readonly pollInterval: number;
  
  // Maximum number of events to process per tick
  readonly maxEventsPerTick: number;
  
  // Whether to continue on error or stop
  readonly continueOnError: boolean;
}

const DEFAULT_CONFIG: MachineRunnerConfig = {
  pollInterval: 50,
  maxEventsPerTick: 100,
  continueOnError: true
};

/**
 * Runs the event processing loop for a machine
 */
export class MachineRunner {
  private readonly machine: BaseMachine;
  private readonly config: MachineRunnerConfig;
  private isRunning: boolean = false;

  constructor(
    machine: BaseMachine,
    config: Partial<MachineRunnerConfig> = {}
  ) {
    this.machine = machine;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
  }

  /**
   * Start processing events from the machine's inbox
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    await this.runEventLoop();
  }

  /**
   * Stop processing events
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Main event processing loop
   */
  private async runEventLoop(): Promise<void> {
    while (this.isRunning) {
      const processedCount = await this.processPendingEvents();

      if (processedCount === 0) {
        // No events processed, wait before checking again
        await new Promise(resolve => setTimeout(resolve, this.config.pollInterval));
      }
    }
  }

  /**
   * Process pending events in the machine's inbox
   * Returns number of events processed
   */
  private async processPendingEvents(): Promise<number> {
    let processedCount = 0;

    while (
      this.isRunning && 
      this.machine.inbox.length > 0 && 
      processedCount < this.config.maxEventsPerTick
    ) {
      const event = this.machine.inbox.shift()!;

      try {
        const result = await this.machine.handleEvent(event);
        await pipe(
          result,
          fold(
            error => {
              // Log error
              console.error('Error processing event:', {
                machineId: this.machine.id,
                eventId: event.id,
                error
              });

              // Stop if configured to do so
              if (!this.config.continueOnError) {
                this.stop();
              }

              return Promise.resolve();
            },
            () => Promise.resolve()
          )
        );
      } catch (error) {
        console.error('Unexpected error processing event:', {
          machineId: this.machine.id,
          eventId: event.id,
          error
        });

        if (!this.config.continueOnError) {
          this.stop();
          throw createMachineError(
            'INTERNAL_ERROR',
            'Unexpected error in event processing',
            error
          );
        }
      }

      processedCount++;
    }

    return processedCount;
  }
} 