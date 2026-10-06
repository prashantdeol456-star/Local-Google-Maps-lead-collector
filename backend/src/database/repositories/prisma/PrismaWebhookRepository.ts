import type { DbClient } from "../../client.js";
import { isUniqueViolation } from "../../client.js";
import type { WebhookDeliveryRecord, WebhookDeliveryStatus, WebhookEndpointRecord, WebhookRepository } from "../types.js";

type EndpointData = Pick<WebhookEndpointRecord, "name" | "url" | "secretEnc" | "secretHint" | "events" | "enabled">;

const asDelivery = (d: Omit<WebhookDeliveryRecord, "status"> & { status: string }) => d as WebhookDeliveryRecord;

export class PrismaWebhookRepository implements WebhookRepository {
  constructor(private readonly db: DbClient) {}

  listEndpoints() {
    return this.db.webhookEndpoint.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }
  findEndpoint(id: string) {
    return this.db.webhookEndpoint.findUnique({ where: { id } });
  }
  createEndpoint(data: EndpointData) {
    return this.db.webhookEndpoint.create({ data });
  }
  async updateEndpoint(id: string, data: Partial<EndpointData>) {
    const { count } = await this.db.webhookEndpoint.updateMany({ where: { id }, data });
    return count ? this.findEndpoint(id) : null;
  }
  async deleteEndpoint(id: string) {
    const { count } = await this.db.webhookEndpoint.deleteMany({ where: { id } });
    return count > 0;
  }

  async enqueue(data: { endpointId: string; eventId: string; event: string; payload: string; nextAttemptAt?: Date }) {
    try {
      return asDelivery(await this.db.webhookDelivery.create({ data }));
    } catch (err) {
      if (isUniqueViolation(err)) return null; // already queued for this endpoint
      throw err;
    }
  }
  async due(now: Date, take: number) {
    const rows = await this.db.webhookDelivery.findMany({
      where: { status: "pending", nextAttemptAt: { lte: now }, endpoint: { enabled: true } },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take,
    });
    return rows.map(asDelivery);
  }
  async findDelivery(id: string) {
    const row = await this.db.webhookDelivery.findUnique({ where: { id } });
    return row ? asDelivery(row) : null;
  }
  async updateDelivery(id: string, data: Partial<Omit<WebhookDeliveryRecord, "id" | "endpointId" | "eventId" | "event" | "payload" | "createdAt">>) {
    await this.db.webhookDelivery.update({ where: { id }, data });
  }
  async listDeliveries(query: { endpointId: string; status?: WebhookDeliveryStatus; skip: number; take: number }) {
    const where = { endpointId: query.endpointId, ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await Promise.all([
      this.db.webhookDelivery.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: query.skip, take: query.take }),
      this.db.webhookDelivery.count({ where }),
    ]);
    return { items: items.map(asDelivery), total };
  }
  async deleteOld(status: "delivered" | "failed", before: Date) {
    const { count } = await this.db.webhookDelivery.deleteMany({ where: { status, createdAt: { lt: before } } });
    return count;
  }
  async countDeliveries(endpointId: string) {
    const rows = await this.db.webhookDelivery.groupBy({ by: ["status"], where: { endpointId }, _count: { _all: true } });
    const counts: Record<WebhookDeliveryStatus, number> = { pending: 0, delivered: 0, failed: 0 };
    for (const r of rows) counts[r.status as WebhookDeliveryStatus] = r._count._all;
    return counts;
  }
}
