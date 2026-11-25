// YouTube Data API v3 for Social Engagement: the channel's videos (with like and comment
// counts), every comment and reply on them with who wrote it (channel name and id), the newest
// subscribers whose subscriptions are public, and replying to a comment.
//
// Quota (10,000 units a day per Google project): list calls cost 1 unit, a reply 50. A sync of
// one channel costs about 4–6 units. YouTube has no webhooks for comments: it is read every few
// minutes. Who liked a video is not available (counts only).

import type { ApiComment, ApiPerson, ApiPost } from "./metaEngagement.js";
import { EngagementApiError } from "./metaEngagement.js";

const BASE = "https://www.googleapis.com/youtube/v3";

export interface YouTubeComment extends ApiComment {
  /** The video it is on */
  videoId: string | null;
}

export interface YouTubeSubscriber {
  person: ApiPerson;
  subscribedAt: Date;
}

type Snippet = {
  authorDisplayName?: string;
  authorProfileImageUrl?: string;
  authorChannelUrl?: string;
  authorChannelId?: { value?: string };
  textOriginal?: string;
  textDisplay?: string;
  publishedAt?: string;
  videoId?: string;
  parentId?: string;
};

function person(s: Snippet): ApiPerson | null {
  const id = s.authorChannelId?.value;
  if (!id) return null;
  return {
    externalId: id,
    name: s.authorDisplayName?.replace(/^@/, "") || "YouTube user",
    username: s.authorDisplayName?.startsWith("@") ? s.authorDisplayName.slice(1) : null,
    profileUrl: s.authorChannelUrl ?? `https://www.youtube.com/channel/${id}`,
    pictureUrl: s.authorProfileImageUrl ?? null,
  };
}

export class YouTubeApi {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async call<T>(path: string, token: string, init: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${BASE}/${path}`);
    url.search = new URLSearchParams(init.query ?? {}).toString();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new EngagementApiError("Could not reach YouTube", true);
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string; errors?: { reason?: string }[] } }) | null;
    if (!res.ok || !data || data.error) {
      const reason = data?.error?.errors?.[0]?.reason ?? "";
      if (res.status === 401) throw new EngagementApiError("The YouTube login expired. Connect the channel again under Social Accounts.", false);
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") throw new EngagementApiError("YouTube's daily quota for this app is used up; it renews at midnight Pacific time", true);
      if (reason === "commentsDisabled") return { items: [] } as unknown as T;
      if (res.status === 403) throw new EngagementApiError(`YouTube refused: ${data?.error?.message ?? reason}`, false);
      throw new EngagementApiError(`YouTube: ${data?.error?.message ?? `HTTP ${res.status}`}`, res.status >= 500);
    }
    return data;
  }

  /** The channel's newest uploads with their counts. */
  async videos(channelId: string, token: string, limit: number): Promise<ApiPost[]> {
    const ch = await this.call<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>("channels", token, { query: { part: "contentDetails", id: channelId } });
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < limit) {
      const page = await this.call<{ items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }>("playlistItems", token, {
        query: { part: "contentDetails", playlistId: uploads, maxResults: String(Math.min(50, limit - ids.length)), ...(pageToken ? { pageToken } : {}) },
      });
      for (const i of page.items ?? []) if (i.contentDetails?.videoId) ids.push(i.contentDetails.videoId);
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    if (!ids.length) return [];
    const out: ApiPost[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const v = await this.call<{ items?: { id: string; snippet?: { title?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } }; statistics?: { likeCount?: string; commentCount?: string } }[] }>("videos", token, {
        query: { part: "snippet,statistics", id: ids.slice(i, i + 50).join(",") },
      });
      for (const item of v.items ?? []) {
        out.push({
          externalId: item.id,
          message: item.snippet?.title ?? null,
          permalink: `https://www.youtube.com/watch?v=${item.id}`,
          imageUrl: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
          postedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : new Date(),
          commentCount: Number(item.statistics?.commentCount ?? 0),
          reactionCount: Number(item.statistics?.likeCount ?? 0),
          shareCount: null,
        });
      }
    }
    return out;
  }

  /** The newest comments and replies on all of the channel's videos (at most `maxThreads` threads). */
  async comments(channelId: string, token: string, maxThreads: number): Promise<YouTubeComment[]> {
    type Thread = { id: string; snippet?: { videoId?: string; topLevelComment?: { id: string; snippet?: Snippet } }; replies?: { comments?: { id: string; snippet?: Snippet }[] } };
    const out: YouTubeComment[] = [];
    let pageToken: string | undefined;
    let threads = 0;
    while (threads < maxThreads) {
      const page = await this.call<{ items?: Thread[]; nextPageToken?: string }>("commentThreads", token, {
        query: { part: "snippet,replies", allThreadsRelatedToChannelId: channelId, order: "time", textFormat: "plainText", maxResults: String(Math.min(100, maxThreads - threads)), ...(pageToken ? { pageToken } : {}) },
      });
      for (const t of page.items ?? []) {
        threads++;
        const top = t.snippet?.topLevelComment;
        if (!top) continue;
        const videoId = t.snippet?.videoId ?? top.snippet?.videoId ?? null;
        const s = top.snippet ?? {};
        out.push({
          externalId: top.id,
          text: s.textOriginal ?? s.textDisplay ?? "",
          parentExternalId: null,
          permalink: videoId ? `https://www.youtube.com/watch?v=${videoId}&lc=${top.id}` : null,
          occurredAt: s.publishedAt ? new Date(s.publishedAt) : new Date(),
          from: person(s),
          videoId,
        });
        for (const r of t.replies?.comments ?? []) {
          const rs = r.snippet ?? {};
          out.push({
            externalId: r.id,
            text: rs.textOriginal ?? rs.textDisplay ?? "",
            parentExternalId: top.id,
            permalink: videoId ? `https://www.youtube.com/watch?v=${videoId}&lc=${r.id}` : null,
            occurredAt: rs.publishedAt ? new Date(rs.publishedAt) : new Date(),
            from: person(rs),
            videoId,
          });
        }
      }
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  /** Newest subscribers (only people who keep their subscriptions public are listed by YouTube). */
  async subscribers(token: string, max: number): Promise<YouTubeSubscriber[]> {
    type Sub = { snippet?: { publishedAt?: string }; subscriberSnippet?: { channelId?: string; title?: string; thumbnails?: { default?: { url?: string } } } };
    const page = await this.call<{ items?: Sub[] }>("subscriptions", token, { query: { part: "snippet,subscriberSnippet", myRecentSubscribers: "true", maxResults: String(Math.min(50, max)) } });
    return (page.items ?? [])
      .filter((s) => s.subscriberSnippet?.channelId)
      .map((s) => ({
        subscribedAt: s.snippet?.publishedAt ? new Date(s.snippet.publishedAt) : new Date(),
        person: {
          externalId: s.subscriberSnippet!.channelId!,
          name: s.subscriberSnippet!.title || "YouTube user",
          username: null,
          profileUrl: `https://www.youtube.com/channel/${s.subscriberSnippet!.channelId}`,
          pictureUrl: s.subscriberSnippet!.thumbnails?.default?.url ?? null,
        },
      }));
  }

  /** Replies to a comment as the channel (50 quota units). `parentId` is the top-level comment. */
  async reply(parentId: string, token: string, text: string): Promise<string> {
    const r = await this.call<{ id?: string }>("comments", token, { method: "POST", query: { part: "snippet" }, body: { snippet: { parentId, textOriginal: text } } });
    if (!r.id) throw new EngagementApiError("YouTube did not confirm the reply", true);
    return r.id;
  }
}
