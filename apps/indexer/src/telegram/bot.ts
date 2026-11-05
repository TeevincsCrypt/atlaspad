import type postgres from "postgres";
import { flywheelStats, nationSummaries } from "@atlaspad/db/queries";
import { log } from "../log";
import { ANNOUNCE_TYPES, burnedText, cardUrl, esc, eventPost, findNation, helpText, listText, nationStats, nationUrl, parseCommand, stagePost, type Post } from "./format";

export interface TelegramConfig {
  token: string;
  /** Channel or group to announce in, e.g. "@atlaspad" or "-1001234567890". */
  chatId: string;
  siteUrl: string;
  apiBase: string;
  commands: boolean;
  intervalMs: number;
}

type Sql = postgres.Sql;

/** Shown on the indexer's /health page so a misconfigured bot is easy to spot. Never contains the token. */
export const telegramStatus: {
  enabled: boolean;
  bot: string | null;
  chat: string | null;
  canPost: boolean | null;
  lastPostAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
} = { enabled: false, bot: null, chat: null, canPost: null, lastPostAt: null, lastError: null, lastErrorAt: null };

function noteError(where: string, err: unknown) {
  telegramStatus.lastError = `${where}: ${String((err as Error)?.message ?? err)}`.slice(0, 300);
  telegramStatus.lastErrorAt = Math.floor(Date.now() / 1000);
}

/**
 * AtlasPad's Telegram bot, running inside the indexer:
 *  - announces launches, graduations, stage-ups, wars and other big moments in TELEGRAM_CHAT_ID;
 *  - answers /top, /new, /nation and /burned anywhere it is added.
 * It only reads the database. What it already announced is remembered in `bot_state`, so restarts never repost.
 */
export class TelegramBot {
  private stopped = false;
  private offset = 0;
  constructor(
    private readonly sql: Sql,
    private readonly cfg: TelegramConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  start() {
    log.info("Telegram bot enabled", { chat: this.cfg.chatId, commands: this.cfg.commands });
    telegramStatus.enabled = true;
    telegramStatus.chat = this.cfg.chatId;
    void this.selfCheck().finally(() => {
      void this.announceLoop();
      if (this.cfg.commands) void this.commandLoop();
    });
  }

  /**
   * Checks the token and that the bot can post in the chat, and says hello there once (ever), so the owner sees at a
   * glance that it works. Problems are logged and shown on /health.
   */
  async selfCheck() {
    try {
      const me = await this.api<{ username: string }>("getMe", {});
      telegramStatus.bot = `@${me.username}`;
    } catch (err) {
      noteError("token check (getMe)", err);
      log.error("Telegram: the bot token was rejected. Check TELEGRAM_BOT_TOKEN.", { err: String(err) });
      return;
    }
    try {
      await this.api("getChat", { chat_id: this.cfg.chatId });
    } catch (err) {
      telegramStatus.canPost = false;
      noteError(`chat check (getChat ${this.cfg.chatId})`, err);
      log.error("Telegram: cannot reach TELEGRAM_CHAT_ID. Use the channel's @username (public) or numeric id, and add the bot as an admin.", { err: String(err) });
      return;
    }
    try {
      const helloKey = `telegram:hello:${this.cfg.chatId}`;
      if ((await this.getState(helloKey)) === null) {
        await this.send(this.cfg.chatId, {
          text: "🧭 <b>AtlasPad alerts are live.</b>\n\nNew nations, graduations, stage-ups, wars and whales will be posted here as they happen.\n\nTry /top, /new or /nation $TICKER.",
          buttons: [{ text: "Open AtlasPad", url: this.cfg.siteUrl }],
        });
        await this.setState(helloKey, String(Math.floor(Date.now() / 1000)));
      }
      telegramStatus.canPost = true;
    } catch (err) {
      telegramStatus.canPost = false;
      noteError("first post", err);
      log.error("Telegram: could not post in TELEGRAM_CHAT_ID. Make the bot an admin of the channel with permission to post.", { err: String(err) });
    }
  }

  stop() {
    this.stopped = true;
  }

  // --------------------------------------------------------------------------------------------- Telegram API
  private async api<T = unknown>(method: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    const res = await this.fetchImpl(`${this.cfg.apiBase}/bot${this.cfg.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
    return data.result as T;
  }

  async send(chatId: string | number, post: Post, replyTo?: number) {
    const markup = post.buttons?.length ? { inline_keyboard: [post.buttons.map((b) => ({ text: b.text, url: b.url }))] } : undefined;
    const common = { chat_id: chatId, parse_mode: "HTML", reply_markup: markup, ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) };
    if (post.photo) {
      try {
        await this.api("sendPhoto", { ...common, photo: post.photo, caption: post.text.slice(0, 1024) });
        if (String(chatId) === this.cfg.chatId) {
          telegramStatus.lastPostAt = Math.floor(Date.now() / 1000);
          telegramStatus.canPost = true;
        }
        return;
      } catch (err) {
        log.warn("Telegram photo failed, sending text", { err: String(err) });
      }
    }
    await this.api("sendMessage", { ...common, text: post.text, link_preview_options: { is_disabled: true } });
    if (String(chatId) === this.cfg.chatId) {
      telegramStatus.lastPostAt = Math.floor(Date.now() / 1000);
      telegramStatus.canPost = true;
    }
  }

  // --------------------------------------------------------------------------------------------- state
  private async getState(key: string): Promise<string | null> {
    const [r] = await this.sql`SELECT value FROM bot_state WHERE key = ${key}`;
    return r ? String(r.value) : null;
  }
  private async setState(key: string, value: string) {
    await this.sql`
      INSERT INTO bot_state (key, value, updated_at) VALUES (${key}, ${value}, ${Math.floor(Date.now() / 1000)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`;
  }

  // --------------------------------------------------------------------------------------------- announcements
  /** One pass: new game events, then stage-ups. Returns how many posts were sent. Exposed for tests. */
  async announceOnce(maxPosts = 8): Promise<number> {
    let sent = 0;
    const cursorKey = "telegram:last_event_id";
    const [{ max }] = (await this.sql`SELECT COALESCE(max(id), 0)::int AS max FROM game_events`) as unknown as [{ max: number }];
    const cursorRaw = await this.getState(cursorKey);
    if (cursorRaw === null) {
      // First run: skip history, but still announce the last hour (e.g. a launch made while the bot was being set up).
      const [{ before }] = (await this.sql`
        SELECT COALESCE(max(id), 0)::int AS before FROM game_events
        WHERE created_at < ${Math.floor(Date.now() / 1000) - 3600}`) as unknown as [{ before: number }];
      await this.setState(cursorKey, String(Math.min(before, max)));
      return this.announceOnce(maxPosts);
    } else {
      const events = await this.sql`
        SELECT id, type, title, body, nation_id FROM game_events
        WHERE id > ${Number(cursorRaw)} AND type = ANY(${ANNOUNCE_TYPES as unknown as string[]})
        ORDER BY id ASC LIMIT ${maxPosts}`;
      let last = Number(cursorRaw);
      for (const e of events) {
        const [n] = e.nation_id === null ? [null] : await nationSummaries(this.sql, { ids: [Number(e.nation_id)] });
        await this.send(this.cfg.chatId, eventPost(this.cfg.siteUrl, { type: String(e.type), title: String(e.title), body: String(e.body), nationId: e.nation_id === null ? null : Number(e.nation_id) }, n ?? null));
        last = Number(e.id);
        sent++;
      }
      // Skip past events we don't announce.
      const next = events.length === maxPosts ? last : max;
      if (next !== Number(cursorRaw)) await this.setState(cursorKey, String(next));
    }

    // Stage-ups: compare each nation's stage with the last one we saw.
    const tiersKey = "telegram:tiers";
    const nations = await nationSummaries(this.sql);
    const seenRaw = await this.getState(tiersKey);
    const seen: Record<string, number> = seenRaw ? JSON.parse(seenRaw) : {};
    let changed = seenRaw === null;
    for (const n of nations) {
      const before = seen[n.id];
      if (before === undefined) {
        seen[n.id] = n.tier;
        changed = true;
      } else if (n.tier > before) {
        if (sent < maxPosts) {
          await this.send(this.cfg.chatId, stagePost(this.cfg.siteUrl, n));
          sent++;
        }
        seen[n.id] = n.tier;
        changed = true;
      } else if (n.tier < before) {
        seen[n.id] = n.tier;
        changed = true;
      }
    }
    if (changed) await this.setState(tiersKey, JSON.stringify(seen));
    return sent;
  }

  private async announceLoop() {
    while (!this.stopped) {
      try {
        await this.announceOnce();
      } catch (err) {
        noteError("announce", err);
        log.warn("Telegram announce failed", { err: String(err) });
      }
      await new Promise((r) => setTimeout(r, this.cfg.intervalMs));
    }
  }

  // --------------------------------------------------------------------------------------------- commands
  /** Builds the reply to a command, or null for anything that isn't one of ours. Exposed for tests. */
  async reply(text: string): Promise<Post | null> {
    const c = parseCommand(text);
    if (!c) return null;
    const site = this.cfg.siteUrl;
    switch (c.cmd) {
      case "start":
      case "help":
        return { text: helpText(site), buttons: [{ text: "Open AtlasPad", url: site }] };
      case "top": {
        const ns = (await nationSummaries(this.sql)).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, 5);
        return { text: listText("🏆 <b>Leading nations</b>", ns), buttons: [{ text: "Full leaderboard", url: `${site}/leaderboard` }] };
      }
      case "new": {
        const ns = (await nationSummaries(this.sql)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
        return { text: listText("🆕 <b>Newest nations</b>", ns), buttons: [{ text: "Discover", url: `${site}/discover` }] };
      }
      case "burned":
        return { text: burnedText(await flywheelStats(this.sql)), buttons: [{ text: "Open AtlasPad", url: site }] };
      case "nation":
      case "n": {
        if (!c.arg) return { text: "Send a ticker or a name, like <code>/nation $PEPE</code>." };
        const n = findNation(await nationSummaries(this.sql), c.arg);
        if (!n) return { text: `No nation matches “${esc(c.arg.slice(0, 40))}”.` };
        return { text: `<b>${esc(n.name)}</b> ($${esc(n.ticker)})\n\n${nationStats(n)}`, photo: cardUrl(site, n.id), buttons: [{ text: `Trade $${n.ticker}`, url: nationUrl(site, n.id) }] };
      }
      default:
        return null;
    }
  }

  private async commandLoop() {
    let warned = false;
    while (!this.stopped) {
      try {
        const updates = await this.api<{ update_id: number; message?: { message_id: number; chat: { id: number }; text?: string } }[]>(
          "getUpdates",
          { offset: this.offset, timeout: 25, allowed_updates: ["message"] },
          35_000,
        );
        for (const u of updates) {
          this.offset = u.update_id + 1;
          const m = u.message;
          if (!m?.text) continue;
          const post = await this.reply(m.text).catch(() => null);
          if (post) await this.send(m.chat.id, post, m.message_id).catch((err) => log.warn("Telegram reply failed", { err: String(err) }));
        }
        warned = false;
      } catch (err) {
        if (!warned) log.warn("Telegram getUpdates failed (commands paused, retrying)", { err: String(err) });
        warned = true;
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }
}
