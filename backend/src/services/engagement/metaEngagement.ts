// Graph API calls for Social Engagement: posts of a Facebook Page and of an Instagram
// professional account, their comments, reactions (Facebook) and public shares (Facebook), and
// replies to comments. Uses the connected account's Page token (see SocialService).
//
// What Meta gives (checked against the Graph API docs):
// - Facebook Page posts: comments with the person (id, name), reactions with the person and the
//   type, shares only when the sharing post is public and visible to the app.
// - Instagram: comments with the person (id, username); likes and shares as counts only.

export class EngagementApiError extends Error {
  constructor(
    message: string,
    /** false = trying again will not help (login expired, permission missing) */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface ApiPost {
  externalId: string;
  message: string | null;
  permalink: string | null;
  imageUrl: string | null;
  postedAt: Date;
  commentCount: number;
  reactionCount: number;
  shareCount: number | null;
}

export interface ApiPerson {
  externalId: string;
  name: string;
  username: string | null;
  profileUrl: string | null;
  pictureUrl: string | null;
}

export interface ApiComment {
  externalId: string;
  text: string;
  parentExternalId: string | null;
  permalink: string | null;
  occurredAt: Date;
  /** null when Meta does not say who wrote it (missing permission or a deleted profile) */
  from: ApiPerson | null;
}

export interface ApiReaction {
  type: string;
  person: ApiPerson;
}

export interface ApiShare {
  externalId: string;
  permalink: string | null;
  occurredAt: Date;
  text: string | null;
  person: ApiPerson;
}

const MAX_PAGES = 10;

type Paged<T> = { data: T[]; paging?: { next?: string; cursors?: { after?: string } }; summary?: { total_count?: number } };

export class MetaEngagementApi {
  constructor(
    private readonly graphVersion: () => string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async graph<T>(path: string, token: string, init: { method?: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.graphVersion()}/${path.replace(/^\//, "")}`);
    url.search = new URLSearchParams({ ...(init.query ?? {}), access_token: token }).toString();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers: init.body ? { "Content-Type": "application/json" } : { Accept: "application/json" },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new EngagementApiError("Could not reach Facebook", true);
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
    if (!res.ok || !data || data.error) {
      const e = data?.error;
      if (e?.code === 190) throw new EngagementApiError("The Facebook login for this account expired or was removed. Connect it again under Social Accounts.", false);
      const code = e?.code ?? 0;
      if (code === 10 || (code >= 200 && code < 300)) {
        throw new EngagementApiError(`Permission missing: ${e?.message ?? "connect the account again and allow all permissions"}`, false);
      }
      throw new EngagementApiError(`Facebook: ${e?.message ?? `HTTP ${res.status}`}`, res.status >= 500 || e?.code === 4 || e?.code === 17 || e?.code === 32 || e?.code === 613);
    }
    return data;
  }

  /** Follows "after" cursors (at most MAX_PAGES pages). */
  private async all<T>(path: string, token: string, query: Record<string, string>, maxPages = MAX_PAGES): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const page = await this.graph<Paged<T>>(path, token, { query: { ...query, ...(after ? { after } : {}) } });
      out.push(...page.data);
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return out;
  }

  // ---- Facebook Page ----

  async facebookPosts(pageId: string, token: string, limit: number): Promise<ApiPost[]> {
    type P = {
      id: string;
      message?: string;
      permalink_url?: string;
      full_picture?: string;
      created_time: string;
      shares?: { count?: number };
      comments?: { summary?: { total_count?: number } };
      reactions?: { summary?: { total_count?: number } };
    };
    const rows = await this.all<P>(
      `${pageId}/posts`,
      token,
      { fields: "id,message,permalink_url,full_picture,created_time,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)", limit: String(Math.min(limit, 100)) },
      Math.ceil(limit / 100),
    );
    return rows.slice(0, limit).map((p) => ({
      externalId: p.id,
      message: p.message ?? null,
      permalink: p.permalink_url ?? null,
      imageUrl: p.full_picture ?? null,
      postedAt: new Date(p.created_time),
      commentCount: p.comments?.summary?.total_count ?? 0,
      reactionCount: p.reactions?.summary?.total_count ?? 0,
      shareCount: p.shares?.count ?? 0,
    }));
  }

  /** Every comment and reply on a post (newest first), with who wrote it. */
  async facebookComments(postId: string, token: string): Promise<ApiComment[]> {
    type C = { id: string; message?: string; created_time: string; permalink_url?: string; parent?: { id: string }; from?: { id: string; name?: string; picture?: { data?: { url?: string } } } };
    const rows = await this.all<C>(`${postId}/comments`, token, {
      fields: "id,message,created_time,permalink_url,parent{id},from{id,name,picture}",
      filter: "stream",
      order: "reverse_chronological",
      limit: "100",
    });
    return rows.map((c) => ({
      externalId: c.id,
      text: c.message ?? "",
      parentExternalId: c.parent?.id ?? null,
      permalink: c.permalink_url ?? null,
      occurredAt: new Date(c.created_time),
      from: c.from ? { externalId: c.from.id, name: c.from.name || "Facebook user", username: null, profileUrl: null, pictureUrl: c.from.picture?.data?.url ?? null } : null,
    }));
  }

  /** Who reacted to a post and how. `complete` = every reaction was read (none left over). */
  async facebookReactions(postId: string, token: string): Promise<{ items: ApiReaction[]; complete: boolean }> {
    type R = { id: string; name?: string; type?: string; pic?: string };
    const rows: R[] = [];
    let after: string | undefined;
    let complete = false;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await this.graph<Paged<R>>(`${postId}/reactions`, token, { query: { fields: "id,name,type,pic", limit: "100", ...(after ? { after } : {}) } });
      rows.push(...page.data);
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!after) {
        complete = true;
        break;
      }
    }
    return {
      complete,
      items: rows.map((r) => ({ type: (r.type ?? "LIKE").toUpperCase(), person: { externalId: r.id, name: r.name || "Facebook user", username: null, profileUrl: null, pictureUrl: r.pic ?? null } })),
    };
  }

  /** Public shares of a post (Meta shows only shares that are public and visible to the app). */
  async facebookShares(postId: string, token: string): Promise<ApiShare[]> {
    type S = { id: string; created_time?: string; permalink_url?: string; message?: string; from?: { id: string; name?: string } };
    try {
      const rows = await this.all<S>(`${postId}/sharedposts`, token, { fields: "id,created_time,permalink_url,message,from{id,name}", limit: "100" }, 3);
      return rows
        .filter((s) => s.from?.id)
        .map((s) => ({
          externalId: s.id,
          permalink: s.permalink_url ?? null,
          occurredAt: s.created_time ? new Date(s.created_time) : new Date(),
          text: s.message ?? null,
          person: { externalId: s.from!.id, name: s.from!.name || "Facebook user", username: null, profileUrl: null, pictureUrl: null },
        }));
    } catch (err) {
      // Not available for every Page/app: shares are a bonus, never stop the rest.
      if (err instanceof EngagementApiError && !err.retryable) return [];
      throw err;
    }
  }

  async replyFacebook(commentId: string, token: string, text: string): Promise<string> {
    const r = await this.graph<{ id?: string }>(`${commentId}/comments`, token, { method: "POST", body: { message: text } });
    if (!r.id) throw new EngagementApiError("Facebook did not confirm the reply", true);
    return r.id;
  }

  /** Real-time updates for this Page (webhooks of the app's "feed" field). */
  async subscribePage(pageId: string, token: string): Promise<void> {
    await this.graph<{ success?: boolean }>(`${pageId}/subscribed_apps`, token, { method: "POST", query: { subscribed_fields: "feed" } });
  }

  // ---- Instagram ----

  async instagramPosts(igId: string, token: string, limit: number): Promise<ApiPost[]> {
    type M = { id: string; caption?: string; permalink?: string; media_url?: string; thumbnail_url?: string; media_type?: string; timestamp: string; like_count?: number; comments_count?: number };
    const rows = await this.all<M>(
      `${igId}/media`,
      token,
      { fields: "id,caption,permalink,media_url,thumbnail_url,media_type,timestamp,like_count,comments_count", limit: String(Math.min(limit, 50)) },
      Math.ceil(limit / 50),
    );
    return rows.slice(0, limit).map((m) => ({
      externalId: m.id,
      message: m.caption ?? null,
      permalink: m.permalink ?? null,
      imageUrl: (m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url) ?? m.thumbnail_url ?? null,
      postedAt: new Date(m.timestamp),
      commentCount: m.comments_count ?? 0,
      reactionCount: m.like_count ?? 0,
      shareCount: null,
    }));
  }

  /** Comments and their replies on an Instagram post, with who wrote them. */
  async instagramComments(mediaId: string, token: string): Promise<ApiComment[]> {
    type C = { id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username?: string } };
    type Top = C & { replies?: { data: C[] } };
    const rows = await this.all<Top>(`${mediaId}/comments`, token, {
      fields: "id,text,timestamp,username,from{id,username},replies{id,text,timestamp,username,from{id,username}}",
      limit: "50",
    });
    const person = (c: C): ApiPerson | null => {
      const username = c.from?.username ?? c.username;
      const id = c.from?.id ?? (username ? `@${username}` : null);
      if (!id) return null;
      return { externalId: id, name: username ?? "Instagram user", username: username ?? null, profileUrl: username ? `https://www.instagram.com/${username}/` : null, pictureUrl: null };
    };
    const out: ApiComment[] = [];
    for (const c of rows) {
      out.push({ externalId: c.id, text: c.text ?? "", parentExternalId: null, permalink: null, occurredAt: new Date(c.timestamp), from: person(c) });
      for (const r of c.replies?.data ?? []) {
        out.push({ externalId: r.id, text: r.text ?? "", parentExternalId: c.id, permalink: null, occurredAt: new Date(r.timestamp), from: person(r) });
      }
    }
    return out;
  }

  async replyInstagram(commentId: string, token: string, text: string): Promise<string> {
    const r = await this.graph<{ id?: string }>(`${commentId}/replies`, token, { method: "POST", body: { message: text } });
    if (!r.id) throw new EngagementApiError("Instagram did not confirm the reply", true);
    return r.id;
  }
}
