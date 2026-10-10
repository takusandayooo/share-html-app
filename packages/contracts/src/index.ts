import { z } from "zod";
export const sharingSchema = z.object({
  audience: z.enum(["university", "selected", "public"]),
  recipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(50),
});
export const createShareSchema = z.object({
  audience: z.enum(["university", "selected", "public"]).default("university"),
  recipients: z
    .array(z.string().trim().toLowerCase().email().max(254))
    .max(50)
    .default([]),
  filename: z.string().min(1).max(200),
  content: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  expires_in_days: z.number().int().min(1).max(30).optional(),
  idempotency_key: z.string().uuid(),
});
export const updateExpirySchema = z.object({
  expires_at: z.iso.datetime({ offset: true }),
});
export const keyScopes = [
  "shares:read",
  "shares:write",
  "shares:delete",
] as const;
export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  expires_in_days: z.number().int().min(1).max(90).default(30),
  scopes: z
    .array(z.enum(keyScopes))
    .min(1)
    .default([...keyScopes]),
});
export type Share = {
  id: string;
  title: string;
  filename: string;
  kind: "html" | "markdown";
  size: number;
  created_at: string;
  expires_at: string;
  url: string;
  audience: "university" | "selected" | "public";
  recipients?: string[];
  is_owner?: boolean;
};
export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};
export type PublicConfig = {
  authConfigured: boolean;
  defaultExpiryDays: number;
  maxExpiryDays: number;
  minExpiryDays: number;
  maxFileBytes: number;
  maxBatchFiles: number;
  allowedEmailDomains: string[];
  mcpUrl: string;
};

export type ShareViews = {
  total_views: number;
  total_downloads: number;
  signed_in_viewers: number;
  items: Array<{
    id: string;
    name: string;
    email: string | null;
    anonymous: boolean;
    views: number;
    downloads: number;
    first_seen_at: string;
    last_seen_at: string;
  }>;
  next_offset: number | null;
};
