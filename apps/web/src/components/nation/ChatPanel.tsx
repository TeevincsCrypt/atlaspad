"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { Crown, Loader2, Lock, MessageCircle, Send } from "lucide-react";
import { CHAT_MAX_LENGTH, chatSignInMessage, shortAddress, timeAgo, type ChatMessageDTO, type NationSummary } from "@atlaspad/shared";
import { network } from "@/lib/env";
import { useCitizen } from "@/lib/api";
import { useHydrated } from "@/lib/hooks";
import { useUi } from "@/lib/store";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toaster";

/** A short, stable color per wallet so voices are easy to tell apart. */
function voiceColor(address: string): string {
  const h = parseInt(address.slice(2, 8), 16) % 360;
  return `hsl(${h} 70% 72%)`;
}

function useChatSession() {
  return useQuery({
    queryKey: ["chat-session"],
    queryFn: async () => ((await (await fetch("/api/chat/session")).json()) as { address: string | null }).address,
    staleTime: 60_000,
  });
}

/**
 * The nation's chat: anyone can read it; citizens (and the founder) can post after a one-time, gasless sign-in.
 * New messages arrive by polling every few seconds.
 */
export function ChatPanel({ nation, onBuy }: { nation: NationSummary; onBuy: () => void }) {
  const { address, isConnected } = useAccount();
  const hydrated = useHydrated();
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  const qc = useQueryClient();
  const session = useChatSession();
  const me = address?.toLowerCase() ?? null;
  const signedIn = Boolean(me && session.data === me);
  const citizen = useCitizen(me ?? undefined);
  const isCitizen = me === nation.founder.toLowerCase() || Boolean(citizen.data?.profile.citizenships.some((c) => c.nationId === nation.id));

  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const lastId = messages.length ? messages[messages.length - 1]!.id : 0;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let stop = false;
    let after = 0;
    const tick = async () => {
      try {
        const r = await fetch(`/api/nations/${nation.id}/chat?after=${after}`);
        if (r.ok) {
          const d = (await r.json()) as { messages: ChatMessageDTO[]; disabled?: boolean };
          if (stop) return;
          setDisabled(Boolean(d.disabled));
          if (d.messages.length) {
            after = d.messages[d.messages.length - 1]!.id;
            setMessages((m) => [...m, ...d.messages.filter((x) => !m.some((y) => y.id === x.id))].slice(-300));
          }
          setLoaded(true);
        }
      } catch {
        /* retry on the next tick */
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [nation.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  return (
    <div className="panel flex h-[620px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <div className="flex items-center gap-2 font-display text-sm text-fg">
            <MessageCircle className="size-4 text-gold" /> {nation.name} chat
          </div>
          <div className="text-[11px] text-faint">Open to read. Only citizens of ${nation.ticker} can post.</div>
        </div>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
          <span className="size-1.5 animate-pulse-soft rounded-full bg-up" /> live
        </span>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
      >
        {!loaded ? (
          <div className="grid h-full place-items-center text-xs text-faint">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : disabled ? (
          <div className="grid h-full place-items-center text-center text-sm text-faint">Chat is being switched on. Check back in a few minutes.</div>
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <div className="text-3xl">🏛️</div>
              <div className="mt-2 font-display text-sm text-fg">The town square is quiet.</div>
              <div className="mt-1 text-xs text-faint">Citizens, say gm.</div>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`group flex gap-3 ${m.author === me ? "flex-row-reverse text-right" : ""}`}>
              <Link
                href={`/citizen/${m.author}`}
                className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 font-mono text-[10px]"
                style={{ background: `${voiceColor(m.author).replace("72%", "22%")}`, color: voiceColor(m.author) }}
                title={m.author}
              >
                {m.author.slice(2, 4)}
              </Link>
              <div className={`min-w-0 max-w-[80%] ${m.author === me ? "items-end" : ""}`}>
                <div className={`flex items-center gap-1.5 font-mono text-[10px] text-faint ${m.author === me ? "justify-end" : ""}`}>
                  <span style={{ color: voiceColor(m.author) }}>{m.author === me ? "you" : shortAddress(m.author)}</span>
                  {m.isFounder && (
                    <span className="inline-flex items-center gap-0.5 rounded border border-gold/40 px-1 text-gold-bright">
                      <Crown className="size-2.5" /> founder
                    </span>
                  )}
                  {m.share > 0 && <span>{m.share >= 0.001 ? `${(m.share * 100).toFixed(2)}%` : "<0.1%"}</span>}
                  <span>· {timeAgo(m.createdAt)}</span>
                </div>
                <div
                  className={`mt-1 inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed ${
                    m.author === me ? "rounded-tr-sm bg-gold/15 text-fg" : "rounded-tl-sm bg-white/[0.05] text-fg"
                  }`}
                >
                  {m.body}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-line p-3">
        {!hydrated ? null : !isConnected || !me ? (
          <Gate icon={<Lock className="size-4" />} text="Connect a wallet to join the conversation." action={<Button variant="primary" size="sm" onClick={() => setWalletOpen(true)}>Connect wallet</Button>} />
        ) : !isCitizen && !citizen.isLoading ? (
          <Gate icon={<Lock className="size-4" />} text={`Only citizens can post. Hold any amount of $${nation.ticker} to join.`} action={<Button variant="primary" size="sm" onClick={onBuy}>Buy ${nation.ticker}</Button>} />
        ) : !signedIn ? (
          <SignIn address={me} onDone={() => void qc.invalidateQueries({ queryKey: ["chat-session"] })} />
        ) : (
          <Composer nationId={nation.id} onSent={() => (stick.current = true)} />
        )}
      </div>
    </div>
  );
}

function Gate({ icon, text, action }: { icon: React.ReactNode; text: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3">
      <span className="flex items-center gap-2 text-xs text-dim">
        <span className="text-gold">{icon}</span> {text}
      </span>
      {action}
    </div>
  );
}

function SignIn({ address, onDone }: { address: string; onDone: () => void }) {
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try {
      const issuedAt = Math.floor(Date.now() / 1000);
      const signature = await signMessageAsync({ message: chatSignInMessage(network.chain.id, address, issuedAt) });
      const r = await fetch("/api/chat/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, issuedAt, signature }) });
      const d = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(d.message ?? d.error ?? `HTTP ${r.status}`);
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not sign in to chat", /reject|denied/i.test(msg) ? "You cancelled the signature." : msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Gate
      icon={<MessageCircle className="size-4" />}
      text="You're a citizen. Sign in once to chat (free, no gas)."
      action={
        <Button variant="primary" size="sm" onClick={() => void signIn()} loading={busy}>
          Sign in to chat
        </Button>
      }
    />
  );
}

function Composer({ nationId, onSent }: { nationId: number; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/nations/${nationId}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
      const d = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(d.message ?? d.error ?? `HTTP ${r.status}`);
      setText("");
      onSent();
    } catch (err) {
      toast.error("Message not sent", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, CHAT_MAX_LENGTH))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        rows={1}
        placeholder="Say something to your fellow citizens…"
        className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line-strong bg-black/30 px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-faint focus:border-gold/50"
      />
      <Button type="submit" variant="primary" className="h-11 w-11 !px-0" disabled={!text.trim()} loading={busy} aria-label="Send">
        {!busy && <Send className="size-4" />}
      </Button>
    </form>
  );
}
