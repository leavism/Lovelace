/**
 * @file eventInit.ts
 * @description Listener for processing scheduled events are not already in the database.
 * This is mostly scheduled events made while the bot was offline.
 * Initializes scheduled events processing on bot startup.
 */

import { Listener, container } from '@sapphire/framework';
import { Events, Guild } from 'discord.js';
import { yellow, cyan } from 'colorette';
import { createListenerLogger, type LovelaceLogger } from '../../lib/LovelaceLogger';
import { ProcessEventResult } from '../../lib/ScheduledEventService';

/**
 * The logic to reconcile scheduled events and their custom roles.
 * When the bot starts up, this fetches all scheduled events for the configured guild
 * and processes them through the scheduledEventsService.
 */
export class EventInit extends Listener {
  private logger: LovelaceLogger;
  /**
   * Creates a new OnClientReady listener
   * @param context - The loader context
   * @param options - The listener options
   */
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {
    super(context, {
      ...options,
      name: "EventInit",
      event: Events.ClientReady,
    });
    this.logger = createListenerLogger(this.event, this.name)
  }

  public override async run() {
    const { client, scheduledEventsService, customRoleQueue } = container;
    // TODO: Only works for the ACM blue Discord server. Make it work for
    // multiple servers?

    // EventInit runs on bot startup, nothing is cached so we need to
    // fetch server, events, and members
    let acmguild: Guild;
    try {
      acmguild = await client.guilds.fetch(`${process.env.GUILD}`)
      if (!acmguild) {
        return this.logger.error(`Failed to find a guild with ID ${process.env.GUILD}`)
      }
    } catch (error) {
      return this.logger.error(`Discord API failed to fetch guild with ID ${process.env.GUILD}.`, error)
    }

    let eventsCollection;
    try {
      eventsCollection = await acmguild.scheduledEvents.fetch({ cache: true })
      if (!eventsCollection) {
        return this.logger.error(`Failed to find a collection of scheduled events.`)
      }
    } catch (error) {
      return this.logger.error(`Discord API failed to fetch the scheduled events of guild ${acmguild.name}`, error)
    }

    // Push all events through the scheduled events service to check for a database entry and custom role
    const processedEvents: ProcessEventResult[] = await scheduledEventsService.batchProcessEvents(eventsCollection);

    // Reconcile any changes from the last time the bot was online
    for (const { event, error } of processedEvents) {
      if (!event) {
        this.logger.error(
          'Failed to process scheduled event during initialization. Skipping this event for event initialization.', error
        );
        continue;
      }

      // Get the role ID from the database
      let roleId;
      try {
        roleId = await scheduledEventsService.getEventRoleId(event.id);
        if (!roleId) {
          this.logger.error(
            `Failed to find role ID for scheduled event ${yellow(event.name)}[${cyan(event.id)}].`,
            'Skipping this event for event initialization.',
          );
          continue;
        }
      } catch (error) {
        this.logger.error(`The database could not find a role ID for the scheduled event ${yellow(event.name)}[${cyan(event.id)}]. Skipping this event.`, error)
        continue;
      }

      let subscribers;
      try {
        subscribers = await event.fetchSubscribers({ withMember: true })
        if (!subscribers) {
          this.logger.error(`Failed to get a list of subscribers for scheduled event ${yellow(event.name)}[${cyan(event.id)}]. Skipping this event.`)
          continue;
        }
        if (subscribers.size === 0) {
          this.logger.info(`The scheduled event ${yellow(event.name)}[${cyan(event.id)}] has no subscribers. Skipping this event.`,
          )
          continue;
        }
      } catch (error) {
        this.logger.error(`Discord API failed to fetch the subscribers for the event scheduled event ${yellow(event.name)}[${cyan(event.id)}]. Skipping this event.`, error)
        continue;
      }
      for (const [_userID, subscriber] of subscribers) {
        let { member } = subscriber;
        if (!member) {
          this.logger.warn(
            `Failed to find member in guild ${acmguild.name}.`,
            '\nSkipping this member for event initialization.',
          );
          continue;
        }

        member = await member.fetch();
        const hasRole = member.roles.cache.find((role) => role.id === roleId);
        if (!hasRole) {
          customRoleQueue.queueAssignment(event, member.user);
        }
      }
    }
  }
}
