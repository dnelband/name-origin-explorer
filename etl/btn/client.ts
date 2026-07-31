import { sleep } from "../wikidata/fetch";

const BTN_BASE = "https://www.behindthename.com/api";
const REQUEST_INTERVAL_MS = 550; // ~2 req/s max

export type BtnLookupResult = {
  name: string;
  gender: string | null;
  usages: string[];
  sourceUrl: string;
};

export type BtnRelatedResult = {
  name: string;
  related: string[];
  sourceUrl: string;
};

export class BtnClient {
  private lastRequestAt = 0;

  constructor(private readonly apiKey: string) {}

  private async throttle() {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    await this.throttle();
    const url = new URL(`${BTN_BASE}/${path}`);
    url.searchParams.set("key", this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "NameOrigins/1.0" },
    });

    if (res.status === 429) {
      await sleep(60_000);
      return this.get(path, params);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`BTN ${path} failed (${res.status}): ${body.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  }

  async lookup(name: string): Promise<BtnLookupResult | null> {
    type Response = {
      names?: Array<{
        name: string;
        gender?: string;
        usages?: Array<{ usage_full?: string; usage_gender?: string }>;
      }>;
    };

    const data = await this.get<Response & { error?: string; error_code?: number }>(
      "lookup.json",
      {
        name: name.toLowerCase(),
      },
    );

    if (data.error || data.error_code) {
      throw new Error(
        `BTN lookup error ${data.error_code ?? "?"}: ${data.error ?? "unknown"}`,
      );
    }

    const match = data.names?.[0];
    if (!match) return null;

    return {
      name: match.name,
      gender: match.gender ?? null,
      usages: (match.usages ?? [])
        .map((u) => u.usage_full)
        .filter((u): u is string => Boolean(u)),
      sourceUrl: `https://www.behindthename.com/name/${encodeURIComponent(match.name.toLowerCase())}`,
    };
  }

  async related(name: string): Promise<BtnRelatedResult | null> {
    type Response = {
      names?: Array<{ related_names?: Array<{ name: string }> }>;
    };

    const data = await this.get<Response & { error?: string; error_code?: number }>(
      "related.json",
      {
        name: name.toLowerCase(),
      },
    );

    if (data.error || data.error_code) {
      throw new Error(
        `BTN related error ${data.error_code ?? "?"}: ${data.error ?? "unknown"}`,
      );
    }

    const block = data.names?.[0];
    if (!block) return null;

    const related = (block.related_names ?? []).map((r) => r.name).filter(Boolean);
    return {
      name,
      related,
      sourceUrl: `https://www.behindthename.com/name/${encodeURIComponent(name.toLowerCase())}`,
    };
  }
}
