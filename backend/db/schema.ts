import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
export const vault = sqliteTable('vault', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
  envelope: text('envelope').notNull(),
});
export const sessions = sqliteTable('admin_sessions', {
  digest: text('digest').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('sessions_expiry_idx').on(t.expiresAt)]);
export const attempts = sqliteTable('login_attempts', {
  ipHash: text('ip_hash').primaryKey(),
  count: integer('count').notNull(),
  resetAt: integer('reset_at').notNull(),
}, t => [index('attempts_reset_idx').on(t.resetAt)]);
