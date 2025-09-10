/**
 * @file OnEventCreate.ts
 * @description Listener for handling Discord scheduled event creation.
 * Adds scheduled event into the scheduled events service. 
 */

import { Listener, container } from '@sapphire/framework';
import { Events, GuildScheduledEvent } from 'discord.js';
import { cyan, yellow } from 'colorette';
import { LovelaceLogger, createListenerLogger } from '../../lib/LovelaceLogger';

/**
 * Listener that handles the creation of Discord scheduled events.
 * Adds the scheduled event into the scheduled event service, which creates the associated role
 * and adds it into the database.
 */
export class OnEventCreate extends Listener {
  private logger: LovelaceLogger;
  /**
   * Creates a new OnEventCreate listener
   * @param context - The loader context
   * @param options - The listener options
   */
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      name: "OnEventCreate",
      event: Events.GuildScheduledEventCreate,
    });
    this.logger = createListenerLogger(this.event, this.name)
  }

  /**
   * Handles the scheduled event creation
   * Creates a role for the event, records it in the database, and queues the event creator for enrollment
   * @param scheduledEvent - The newly created scheduled event
   */
  public override async run(scheduledEvent: GuildScheduledEvent) {
    const { scheduledEventsService } = container;

    this.logger.info(
      `New scheduled event created ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
    );
    return await scheduledEventsService.processEvent(scheduledEvent);
  }
}
