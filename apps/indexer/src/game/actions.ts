import {
  ALLIANCE,
  BUILDINGS,
  GameAction,
  type BuildingType,
  computeStats,
  validateBuild,
  validateCreateAlliance,
  validateInvite,
  validateJoin,
  validateLeave,
  validateWarDeclaration,
} from "@atlaspad/shared";
import { applyResources, citizenThreshold, excludedFor, getResources, recordAction, type GameCtx } from "./common";
import { createEvent, upper } from "./news";
import { unlockCitizenAchievement, unlockNationAchievement } from "./progress";
import { citizenCountAsOf, forVoters, lastTradeAsOf } from "./queries";
import { loadGameStates } from "./state";

export interface ActionEvent {
  proposalId: number;
  nationId: number;
  action: number;
  arg: bigint;
  text: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
}

/** Apply one executed GameAction proposal under the published game rules. */
export async function applyAction(g: GameCtx, a: ActionEvent): Promise<void> {
  const sql = g.ctx.sql;
  const n = g.cache.byId.get(a.nationId);
  if (!n) return;
  const [done] = await sql`SELECT 1 FROM game_actions WHERE proposal_id = ${a.proposalId}`;
  if (done) return;
  const t = a.timestamp;
  const meta = { txHash: a.txHash, blockNumber: a.blockNumber, createdAt: t };
  const reject = async (reason: string) => {
    await recordAction(sql, a.proposalId, a.nationId, a.action, "rejected", reason, t);
    const item = await createEvent(sql, {
      ...meta,
      type: "ACTION_REJECTED",
      nationId: a.nationId,
      title: `📜 ${upper(n.name)}'s decree #${a.proposalId} could not be carried out.`,
      body: reason,
      data: { proposalId: a.proposalId, action: a.action },
      dedupeKey: `g:action:${a.proposalId}`,
    });
    if (item) g.news.push(item);
  };
  const applied = () => recordAction(sql, a.proposalId, a.nationId, a.action, "applied", null, t);
  g.touched.add(a.nationId);

  switch (a.action as GameAction) {
    case GameAction.Build: {
      const type = Number(a.arg);
      const def = BUILDINGS[type];
      const built = await sql`SELECT type, status FROM game_buildings WHERE nation_id = ${a.nationId}`;
      const resources = await getResources(sql, a.nationId);
      const citizens = await citizenCountAsOf(sql, n.id, t, citizenThreshold(n), excludedFor(g.ctx, n));
      const check = validateBuild({
        type,
        built: new Set(built.filter((b) => b.status === "complete").map((b) => Number(b.type) as BuildingType)),
        underConstruction: new Set(built.filter((b) => b.status === "constructing").map((b) => Number(b.type) as BuildingType)),
        resources,
        citizens,
        graduated: n.graduatedAt !== null && n.graduatedAt <= t,
      });
      if (!check.ok || !def) return reject(check.ok ? "Unknown building." : check.reason);
      const cost = def.cost;
      await applyResources(
        sql,
        a.nationId,
        { influence: -(cost.influence ?? 0), culture: -(cost.culture ?? 0), energy: -(cost.energy ?? 0), materials: -(cost.materials ?? 0) },
        t,
        `Construction: ${def.name}`,
        `build:${a.proposalId}`,
      );
      await sql`
        INSERT INTO game_buildings (nation_id, type, status, proposal_id, started_at, completes_at)
        VALUES (${a.nationId}, ${type}, 'constructing', ${a.proposalId}, ${t}, ${t + def.buildHours * 3600})
        ON CONFLICT (proposal_id) DO NOTHING`;
      await applied();
      const item = await createEvent(sql, {
        ...meta,
        type: "BUILDING_STARTED",
        nationId: a.nationId,
        title: `🏗️ ${upper(n.name)} began building a ${def.name}.`,
        body: `${def.icon} Completes in ${def.buildHours} hours. ${def.effect}`,
        data: { buildingType: type, proposalId: a.proposalId },
        dedupeKey: `g:build:${a.proposalId}`,
      });
      if (item) g.news.push(item);
      // Industrialist: citizens who voted for 3 enacted building decrees.
      for (const voter of await forVoters(sql, a.proposalId)) {
        const [{ c }] = (await sql`
          SELECT count(*)::int AS c FROM votes v JOIN game_actions ga ON ga.proposal_id = v.proposal_id
          WHERE v.voter = ${voter} AND v.support = 1 AND ga.action = ${GameAction.Build} AND ga.status = 'applied'`) as unknown as [{ c: number }];
        if (c >= 3) await unlockCitizenAchievement(sql, voter, "INDUSTRIALIST", a.nationId, t);
      }
      return;
    }

    case GameAction.DeclareWar: {
      const defenderId = Number(a.arg);
      const d = g.cache.byId.get(defenderId);
      const states = await loadGameStates(sql, [a.nationId, defenderId], t);
      const att = states.get(a.nationId)!;
      const def = states.get(defenderId)!;
      const [active] = await sql`
        SELECT count(*) FILTER (WHERE (attacker_id = ${a.nationId} AND defender_id = ${defenderId}) OR (attacker_id = ${defenderId} AND defender_id = ${a.nationId}))::int AS between,
               count(*) FILTER (WHERE attacker_id = ${a.nationId} OR defender_id = ${a.nationId})::int AS mine
        FROM game_wars WHERE status = 'active'`;
      const [last] = await sql`
        SELECT max(ends_at) AS ended FROM game_wars WHERE status = 'ended'
          AND ((attacker_id = ${a.nationId} AND defender_id = ${defenderId}) OR (attacker_id = ${defenderId} AND defender_id = ${a.nationId}))`;
      const check = validateWarDeclaration({
        attackerId: a.nationId,
        defenderId,
        defenderExists: Boolean(d),
        sameAlliance: att.allianceId !== null && att.allianceId === def.allianceId,
        activeWarBetween: Number(active?.between ?? 0) > 0,
        attackerActiveWars: Number(active?.mine ?? 0),
        lastWarBetweenEndedAt: last?.ended === null || last?.ended === undefined ? null : Number(last.ended),
        now: t,
      });
      if (!check.ok || !d) return reject(check.ok ? "Target nation does not exist." : check.reason);
      const startOf = async (id: number) => {
        const nation = g.cache.byId.get(id)!;
        const trade = await lastTradeAsOf(sql, id, t);
        const opening = (Number(nation.initialVirtualEth) / Number(nation.initialVirtualTokens)) * (Number(nation.totalSupply) / 1e18);
        return {
          citizens: await citizenCountAsOf(sql, id, t, citizenThreshold(nation), excludedFor(g.ctx, nation)),
          marketCapEth: trade?.marketCapEth ?? opening,
        };
      };
      await sql`
        INSERT INTO game_wars (id, attacker_id, defender_id, declared_at, ends_at, status, attacker_start, defender_start, tx_hash)
        VALUES (${a.proposalId}, ${a.nationId}, ${defenderId}, ${t}, ${t + 48 * 3600}, 'active',
          ${sql.json(await startOf(a.nationId))}, ${sql.json(await startOf(defenderId))}, ${a.txHash})
        ON CONFLICT (id) DO NOTHING`;
      await applied();
      g.touched.add(defenderId);
      const item = await createEvent(sql, {
        ...meta,
        type: "WAR_DECLARED",
        nationId: a.nationId,
        targetNationId: defenderId,
        title: `🚨 ${upper(n.name)} just declared war on ${upper(d.name)}.`,
        body: `The war lasts 48 hours and is decided by population growth, market momentum, trading activity and economic power.`,
        data: { warId: a.proposalId, attackerId: a.nationId, defenderId },
        dedupeKey: `g:war:${a.proposalId}`,
      });
      if (item) g.news.push(item);
      for (const voter of await forVoters(sql, a.proposalId)) await unlockCitizenAchievement(sql, voter, "WAR_VETERAN", a.nationId, t);
      return;
    }

    case GameAction.CreateAlliance: {
      const [cur] = await sql`SELECT alliance_id FROM game_nations WHERE nation_id = ${a.nationId}`;
      const check = validateCreateAlliance({ currentAllianceId: cur?.alliance_id === null || !cur ? null : Number(cur.alliance_id), name: a.text });
      if (!check.ok) return reject(check.reason);
      await sql`INSERT INTO game_alliances (id, name, leader_id, created_at) VALUES (${a.proposalId}, ${a.text}, ${a.nationId}, ${t}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO game_alliance_members (alliance_id, nation_id, joined_at) VALUES (${a.proposalId}, ${a.nationId}, ${t}) ON CONFLICT DO NOTHING`;
      await sql`UPDATE game_nations SET alliance_id = ${a.proposalId} WHERE nation_id = ${a.nationId}`;
      await applied();
      const item = await createEvent(sql, {
        ...meta,
        type: "ALLIANCE_FORMED",
        nationId: a.nationId,
        title: `🤝 ${upper(n.name)} founded ${upper(a.text)}.`,
        body: `A new alliance rises. Up to ${ALLIANCE.maxMembers} nations may join by invitation.`,
        data: { allianceId: a.proposalId, name: a.text },
        dedupeKey: `g:alliance:${a.proposalId}`,
      });
      if (item) g.news.push(item);
      const ach = await unlockNationAchievement(sql, a.nationId, n.name, "JOINED_ALLIANCE", t, meta);
      if (ach) g.news.push(ach);
      for (const voter of await forVoters(sql, a.proposalId)) await unlockCitizenAchievement(sql, voter, "DIPLOMAT", a.nationId, t);
      return;
    }

    case GameAction.InviteToAlliance: {
      const inviteeId = Number(a.arg);
      const [cur] = await sql`SELECT alliance_id FROM game_nations WHERE nation_id = ${a.nationId}`;
      const allianceId = cur?.alliance_id === null || !cur ? null : Number(cur.alliance_id);
      const [al] = allianceId === null ? [] : await sql`SELECT leader_id FROM game_alliances WHERE id = ${allianceId} AND active`;
      const [inv] = await sql`SELECT alliance_id FROM game_nations WHERE nation_id = ${inviteeId}`;
      const [{ c }] = (allianceId === null
        ? [{ c: 0 }]
        : await sql`SELECT count(*)::int AS c FROM game_alliance_members WHERE alliance_id = ${allianceId} AND left_at IS NULL`) as unknown as [{ c: number }];
      const check = validateInvite({
        inviterAllianceId: allianceId,
        inviterIsLeader: Boolean(al) && Number(al!.leader_id) === a.nationId,
        inviteeExists: g.cache.byId.has(inviteeId),
        inviteeAllianceId: inv?.alliance_id === null || !inv ? null : Number(inv.alliance_id),
        memberCount: c,
      });
      if (!check.ok || allianceId === null) return reject(check.ok ? "No alliance." : check.reason);
      await sql`
        INSERT INTO game_alliance_invites (alliance_id, nation_id, invited_at, proposal_id)
        VALUES (${allianceId}, ${inviteeId}, ${t}, ${a.proposalId})
        ON CONFLICT (alliance_id, nation_id) DO UPDATE SET invited_at = excluded.invited_at, proposal_id = excluded.proposal_id`;
      await applied();
      const [alliance] = await sql`SELECT name FROM game_alliances WHERE id = ${allianceId}`;
      const item = await createEvent(sql, {
        ...meta,
        type: "ALLIANCE_INVITE",
        nationId: a.nationId,
        targetNationId: inviteeId,
        title: `✉️ ${upper(n.name)} invited ${upper(g.cache.byId.get(inviteeId)!.name)} to join ${upper(String(alliance?.name ?? "their alliance"))}.`,
        body: `The invitation is valid for 14 days. ${upper(g.cache.byId.get(inviteeId)!.name)} citizens must vote to join (alliance #${allianceId}).`,
        data: { allianceId },
        dedupeKey: `g:invite:${a.proposalId}`,
      });
      if (item) g.news.push(item);
      g.touched.add(inviteeId);
      return;
    }

    case GameAction.JoinAlliance: {
      const allianceId = Number(a.arg);
      const [al] = await sql`SELECT * FROM game_alliances WHERE id = ${allianceId}`;
      const [cur] = await sql`SELECT alliance_id FROM game_nations WHERE nation_id = ${a.nationId}`;
      const [invite] = await sql`SELECT invited_at FROM game_alliance_invites WHERE alliance_id = ${allianceId} AND nation_id = ${a.nationId}`;
      const members = await sql`SELECT nation_id FROM game_alliance_members WHERE alliance_id = ${allianceId} AND left_at IS NULL`;
      const memberIds = members.map((m) => Number(m.nation_id));
      const [war] = memberIds.length
        ? await sql`
            SELECT 1 FROM game_wars WHERE status = 'active' AND (
              (attacker_id = ${a.nationId} AND defender_id = ANY(${memberIds})) OR
              (defender_id = ${a.nationId} AND attacker_id = ANY(${memberIds})))`
        : [];
      const check = validateJoin({
        allianceExists: Boolean(al),
        allianceActive: Boolean(al?.active),
        currentAllianceId: cur?.alliance_id === null || !cur ? null : Number(cur.alliance_id),
        invitedAt: invite ? Number(invite.invited_at) : null,
        memberCount: memberIds.length,
        now: t,
        atWarWithMember: Boolean(war),
      });
      if (!check.ok) return reject(check.reason);
      await sql`INSERT INTO game_alliance_members (alliance_id, nation_id, joined_at) VALUES (${allianceId}, ${a.nationId}, ${t}) ON CONFLICT DO NOTHING`;
      await sql`UPDATE game_nations SET alliance_id = ${allianceId} WHERE nation_id = ${a.nationId}`;
      await sql`DELETE FROM game_alliance_invites WHERE alliance_id = ${allianceId} AND nation_id = ${a.nationId}`;
      await applied();
      for (const id of memberIds) g.touched.add(id);
      const item = await createEvent(sql, {
        ...meta,
        type: "ALLIANCE_JOINED",
        nationId: a.nationId,
        title: `🤝 ${upper(n.name)} joined ${upper(String(al!.name))}.`,
        body: `The alliance now has ${memberIds.length + 1} members.`,
        data: { allianceId },
        dedupeKey: `g:join:${a.proposalId}`,
      });
      if (item) g.news.push(item);
      const ach = await unlockNationAchievement(sql, a.nationId, n.name, "JOINED_ALLIANCE", t, meta);
      if (ach) g.news.push(ach);
      for (const voter of await forVoters(sql, a.proposalId)) await unlockCitizenAchievement(sql, voter, "DIPLOMAT", a.nationId, t);
      return;
    }

    case GameAction.LeaveAlliance: {
      const allianceId = Number(a.arg);
      const [cur] = await sql`SELECT alliance_id FROM game_nations WHERE nation_id = ${a.nationId}`;
      const check = validateLeave({ currentAllianceId: cur?.alliance_id === null || !cur ? null : Number(cur.alliance_id), allianceId });
      if (!check.ok) return reject(check.reason);
      await sql`UPDATE game_alliance_members SET left_at = ${t} WHERE alliance_id = ${allianceId} AND nation_id = ${a.nationId} AND left_at IS NULL`;
      await sql`UPDATE game_nations SET alliance_id = NULL WHERE nation_id = ${a.nationId}`;
      const [al] = await sql`SELECT name, leader_id FROM game_alliances WHERE id = ${allianceId}`;
      const remaining = await sql`SELECT nation_id FROM game_alliance_members WHERE alliance_id = ${allianceId} AND left_at IS NULL ORDER BY joined_at, nation_id`;
      if (!remaining.length) {
        await sql`UPDATE game_alliances SET active = false, dissolved_at = ${t} WHERE id = ${allianceId}`;
      } else if (Number(al?.leader_id) === a.nationId) {
        await sql`UPDATE game_alliances SET leader_id = ${Number(remaining[0]!.nation_id)} WHERE id = ${allianceId}`;
      }
      for (const r of remaining) g.touched.add(Number(r.nation_id));
      await applied();
      const item = await createEvent(sql, {
        ...meta,
        type: "ALLIANCE_LEFT",
        nationId: a.nationId,
        title: `💔 ${upper(n.name)} left ${upper(String(al?.name ?? "its alliance"))}.`,
        body: remaining.length ? `${remaining.length} member nations remain.` : "The alliance has dissolved.",
        data: { allianceId },
        dedupeKey: `g:leave:${a.proposalId}`,
      });
      if (item) g.news.push(item);
      return;
    }

    default:
      return reject("Unknown game action.");
  }
}

/** Military/defense at a point in time, for war scoring. */
export async function sideStats(g: GameCtx, nationId: number, t: number) {
  const sql = g.ctx.sql;
  const n = g.cache.byId.get(nationId)!;
  const trade = await lastTradeAsOf(sql, nationId, t);
  const opening = (Number(n.initialVirtualEth) / Number(n.initialVirtualTokens)) * (Number(n.totalSupply) / 1e18);
  const [snap] = await sql`SELECT volume_24h_eth FROM game_snapshots WHERE nation_id = ${nationId} AND epoch <= ${t} ORDER BY epoch DESC LIMIT 1`;
  const citizens = await citizenCountAsOf(sql, nationId, t, citizenThreshold(n), excludedFor(g.ctx, n));
  const state = (await loadGameStates(sql, [nationId], t)).get(nationId)!;
  const stats = computeStats(
    {
      marketCapEth: trade?.marketCapEth ?? opening,
      liquidityEth: trade?.liquidityEth ?? 0,
      volume24hEth: Number(snap?.volume_24h_eth ?? 0),
      citizens,
    },
    state,
  );
  return { citizens, marketCapEth: trade?.marketCapEth ?? opening, stats, allies: state.allies, influence: state.resources.influence };
}
