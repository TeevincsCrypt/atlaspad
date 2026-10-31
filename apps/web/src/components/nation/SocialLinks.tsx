"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { Globe, Pencil, Send, Share2 } from "lucide-react";
import { EMPTY_SOCIALS, normalizeSocials, socialsMessage, type NationSocials, type NationSummary } from "@atlaspad/shared";
import { network, publicEnv } from "@/lib/env";
import { queryKeys } from "@/lib/api";
import { useHydrated } from "@/lib/hooks";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { toast } from "../ui/Toaster";
import { WatchButton } from "../ui/WatchButton";

/** Founders can stash links during founding; the nation page offers to save them once the nation exists. */
export const pendingSocialsKey = (ticker: string) => `atlaspad-pending-socials-${ticker.toUpperCase()}`;

function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1 2h6.4l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L6.3 3.8H4.5l13.3 16.3Z" />
    </svg>
  );
}

const pill = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[11px] text-dim transition hover:border-line-strong hover:text-fg";

/** Social links, a share-to-X button, and (for the founder) a signed editor. */
export function SocialLinks({ nation, socials }: { nation: NationSummary; socials: NationSocials | null | undefined }) {
  const { address } = useAccount();
  const hydrated = useHydrated();
  const isFounder = hydrated && !!address && address.toLowerCase() === nation.founder.toLowerCase();
  const [manualOpen, setManualOpen] = useState(false);
  const [pendingDismissed, setPendingDismissed] = useState(false);

  // Links typed in during founding: offer to save them the first time the founder opens the new nation.
  const pending = useMemo<NationSocials | null>(() => {
    if (!isFounder || socials) return null;
    try {
      const raw = localStorage.getItem(pendingSocialsKey(nation.ticker));
      return raw ? (JSON.parse(raw) as NationSocials) : null;
    } catch {
      return null;
    }
  }, [isFounder, socials, nation.ticker]);

  const s = socials ?? EMPTY_SOCIALS;
  const showPending = pending !== null && !pendingDismissed;
  const open = manualOpen || showPending;
  const close = () => {
    setManualOpen(false);
    setPendingDismissed(true);
  };
  const shareUrl = `${publicEnv.siteUrl}/nation/${nation.id}`;
  const shareText = `${nation.name} ($${nation.ticker}) is a nation on @AtlasPad: every token is a nation, every nation runs on $WIF.`;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <WatchButton id={nation.id} withLabel className={`${pill} !text-[11px]`} />
      {s.x && (
        <a href={s.x} target="_blank" rel="noopener noreferrer nofollow" className={pill} aria-label="X profile">
          <XIcon className="size-3.5" /> {s.x.replace("https://x.com/", "@")}
        </a>
      )}
      {s.telegram && (
        <a href={s.telegram} target="_blank" rel="noopener noreferrer nofollow" className={pill} aria-label="Telegram">
          <Send className="size-3.5" /> Telegram
        </a>
      )}
      {s.website && (
        <a href={s.website} target="_blank" rel="noopener noreferrer nofollow" className={pill} aria-label="Website">
          <Globe className="size-3.5" /> {new URL(s.website).hostname.replace(/^www\./, "")}
        </a>
      )}
      <a href={intent} target="_blank" rel="noopener noreferrer" className={`${pill} border-gold/30 text-gold-bright hover:border-gold/60`}>
        <Share2 className="size-3.5" /> Share on X
      </a>
      {isFounder && (
        <button
          className={pill}
          onClick={() => setManualOpen(true)}
        >
          <Pencil className="size-3.5" /> {s.x || s.telegram || s.website ? "Edit links" : "Add social links"}
        </button>
      )}
      {isFounder && open && <SocialsEditor onClose={close} nation={nation} initial={showPending && !manualOpen ? pending! : s} />}
    </div>
  );
}

function SocialsEditor({ onClose, nation, initial }: { onClose: () => void; nation: NationSummary; initial: NationSocials }) {
  const [form, setForm] = useState<NationSocials>(initial);
  const [saving, setSaving] = useState(false);
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  const norm = normalizeSocials(form);
  const bad = norm.ok ? null : norm.field;

  async function save() {
    if (!norm.ok) return;
    setSaving(true);
    try {
      const issuedAt = Math.floor(Date.now() / 1000);
      const signature = await signMessageAsync({ message: socialsMessage(network.chain.id, nation.id, norm.socials, issuedAt) });
      const res = await fetch(`/api/nations/${nation.id}/socials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...norm.socials, issuedAt, signature }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      try {
        localStorage.removeItem(pendingSocialsKey(nation.ticker));
      } catch {
        /* ignore */
      }
      await qc.invalidateQueries({ queryKey: queryKeys.nation(nation.id) });
      toast.success("Social links saved");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Links not saved", /reject|denied/i.test(msg) ? "You cancelled the signature." : msg);
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof NationSocials, label: string, placeholder: string) => (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className={`h-11 w-full rounded-lg border bg-black/30 px-3 font-mono text-sm text-fg outline-none placeholder:text-faint focus:border-gold/60 ${bad === key ? "border-down/60" : "border-line-strong"}`}
      />
      {bad === key && <span className="mt-1 block text-[11px] text-down">That doesn&apos;t look like a valid {label.toLowerCase()} link.</span>}
    </label>
  );

  return (
    <Dialog open onClose={onClose} title={`${nation.name} · social links`}>
      <div className="space-y-4">
        {field("x", "X", "@yournation or x.com/yournation")}
        {field("telegram", "Telegram", "t.me/yournation")}
        {field("website", "Website", "yournation.xyz")}
        <p className="text-[11px] leading-relaxed text-faint">
          Saving asks your founder wallet to sign a message. It is free: no transaction and no gas. Only the founder wallet can change these links.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!norm.ok}>
            Sign &amp; save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
