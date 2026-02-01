/**
 * @file OnEventDelete.ts
 * @description Listener for handling Discord scheduled event deletion.
 * Delegates cleanup to ScheduledEventsService.cleanupEvent().
 */

import { Listener, container } from '@sapphire/framework';
import { Events, GuildScheduledEvent } from 'discord.js';
import { yellow, cyan } from 'colorette';
import { type LovelaceLogger, createListenerLogger } from '../../lib/LovelaceLogger';

/**
 * Listener that handles the deletion of Discord scheduled events.
 * Delegates cleanup to ScheduledEventsService.cleanupEvent() which handles:
 * - Clearing the enrollment queue for the event
 * - Clearing any failed assignments from the dead letter queue
 * - Deleting the associated role
 * - Removing the database entry
 */
export class OnEventDelete extends Listener {
  private logger: LovelaceLogger;

  /**
   * Creates a new OnEventDelete listener
   * @param context - The loader context
   * @param options - The listener options
   */
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      event: Events.GuildScheduledEventDelete,
    });
    this.logger = createListenerLogger(Events.GuildScheduledEventDelete, this.name);
  }

  /**
   * Handles the scheduled event deletion
   * @param scheduledEvent - The deleted scheduled event
   */
  public override async run(scheduledEvent: GuildScheduledEvent) {
    const { scheduledEventsService } = container;

    this.logger.info(
      `Scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}] was deleted. Starting cleanup...`,
    );

    const result = await scheduledEventsService.cleanupEvent(
      scheduledEvent,
      `Deleting role associated with the canceled scheduled event ${scheduledEvent.name}.`,
    );

    if (result.errors.length > 0) {
      this.logger.warn(
        `Cleanup completed with ${result.errors.length} error(s) for event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}]:`,
        result.errors.join(', '),
      );
    }
  }
}
