import { BUILDINGS, BuildingType, WAR, resolveWar } from "@atlaspad/shared";
import { applyResources, citizenThreshold, excludedFor, type GameCtx } from "./common";
import { sideStats } from "./actions";
import { createEvent, upper } from "./news";
import { unlockCitizenAchievement, unlockNationAchievement } from "./progress";
import { citizensAsOf, volumeBetween } from "./queries";

/** Earliest pending timed item (building completion or war end) strictly after `after` and at or before `until`. */
export async function nextTimed(g: GameCtx, after: number, until: number): Promise<number | null> {
  const [r] = await g.ctx.sql`
    SELECT min(t) AS t FROM (
      SELECT completes_at AS t FROM game_buildings WHERE status = 'constructing' AND completes_at > ${after} AND completes_at <= ${until}
      UNION ALL
      SELECT ends_at AS t FROM game_wars WHERE status = 'active' AND ends_at > ${after} AND ends_at <= ${until}
    ) x`;
  return r?.t === null || r?.t === undefined ? null : Number(r.t);
}

/** Complete buildings and end wars whose time is exactly `t` or earlier. */
export async function processTimed(g: GameCtx, t: number): Promise<void> {
  const sql = g.ctx.sql;
  const builds = await sql`SELECT * FROM game_buildings WHERE status = 'constructing' AND completes_at <= ${t} ORDER BY completes_at, id`;
  for (const b of builds) {
    const nationId = Number(b.nation_id);
    const n = g.cache.byId.get(nationId);
    if (!n) continue;
    const at = Number(b.completes_at);
    const type = Number(b.type) as BuildingType;
    const def = BUILDINGS[type]!;
    await sql`UPDATE game_buildings SET status = 'complete', completed_at = ${at} WHERE id = ${b.id}`;
    const [{ c }] = (await sql`SELECT count(*)::int AS c FROM game_buildings WHERE nation_id = ${nationId} AND type = ${type} AND status = 'complete'`) as unknown as [{ c: number }];
    const item = await createEvent(sql, {
      type: "BUILDING_COMPLETED",
      nationId,
      title: `🏗️ ${upper(n.name)} completed ${c === 1 ? "its first" : "a"} ${def.name}.`,
      body: `${def.icon} ${def.effect}`,
      data: { buildingType: type, buildingId: Number(b.id) },
      createdAt: at,
      dedupeKey: `g:built:${b.proposal_id}`,
    });
    if (item) g.news.push(item);
    const unlock = async (code: string) => {
      const a = await unlockNationAchievement(sql, nationId, n.name, code, at);
      if (a) g.news.push(a);
    };
    await unlock("FIRST_BUILDING");
    if (type === BuildingType.Monument) await unlock("FIRST_MONUMENT");
    if (type === BuildingType.Spaceport) {
      await unlock("SPACEFARING");
      for (const addr of await citizensAsOf(sql, nationId, at, citizenThreshold(n), excludedFor(g.ctx, n))) {
        await unlockCitizenAchievement(sql, addr, "SPACE_PIONEER", nationId, at);
      }
    }
    g.touched.add(nationId);
  }

  const wars = await sql`SELECT * FROM game_wars WHERE status = 'active' AND ends_at <= ${t} ORDER BY ends_at, id`;
  for (const w of wars) {
    const at = Number(w.ends_at);
    const attackerId = Number(w.attacker_id);
    const defenderId = Number(w.defender_id);
    const a = g.cache.byId.get(attackerId);
    const d = g.cache.byId.get(defenderId);
    if (!a || !d) continue;
    const aStart = w.attacker_start as { citizens: number; marketCapWif: number };
    const dStart = w.defender_start as { citizens: number; marketCapWif: number };
    const aEnd = await sideStats(g, attackerId, at);
    const dEnd = await sideStats(g, defenderId, at);
    const aVol = await volumeBetween(sql, attackerId, Number(w.declared_at), at);
    const dVol = await volumeBetween(sql, defenderId, Number(w.declared_at), at);
    const side = (start: typeof aStart, end: typeof aEnd, vol: number) => ({
      citizensStart: start.citizens,
      citizensEnd: end.citizens,
      marketCapStartWif: start.marketCapWif,
      marketCapEndWif: end.marketCapWif,
      warVolumeWif: vol,
      economicPowerEnd: end.stats.economicPower,
      defensivePowerEnd: end.stats.defensivePower,
      allies: end.allies,
    });
    // Spoils are computed from the loser's influence; evaluate both outcomes' loser deterministically.
    const provisional = resolveWar(side(aStart, aEnd, aVol.eth), side(dStart, dEnd, dVol.eth), 0);
    const loserInfluence = provisional.winner === "attacker" ? dEnd.influence : aEnd.influence;
    const result = resolveWar(side(aStart, aEnd, aVol.eth), side(dStart, dEnd, dVol.eth), loserInfluence);
    const winnerId = result.winner === "attacker" ? attackerId : defenderId;
    const loserId = winnerId === attackerId ? defenderId : attackerId;
    const winner = winnerId === attackerId ? a : d;
    const loser = winnerId === attackerId ? d : a;

    await sql`
      UPDATE game_wars SET status = 'ended', winner_id = ${winnerId},
        attacker_score = ${sql.json(result.attacker as never)}, defender_score = ${sql.json(result.defender as never)},
        spoils = ${result.spoils}
      WHERE id = ${w.id}`;
    await applyResources(sql, winnerId, { influence: result.spoils }, at, `War spoils (war #${w.id})`, `war:${w.id}:spoils`);
    await applyResources(sql, loserId, { influence: -Math.floor(result.spoils / 2) }, at, `War defeat (war #${w.id})`, `war:${w.id}:loss`);
    await sql`UPDATE game_nations SET war_wins = war_wins + 1, war_territory_bonus_until = ${at + WAR.territoryBonusSeconds} WHERE nation_id = ${winnerId}`;
    await sql`UPDATE game_nations SET war_losses = war_losses + 1 WHERE nation_id = ${loserId}`;
    const ws = winnerId === attackerId ? result.attacker.total : result.defender.total;
    const ls = winnerId === attackerId ? result.defender.total : result.attacker.total;
    const item = await createEvent(sql, {
      type: "WAR_ENDED",
      nationId: winnerId,
      targetNationId: loserId,
      title: `🏆 ${upper(winner.name)} won the war against ${upper(loser.name)}.`,
      body: `Final score ${ws.toFixed(1)} – ${ls.toFixed(1)}. ${upper(winner.name)} gains ${result.spoils} influence and +${WAR.territoryBonusPct}% territory for 7 days.`,
      data: { warId: Number(w.id), winnerId, loserId, attacker: result.attacker, defender: result.defender, spoils: result.spoils },
      createdAt: at,
      dedupeKey: `g:warend:${w.id}`,
    });
    if (item) g.news.push(item);
    const ach = await unlockNationAchievement(sql, winnerId, winner.name, "FIRST_VICTORY", at);
    if (ach) g.news.push(ach);
    g.touched.add(attackerId);
    g.touched.add(defenderId);
  }
}
