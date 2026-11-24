import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** No customer/sample data belongs in migrations. Initial records are empty. */
export const sparelinkRecords = sqliteTable("sparelink_records", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["request", "listing"] }).notNull(),
  ownerId: text("owner_id").notNull(),
  manufacturer: text("manufacturer").notNull(),
  manufacturerKey: text("manufacturer_key").notNull(),
  partNumber: text("part_number").notNull(),
  partKey: text("part_key").notNull(),
  category: text("category").notNull(),
  quantity: integer("quantity").notNull(),
  condition: text("condition").notNull(),
  region: text("region").notNull(),
  deadline: text("deadline"),
  leadTimeDays: integer("lead_time_days"),
  description: text("description").notNull().default(""),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  status: text("status", { enum: ["open", "closed", "archived"] }).notNull().default("open"),
  reviewStatus: text("review_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
  consentVersion: text("consent_version").notNull(),
  submissionKey: text("submission_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("sparelink_records_owner_idx").on(table.ownerId, table.kind),
  index("sparelink_records_match_idx").on(table.manufacturerKey, table.partKey, table.status),
  index("sparelink_records_catalog_idx").on(table.kind, table.reviewStatus, table.isTest, table.status),
  uniqueIndex("sparelink_records_submission_idx").on(table.ownerId, table.kind, table.submissionKey),
]);

export const sparelinkRateLimits = sqliteTable("sparelink_rate_limits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const sparelinkAudit = sqliteTable("sparelink_audit", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  recordId: text("record_id").notNull(),
  action: text("action").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("sparelink_audit_record_idx").on(table.recordId)]);
