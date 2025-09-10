/**
 * @file OnEventUserDrop.ts
 * @description Listener for when guild members remove "interest" from Discord scheduled events.
 * There can be multiple listeners for one event, read class documentation for what this file does.
 */
import { Listener, container } from '@sapphire/framework';
import { Events, GuildScheduledEvent, User } from 'discord.js';
import type { GuildMember, Role } from "discord.js"
import { yellow, cyan } from 'colorette';
import { LovelaceLogger, createListenerLogger } from '../../lib/LovelaceLogger';

/**
 * Listener for when guild members remove "interest" from Discord scheduled events.
 * Performs cleanup tasks for the custom role scheduled event feature:
 * - Removing the member from the custom role assignment queue
 * - Removing the event specific role from the member 
 */
export class onEventUserDrop extends Listener {
  private logger: LovelaceLogger;
  /**
   * Creates a new GuildScheduledEventUserRemove listener
   * @param context - The loader context
   * @param options - The listener options
   */
  public constructor(
    context: Listener.LoaderContext,
    options: Listener.Options,
  ) {

    super(context, {
      ...options,
      name: "OnEventUserDrop",
      event: Events.GuildScheduledEventUserRemove,
    });
    this.logger = createListenerLogger(this.event, this.name)

  }

  /**
   * Handles a user leaving a scheduled event
   * Removes the event role from the user and cleans up pending custom role assignments
   * @param scheduledEvent - The scheduled event the user left
   * @param user - The user who left the event
   */
  public override async run(scheduledEvent: GuildScheduledEvent, user: User) {
    const { database, customRoleQueue } = container;
    if (!scheduledEvent.guild) {
      return this.logger.error(
        `Failed to find guild from scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        'Cannot proceed with removing event role from member.',
      );
    }

    if (!user) {
      return this.logger.error(
        `Failed to find user enrolling into scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
        'Cannot proceed with removing event role from member.',
      );
    }

    // Remove them from the custom role queue
    customRoleQueue.removeAssignment(scheduledEvent, user);

    const dbEvent = await database.findScheduledEvent(scheduledEvent.id);
    if (!dbEvent) {
      return this.logger.error(
        `Failed to find a database entry for ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}\]`,
      );
    }

    let role: Role;
    try {
      let response = await scheduledEvent.guild.roles.fetch(dbEvent.roleId);
      if (!response) {
        return this.logger.error(
          `Failed to find role associated with scheduled event ${yellow(scheduledEvent.name)}[${cyan(scheduledEvent.id)}].`,
          '\nCannot proceed with removing event role from member.',
        );
      }
      role = response
    } catch (error) {
      return this.logger.error(`Discord API failed to fetch a role with ID ${dbEvent.roleId}. Cannot proceed with removing event role from member.`, error)
    }

    let member: GuildMember;
    try {
      member = await scheduledEvent.guild.members.fetch(user.id);
      if (!member) {
        return this.logger.error(
          `Failed to find user ${yellow(user.username)}[${cyan(user.id)}] as a member in guild ${yellow(scheduledEvent.guild.name)}[${cyan(scheduledEvent.guild.id)}].`,
          'Cannot proceed with removing event role from member.',
        );
      }
    } catch (error) {
      return this.logger.error(`Discord API failed to fetch a member from user ${yellow(user.username)}[${cyan(user.id)}]. Cannot proceed with removing event role from member.`, error)
    }

    // Attempts to remove the role whether the member has it or not.
    // No need to check first if no error is thrown, that'd just be an additional call to Discord.
    try {
      await member.roles.remove(role);
      this.logger.info(
        `Removed role ${yellow(role.name)} from guild member ${yellow(member.displayName)}[${cyan(member.id)}]`,
      );
    } catch (error) {
      return this.logger.error(`Discord API failed to remove role ${yellow(role.name)} from member ${yellow(member.displayName)}[${cyan(member.id)}]. Cannot proceed with removing event role from member.`, error)
    }
  }
}
