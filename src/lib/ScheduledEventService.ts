/**
 * @file ScheduleEventsService.ts
 * @description Service for processing Discord scheduled events.
 * Handles creating roles and database entries for scheduled events.
 */

import { container } from '@sapphire/framework';
import { GuildScheduledEvent, Role } from 'discord.js';
import { yellow, cyan } from 'colorette';
import { Timestamp } from '@sapphire/timestamp';
import { reasonableTruncate } from './utils';
import { LovelaceLogger, createLogger } from './LovelaceLogger';

/**
 * Custom error for scheduled event service that provides additional context for each event
 */
export class ScheduledEventsServiceError extends Error {
  constructor(
    message: string,
    public readonly eventId: string,
    public readonly eventName: string,
    override cause?: unknown,
  ) {
    super(message);
    this.name = 'ScheduleEventsServiceError'

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScheduledEventsServiceError)
    }
  }
}

/**
 * Result type for batch processing scheduled events
 */
export interface ProcessEventResult {
  event: GuildScheduledEvent | null;
  error?: Error;
}

/**
 * Service to process Discord scheduled events, such as creation of custom roles and database entries for events,
 */
export class ScheduledEventsService {
  private logger: LovelaceLogger = createLogger("Scheduled Event Service")

  /**
   * Processed a guild scheduled event for Lovelace. It creates a custom role and database entry.
   * @param scheduledEvent - The Discord scheduled event to process.
   * @returns {GuildScheduledEvent} A promise that resolves to the {GuildScheduledEvent} if successful, {null} otherwise.
   * @throws {ScheduledEventsServiceError} When the event cannot be proccessed (missing guild, role couldn't be made, write to database failed)
   */
  public async processEvent(
    scheduledEvent: GuildScheduledEvent,
  ): Promise<GuildScheduledEvent> {
    /**
     * 
     */
    const { database, customRoleQueue } = container;
    if (!scheduledEvent.guild) {
      throw new ScheduledEventsServiceError(
        'Failed to fetch a guild from the scheduled event.',
        scheduledEvent.id,
        scheduledEvent.name
      )
    }

    const dbEvent = await database.findScheduledEvent(scheduledEvent.id);
    if (dbEvent) {
      this.logger.info(
        `Scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)} already exists in the database. Skipping...`,
      );
      return scheduledEvent;
    }

    let role: Role;
    try {
      role = await this.createCustomRole(scheduledEvent);
    } catch (error) {
      throw new ScheduledEventsServiceError(
        'Failed to create custom role',
        scheduledEvent.id,
        scheduledEvent.name
      )
    }

    this.logger.info(
      `Created role ${yellow(role.name)} associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]`
    );

    const dbEntry = await database.createScheduledEvent(
      scheduledEvent.id,
      role.id,
    );
    if (!dbEntry) {
      throw new ScheduledEventsServiceError(
        'Failed to create database entry for scheduled event',
        scheduledEvent.id,
        scheduledEvent.name
      );
    }

    customRoleQueue.processQueues();
    // Don't need to manually queue the event creator into customRoleQueue. They trigger the GuildScheduledEventCreate listener which queues
    // the creator then.
    this.logger.info(
      `Wrote scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}] into the database.`,
      'Marked scheduled event ready for custom role assignment queue.',
    );
    return scheduledEvent;
  }


  /**
   * Processes multiple scheduled events in batch.
   * @param events - Map of Discord scheduled events to process
   * @returns A promise that resolves to an array of successfully processed events (or null for failures)
   */
  public async batchProcessEvents(
    events: Map<string, GuildScheduledEvent>,
  ): Promise<ProcessEventResult[]> {
    const results: ProcessEventResult[] = [];
    for (const [_id, event] of events) {
      try {
        const processedEvent = await this.processEvent(event);
        results.push({ event: processedEvent });
      } catch (error) {
        this.logger.warn(
          `Failed to process a scheduled event ${yellow(event.name)}[${cyan(event.id)}] in the scheduled events service.`,
        );
        this.logger.error(error);
        results.push({
          event: null,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }
    return results;
  }

  /**
   * Gets the role ID associated with a scheduled event from the database.
   * @param eventId - The Discord scheduled event ID
   * @returns Promise resolving to the role ID or null if not found
   */
  public async getEventRoleId(eventId: string): Promise<string | null> {
    const { database } = container;
    const dbEvent = await database.findScheduledEvent(eventId);
    return dbEvent?.roleId || null;
  }

  /**
   * Creates a custom role for a scheduled event.
   * @param scheduledEvent - The Discord scheduled event to create a role for.
   * Must have valind guild, scheduledEvent.guild must be non-null.
   * @returns A promise that resolves to the created role
   */
  private async createCustomRole(
    scheduledEvent: GuildScheduledEvent,
  ): Promise<Role> {
    let name: string;
    // Determine datetime or recurrency for role name
    if (!scheduledEvent.recurrenceRule) {
      const startTime = scheduledEvent.scheduledStartAt || new Date(0);
      const timestamp = new Timestamp('MMM-DD HH:mm')
      name = `${reasonableTruncate(scheduledEvent.name)} [${timestamp.display(startTime)}]`;
    } else {
      const { frequency } = scheduledEvent.recurrenceRule;
      let freqString = ['Yearly', 'Monthly', 'Weekly', 'Daily'];
      name = `${reasonableTruncate(scheduledEvent.name)} [${freqString[frequency]}]`;
    }
    // Let Discord.js errors propagate naturally.
    // Caller will catch and wrap with event context
    return await scheduledEvent.guild!.roles.create({
      name: name,
      mentionable: true,
      reason: `Role for the scheduled event ${scheduledEvent.name}.`,
      permissions: [], // Empty permissions array indicates no additional permissions for role
    });
  }
}
