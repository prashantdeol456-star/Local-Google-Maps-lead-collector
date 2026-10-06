import { z } from "zod";
import { Errors } from "../utils/errors.js";

/** Parses input with a zod schema; on failure throws a 400 naming the first bad field. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.join(".");
  throw Errors.badRequest(field ? `${field}: ${issue!.message}` : (issue?.message ?? "Invalid request"));
}

export const MAX_PAGE_SIZE = 100;

export const Pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export function toSkipTake({ page, pageSize }: { page: number; pageSize: number }) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export const IdParams = z.object({ id: z.string().min(1).max(64) });

/** Optional query-string text: trimmed, empty → undefined. */
export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
