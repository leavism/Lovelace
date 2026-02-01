import { mysqlTable, int, varchar, text, timestamp } from 'drizzle-orm/mysql-core';
import { InferSelectModel } from 'drizzle-orm';

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  // varchar(32) is future proof enough for discord snowflakes
  discordId: varchar('discord_id', { length: 32 }).notNull().unique(),
});

export const scheduledEvents = mysqlTable('scheduled_events', {
  id: int('id').autoincrement().primaryKey(),
  eventId: varchar('event_id', { length: 32 }).notNull().unique(),
  roleId: varchar('role_id', { length: 32 }).notNull().unique(),
});

export type ScheduledEventDBEntry = InferSelectModel<typeof scheduledEvents>;

/**
 * Dead letter queue for role assignments that failed after max retry attempts.
 * Stores failures for manual recovery or retry via admin commands.
 */
export const failedAssignments = mysqlTable('failed_assignments', {
  id: int('id').autoincrement().primaryKey(),
  eventId: varchar('event_id', { length: 32 }).notNull(),
  userId: varchar('user_id', { length: 32 }).notNull(),
  eventName: varchar('event_name', { length: 100 }).notNull(),
  userName: varchar('user_name', { length: 100 }).notNull(),
  failureReason: text('failure_reason').notNull(),
  attemptCount: int('attempt_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastAttemptAt: timestamp('last_attempt_at').notNull().defaultNow(),
});

export type FailedAssignmentDBEntry = InferSelectModel<typeof failedAssignments>;
