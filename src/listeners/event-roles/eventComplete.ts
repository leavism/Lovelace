/**
 * @file OnEventComplete.ts
 * @description Listener for handling Discord scheduled events when they complete.
 * Manages cleanup of related roles and database entries.
 */

import { Listener, container } from '@sapphire/framework';
import { Events, GuildScheduledEvent, } from 'discord.js';
import { yellow, cyan } from 'colorette';
import { LovelaceLogger, createListenerLogger } from '../../lib/LovelaceLogger';

/**
 * Listener that handles the completion of Discord scheduled events. Listens to the
 * GuildScheduledEventUpdate event and checks isCompleted().
 * Performs cleanup tasks including:
 * - Clearing the custom role assignment queue
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
    this.logger = createListenerLogger(this.event, this.name)
  }

  /**
   * Runs when a scheduled event gets updated.
   * 
   * Only triggers cleanup actions when an event transitions to completed status
   * @param _oldScheduleEvent - The previous state of the scheduled event
   * @param newScheduledEvent - The current state of the scheduled event
   */
  public override async run(
    _oldScheduleEvent: GuildScheduledEvent,
    newScheduledEvent: GuildScheduledEvent,
  ) {
    if (!newScheduledEvent.isCompleted()) return;

    const { database, customRoleQueue } = container;

    if (!newScheduledEvent.guild) {
      return this.logger.error(
        `Failed to find guild from scheduled event ${yellow(newScheduledEvent.name)}[${cyan(newScheduledEvent.id)}].`,
        'Cannot proceed with deleting event role nor database entry.',
      );
    }

    customRoleQueue.clearEventQueue(newScheduledEvent);
    let dbEntry;

    try {
      dbEntry = await database.findScheduledEvent(newScheduledEvent.id);
      if (!dbEntry) {
        return this.logger.error(
          `Failed to find a database entry for ${yellow(newScheduledEvent.name)}[${cyan(newScheduledEvent.id)}\]`,
          'Cannot proceed with deleting event role nor database entry',
        );
      }
    } catch (error) {
      return this.logger.error(
        `Failed to communicate with the database for ${yellow(newScheduledEvent.name)}[${cyan(newScheduledEvent.id)}\]`,
        'Cannot proceed with deleting event role nor database entry',
        error
      );
    }

    let role;
    try {
      role = await newScheduledEvent.guild.roles.fetch(dbEntry.roleId);

      if (!role) {
        this.logger.error(
          `Failed to find role with ID ${dbEntry.roleId} for scheduled event ${yellow(newScheduledEvent.name)}[${cyan(newScheduledEvent.id)}]. Role may have been manually deleted.`
        );
        //TODO: Handle error at the database interface level
        const deleteResult = await database.deleteScheduledEvent(
          newScheduledEvent.id,
        );
        // Schema eventId row contains unique values only, so deleting should affect
        // only 1 or 0 rows
        if (deleteResult.affectedRows > 0) {
          this.logger.info(
            `Deleted database entry for ${yellow(newScheduledEvent.name)}`,
          );
        } else {
          this.logger.warn(
            `Failed to delete database entry for ${yellow(newScheduledEvent.name)}[${cyan(newScheduledEvent.id)}\]`,
          );
        }

        return; // Exit early since there's no role to delete
      }

      // Role exists, proceed with deletion
      await role.delete(`Deleted role associated with scheduled event ${newScheduledEvent.name} that has ended.`);

      this.logger.info(
        `Successfully deleted role ${yellow(role.name)} associated with ${yellow(newScheduledEvent.name)}`
      );

    } catch (error) {
      // Handle both fetch and delete errors
      if (role) {
        this.logger.error(
          `Discord API failed to delete role ${yellow(role.name)} (ID: ${role.id}) for event ${yellow(newScheduledEvent.name)}.`,
          error
        );
      } else {
        this.logger.error(
          `Disdord API failed to fetch role with ID ${dbEntry.roleId} for event ${yellow(newScheduledEvent.name)}.`,
          error
        );
      }
    }
  }
}
