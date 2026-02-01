/**
 * @file OnEventComplete.ts
 * @description Listener for handling Discord scheduled events when they complete.
 * Delegates cleanup to ScheduledEventsService.cleanupEvent().
 */

import { Listener, container } from '@sapphire/framework';
import { Events, GuildScheduledEvent } from 'discord.js';
import { yellow, cyan } from 'colorette';
import { LovelaceLogger, createListenerLogger } from '../../lib/LovelaceLogger';

/**
 * Listener that handles the completion of Discord scheduled events. Listens to the
 * GuildScheduledEventUpdate event and checks isCompleted().
 * Delegates cleanup to ScheduledEventsService.cleanupEvent() which handles:
 * - Clearing the custom role assignment queue
 * - Clearing any failed assignments from the dead letter queue
 * - Deleting the associated role
 * - Removing the database entry
 */
export class OnEventComplete extends Listener {
  private logger: LovelaceLogger;

  /**
   * Creates a new OnEventComplete listener
   * @param context - The loader context
   * @param options - The listener options
   */
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      name: "OnEventComplete",
      event: Events.GuildScheduledEventUpdate,
    });
    this.logger = createListenerLogger(this.event, this.name);
  }

  /**
   * Runs when a scheduled event gets updated.
   * Only triggers cleanup actions when an event transitions to completed status.
   * @param _oldScheduleEvent - The previous state of the scheduled event
   * @param newScheduledEvent - The current state of the scheduled event
   */
  public override async run(
    _oldScheduleEvent: GuildScheduledEvent,
    newScheduledEvent: GuildScheduledEvent,
  ) {
    if (!newScheduledEvent.isCompleted()) return;

    const { scheduledEventsService } = container;

    this.logger.info(
      `Scheduled event ${yellow(newScheduledEvent.name)}[${cyan(newScheduledEvent.id)}] has completed. Starting cleanup...`,
    );

    const result = await scheduledEventsService.cleanupEvent(
      newScheduledEvent,
      `Deleted role associated with scheduled event ${newScheduledEvent.name} that has ended.`,
    );

    if (result.errors.length > 0) {
      this.logger.warn(
        `Cleanup completed with ${result.errors.length} error(s) for event ${yellow(newScheduledEvent.name)}[${cyan(newScheduledEvent.id)}]:`,
        result.errors.join(', '),
      );
    }
  }
}
