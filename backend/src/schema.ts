import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

// Instance settings edited in the app (title, logo, theme...), one row per key.
export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("user"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  /** OIDC accounts: role set in YASAD over the provider's, or null to follow the provider. */
  roleOverride: text("role_override", { enum: ["admin", "user"] }),
  lastSignInAt: integer("last_sign_in_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Failed attempts per key (e.g. `setup:<ip>`) in a fixed time window. */
export const rateLimit = sqliteTable("rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: integer("window_start").notNull(),
});

/** Groups by origin: `oidc` (from the identity provider), `local` (managed in YASAD) or `system`. */
export const group = sqliteTable(
  "group",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    source: text("source", { enum: ["oidc", "local", "system"] }).notNull(),
    createdAt: createdAt(),
    /** Last sign-in whose token named this `oidc` group; null for a group the provider never sent, and for other sources. */
    seenAt: integer("seen_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("group_source_name_idx").on(t.source, t.name)],
);

/** Group members; memberships of `oidc` groups are rewritten from the ID token at each OIDC sign-in. */
export const userGroup = sqliteTable(
  "user_group",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] }), index("user_group_group_id_idx").on(t.groupId)],
);

/** Link categories; `id` is the stable identifier written in the catalog file. */
export const category = sqliteTable("category", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  position: integer("position").notNull(),
  /**
   * Increased by every write to the category in the app, its groups included, but not by a move in the app;
   * an import increases it whenever the category's content or rank changes. A stale edit is refused.
   */
  revision: integer("revision").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const link = sqliteTable(
  "link",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    url: text("url").notNull(),
    icon: text("icon"),
    /** JSON array of strings. */
    keywords: text("keywords").notNull().default("[]"),
    position: integer("position").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /**
     * Increased by every write to the link in the app, its groups and category included, but not by a move in
     * the app; an import increases it whenever the link's content or rank changes. A stale edit is refused.
     */
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("link_category_id_idx").on(t.categoryId)],
);

export const categoryGroup = sqliteTable(
  "category_group",
  {
    categoryId: text("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.groupId] })],
);

export const linkGroup = sqliteTable(
  "link_group",
  {
    linkId: text("link_id")
      .notNull()
      .references(() => link.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.linkId, t.groupId] })],
);

/**
 * A person's favourite links. Positions are unique per person but not dense: every write keeps them
 * unique (an insert takes max + 1, a move swaps two values), and a hidden pin keeps its row and position.
 */
export const userLinkPin = sqliteTable(
  "user_link_pin",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    linkId: text("link_id")
      .notNull()
      .references(() => link.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.linkId] }), index("user_link_pin_link_id_idx").on(t.linkId)],
);

/**
 * Admin actions, one row per gesture, append-only: triggers refuse any update, and any delete of a row
 * younger than 30 days. `actor_id` has no foreign key, so deleting a person leaves their entries intact.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at").notNull().default(sql`(unixepoch() * 1000)`),
    /** Null for what YASAD does by itself: the setup and the CATALOG_FILE import at startup. */
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id"),
    objectLabel: text("object_label"),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    relatedLabel: text("related_label"),
    /** JSON snapshots of the object, limited to the fields listed in audit.ts. */
    before: text("before"),
    after: text("after"),
    details: text("details"),
  },
  (t) => [
    index("audit_log_actor_idx").on(t.actorId, t.id),
    index("audit_log_object_type_idx").on(t.objectType, t.id),
    index("audit_log_object_id_idx").on(t.objectId, t.id),
    index("audit_log_related_id_idx").on(t.relatedId, t.id),
    index("audit_log_at_idx").on(t.at),
  ],
);
