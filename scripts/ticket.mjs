import { MID, esc, formatCp, levelDC, parseCoins, pay, setting, t, walletCp } from "./util.mjs";
import { canAct, keepAlive, leaveLine } from "./turn.mjs";
import { FOODS, MACHINES, TIERS, TIER_COLOR, TIER_STARS, boardOf, drawPrize, foodPrize, loadIndex, machineOf, pickTier, setOf, weights } from "./pool.mjs";
import { foodSource as catalogFood } from "./foods.mjs";

/* ======================================================================== *
 * A chance after rest: a chat card lists the characters with a roll button.
 * The check (by machine: Survival for the roulette, Thievery for the slot,
 * Perception for High & Low — settings) against the DC:
 *   critical success — a bonus (an extra free spin; for High & Low a
 *                      wrong guess forgiven once)
 *   success          — a chance
 *   failure          — nothing found
 * The chance is a "ticket" on the actor (flags.rutz-pf2e-gacha.ticket), so
 * closing the window loses nothing.
 *
 * Machines:
 *   roulette  spin; re-spins cost money (1×, up to 3); keep any pull
 *   slot      stop the reels yourself; cheap re-spins (½×, up to 5)
 *   highlow   double up: one draw, then guess higher/lower on the next
 *             card of a real 52-card deck (no card comes back). Each right
 *             guess is a rung; every two rungs the find goes a tier up.
 *             Wrong — the pot is lost (one bite of food to take home);
 *             the same rank — the house wins. Red/black all-in: two rungs.
 *             Stop any time and take what you have.
 * ======================================================================== */

export function ticketOf(actor) {
  return foundry.utils.deepClone(actor?.getFlag?.(MID, "ticket") ?? null);
}

async function saveTicket(actor, tk) {
  if (tk === null) await actor.unsetFlag(MID, "ticket");
  else await actor.setFlag(MID, "ticket", tk);
}

export function dcFor(actor) {
  return setting("dcMode", "level") === "fixed" ? Number(setting("dc", 15)) || 15 : levelDC(actor?.level ?? 1);
}

const SKILL_KEY = { roulette: "skill", slot: "skillSlot", highlow: "skillHighLow" };
const SKILL_DEFAULT = { roulette: "survival", slot: "thievery", highlow: "perception" };
export function skillOf(machine) {
  const m = machineOf(machine);
  return String(setting(SKILL_KEY[m], SKILL_DEFAULT[m]) || SKILL_DEFAULT[m]).trim().toLowerCase();
}
function skillLabel(actor, slug) {
  const stat = actor?.getStatistic?.(slug) ?? actor?.skills?.[slug];
  return stat?.label ?? slug;
}

/**
 * The base price of a re-spin for a character of this level (setting costMode):
 *   fixed  the same for everyone (rerollCost)
 *   level  rerollCost × level (1 sp at level 1, 2 gp at level 20 …)
 *   table  the GM's table "1: 1 sp, 5: 5 sp, 10: 1 gp" (the highest level at or below applies)
 */
export function rerollCost(level = 1) {
  const read = parseCoins(setting("rerollCost", "1 sp"));
  const base = Math.max(0, Number.isFinite(read) ? read : 10);
  const L = Math.max(1, Math.round(Number(level) || 1));
  const mode = setting("costMode", "level");
  if (mode === "level") return base * L;
  if (mode === "table") {
    const rows = String(setting("costTable", "") || "").split(/[,;\n]+/).map(x => { const [lv, ...rest] = x.split(":"); return [Number(lv), parseCoins(rest.join(":"))]; })
      .filter(([lv, cp]) => Number.isFinite(lv) && Number.isFinite(cp)).sort((a, b) => a[0] - b[0]);
    let cp = rows.length ? rows[0][1] : base;
    for (const [lv, c] of rows) if (lv <= L) cp = c;
    return Math.max(0, Math.round(cp));
  }
  return base;
}

/** What one more try costs on this machine: the base price × the machine's rate. */
export function machineCost(machine, level) {
  const rate = { roulette: 1, slot: Number(setting("slotRate", 0.5)), highlow: Number(setting("hlRate", 0)) }[machineOf(machine)];
  return Math.max(0, Math.round(rerollCost(level) * (Number.isFinite(rate) ? rate : 1)));
}

/** Re-spins: "pick" — keep every pull and choose one; "last" — a re-spin replaces what came before. */
export const keepMode = () => (setting("keepMode", "pick") === "last" ? "last" : "pick");
export const maxRerolls = (machine = "roulette") => {
  const m = machineOf(machine);
  const v = m === "slot" ? setting("slotMax", 5) : m === "highlow" ? 99 : setting("maxRerolls", 3);
  return Math.max(0, Math.round(Number(v) || 0));
};

/* ---------------- the offer ---------------- */

export const machineName = m => t(`Machine.${machineOf(m)}`);
export const setName = s => t(`Set.${setOf(s)}`);

function offerHtml(actors, machine, set) {
  const choose = machine === "choice";
  const rows = actors.map(a => {
    const pick = choose ? `<select data-rpg="machine" data-actor="${a.id}">${MACHINES.map(m => `<option value="${m}">${machineName(m)}</option>`).join("")}</select>` : "";
    return `<li data-actor="${a.id}"><img src="${esc(a.img)}" alt=""><b>${esc(a.name)}</b>${pick}
      <span class="dc">DC ${dcFor(a)}</span><button type="button" data-rpg="roll" data-actor="${a.id}"><i class="fa-solid fa-dice-d20"></i> ${t("Offer.Roll")}</button></li>`;
  }).join("");
  const what = choose ? t("Offer.Choose") : t("Offer.Machine", { machine: machineName(machine), skill: esc(skillLabel(actors[0], skillOf(machine))) });
  const forage = setOf(set) === "forage";
  return `<div class="rpg-card ${forage ? "forage" : "loot"}"><header><i class="fa-solid ${forage ? "fa-campground" : "fa-sack-dollar"}"></i> <b>${t(forage ? "Offer.Title" : "Offer.LootTitle")}</b></header>
    <p>${t(forage ? "Offer.Line" : "Offer.LootLine")}</p><p class="machine">${what}</p><ul>${rows}</ul>
    ${choose && !forage ? "" : `<p class="dim">${t("Offer.Odds", oddsText(boardOf(machine, set)))}</p>`}</div>`;
}

/** The odds of a board ("forage", or a machine's loot). */
export function oddsText(board = "roulette") {
  const w = weights(board);
  const pct = k => `${Math.round(w[k] * 1000) / 10}%`;
  return { common: pct("common"), uncommon: pct("uncommon"), rare: pct("rare"), epic: pct("epic"), legendary: pct("legendary") };
}

/**
 * Post a chance for these characters on this machine ("choice": each player picks).
 * set: "forage" (after camp — food and healing) or "loot" (after a fight).
 */
export async function offer(actors, machine = null, set = "forage") {
  actors = actors.filter(a => a?.type === "character");
  if (!actors.length) return null;
  machine = machine ?? setting("machine", "choice");
  if (machine !== "choice") machine = machineOf(machine);
  set = setOf(set);
  return ChatMessage.create({ content: offerHtml(actors, machine, set), speaker: { alias: t("Title") }, flags: { [MID]: { offer: { actors: actors.map(a => a.id), machine, set } } } });
}

async function rollFor(message, actor, machine, set = "forage") {
  if (!actor?.isOwner) return ui.notifications.warn(t("NotYours"));
  if (actor.getFlag(MID, "lastOffer") === message.id) return ui.notifications.warn(t("Offer.Done"));
  machine = machineOf(machine);
  const stat = actor.getStatistic?.(skillOf(machine)) ?? actor.skills?.[skillOf(machine)];
  if (!stat?.roll) return ui.notifications.warn(t("NoSkill"));
  const dc = dcFor(actor);
  const r = await stat.roll({ dc: { value: dc }, extraRollOptions: ["rutz-gacha", `rutz-gacha:${machine}`], label: `${t("Offer.Title")} · ${machineName(machine)}` }).catch(() => null);
  if (!r) return false;
  let degree = r.degreeOfSuccess ?? r.options?.degreeOfSuccess;
  if (typeof degree !== "number") degree = r.total >= dc + 10 ? 3 : r.total >= dc ? 2 : r.total <= dc - 10 ? 0 : 1;
  await actor.setFlag(MID, "lastOffer", message.id);
  if (degree < 2) {
    await ChatMessage.create({ content: `<div class="rpg-card miss"><p>${t("Offer.Nothing", { name: esc(actor.name) })}</p></div>`, speaker: ChatMessage.getSpeaker({ actor }) });
    return true;
  }
  const crit = degree === 3;
  const tk = { msg: message.id, machine, set: setOf(set), level: actor.level ?? 1, free: 1, rerolls: 0, spins: [], crit };
  if (machine !== "highlow" && crit) tk.free = 2;
  if (machine === "highlow") tk.hl = { card: null, steps: 0, rung: 0, safe: crit ? 1 : 0, log: [] };
  await saveTicket(actor, tk);
  game.rutzGacha?.open(actor);
  return true;
}

export function wireOffer(message, html) {
  const el = html instanceof HTMLElement ? html : html?.[0];
  const off = message.getFlag(MID, "offer");
  if (!el || !off) return;
  el.querySelectorAll("[data-rpg='roll']").forEach(btn => {
    const actor = game.actors.get(btn.dataset.actor);
    const done = actor?.getFlag(MID, "lastOffer") === message.id;
    const sel = el.querySelector(`select[data-rpg='machine'][data-actor='${btn.dataset.actor}']`);
    if (!actor?.isOwner || done) { btn.disabled = true; if (sel) sel.disabled = true; }
    if (done) btn.innerHTML = `<i class="fa-solid fa-check"></i> ${t("Offer.Rolled")}`;
    btn.addEventListener("click", async ev => {
      ev.preventDefault();
      btn.disabled = true;
      const ok = await rollFor(message, actor, off.machine === "choice" ? sel?.value : (off.machine ?? "roulette"), off.set ?? "forage");
      if (!ok) btn.disabled = false;
    });
  });
}

/* ---------------- spinning ---------------- */

/** What the next spin costs: 0 (free), cp, or null (no spins left). High & Low draws once. */
export function nextCost(tk) {
  if (!tk) return null;
  if (tk.free > 0) return 0;
  if (machineOf(tk.machine) === "highlow") return null;
  if (tk.rerolls < maxRerolls(tk.machine)) return machineCost(tk.machine, tk.level);
  return null;
}

async function charge(actor, tk, cost, left) {
  if (walletCp(actor) < cost || !(await pay(actor, cost))) { ui.notifications.warn(t("NoMoney", { cost: formatCp(cost) })); return false; }
  tk.paid = (tk.paid ?? 0) + cost;
  // The chat line goes out without holding up the wheel.
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="rpg-card pay"><i class="fa-solid fa-coins"></i> ${t("PaidLine", { name: esc(actor.name), cost: formatCp(cost), n: left })}</div>` }).catch(() => null);
  return true;
}

/* A deck: cards 0–51, rank = id % 13 + 1 (A … K), suit = floor(id / 13): ♠ ♥ ♦ ♣ (♥ ♦ red). */
export const rankOf = id => (id % 13) + 1;
export const suitOf = id => Math.floor(id / 13);
export const isRed = id => suitOf(id) === 1 || suitOf(id) === 2;
function shuffled() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** Spend a spin and draw its prize (saved before the wheel turns, so closing the window keeps it). */
export async function spin(actor) {
  const tk = ticketOf(actor);
  const cost = nextCost(tk);
  if (cost === null) return null;
  if (!canAct(actor)) { ui.notifications.warn(t("Turn.NotYet")); return null; }
  keepAlive(actor);
  if (cost > 0) {
    tk.rerolls += 1;
    if (!(await charge(actor, tk, cost, maxRerolls(tk.machine) - tk.rerolls))) return null;
  } else tk.free -= 1;
  await loadIndex();
  const machine = machineOf(tk.machine);
  const board = ticketBoard(tk);
  const tier = pickTier(weights(board));
  const prize = drawPrize(tier, tk.level, board);
  tk.spins.push(prize);
  if (machine === "highlow") {
    tk.hl ??= { steps: 0, safe: 0, log: [] };
    tk.hl.deck = shuffled();
    tk.hl.card = tk.hl.deck.pop();
    tk.hl.rung = 0;
    tk.hl.start = prize.tier;
  }
  await saveTicket(actor, tk);
  return prize;
}

/** Old tickets (before the two sets) were loot. */
export const ticketBoard = tk => boardOf(tk?.machine, tk?.set ?? "loot");

/* ---------------- High & Low ---------------- */

/** Rungs per tier (setting): two right guesses move the find a tier up. */
export const rungsPerTier = () => Math.max(1, Math.round(Number(setting("hlRungs", 2)) || 2));

/** The tier the find has at this rung, starting from the tier first drawn. */
export function tierAt(start, rung) {
  return TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(start) + Math.floor(rung / rungsPerTier()))];
}
/** The top rung: the find is legendary. */
export function topRung(start) {
  return (TIERS.length - 1 - TIERS.indexOf(start)) * rungsPerTier();
}

/** The odds for the next card, counted from what is left in the deck: { hi, lo, tie, red, black }. */
export function hlOdds(tkOrView) {
  const hl = tkOrView?.hl ?? tkOrView;
  const deck = hl?.deck ?? [];
  const c = rankOf(hl.card);
  const n = deck.length || 1;
  const count = f => deck.filter(f).length / n;
  return { hi: count(x => rankOf(x) > c), lo: count(x => rankOf(x) < c), tie: count(x => rankOf(x) === c), red: count(isRed), black: count(x => !isRed(x)), left: deck.length };
}

/** Can this ticket guess again? null = no; otherwise what it costs. */
export function guessCost(tk) {
  if (machineOf(tk?.machine) !== "highlow" || !tk.spins?.length || tk.bust || tk.hl?.card === null || tk.hl?.card === undefined) return null;
  if ((tk.hl.rung ?? 0) >= topRung(tk.hl.start ?? tk.spins[0].tier)) return null;
  return machineCost("highlow", tk.level);
}

/** A bite of food to take home after losing the pot. */
function consolation() {
  const keys = Object.keys(FOODS).filter(k => FOODS[k].food && ["poor", "plain"].includes(FOODS[k].quality));
  const key = keys[Math.floor(Math.random() * keys.length)];
  return { ...foodPrize("common", key, 1), consolation: true };
}

/**
 * Guess "hi", "lo" — or "red"/"black" (all-in: two rungs at once). The next card is drawn
 * from the deck and saved before it is shown.
 * Returns { from, next, dir, result: "win"|"lose"|"saved", rung, tierUp, before, after, tk } or null.
 */
export async function guess(actor, dir) {
  const tk = ticketOf(actor);
  const cost = guessCost(tk);
  if (cost === null) return null;
  if (!canAct(actor)) { ui.notifications.warn(t("Turn.NotYet")); return null; }
  keepAlive(actor);
  const hl = tk.hl;
  hl.start ??= tk.spins[0].tier;
  hl.rung ??= 0;
  if (!hl.deck?.length) hl.deck = shuffled().filter(x => x !== hl.card);
  if (cost > 0 && !(await charge(actor, tk, cost, 0))) return null;
  await loadIndex();
  const prize = tk.spins[0];
  const from = hl.card;
  const next = hl.deck.pop();
  const tieWins = setting("hlTie", "lose") === "push";
  let result;
  if (dir === "red" || dir === "black") result = isRed(next) === (dir === "red") ? "win" : "lose";
  else if (rankOf(next) === rankOf(from)) result = tieWins ? "push" : "lose";
  else result = (dir === "hi") === (rankOf(next) > rankOf(from)) ? "win" : "lose";
  let after = prize;
  let tierUp = false;
  const rungBefore = hl.rung;
  if (result === "win") {
    hl.rung = Math.min(topRung(hl.start), hl.rung + (dir === "red" || dir === "black" ? 2 : 1));
    const tier = tierAt(hl.start, hl.rung);
    if (tier !== prize.tier) { after = drawPrize(tier, tk.level, ticketBoard(tk)); tierUp = true; }
  } else if (result === "lose") {
    if (hl.safe > 0) { hl.safe -= 1; result = "saved"; }
    else { after = consolation(); tk.bust = true; }
  }
  hl.steps += 1;
  hl.card = next;
  hl.log.push({ from, next, dir, result, rung: hl.rung });
  tk.spins = [after];
  await saveTicket(actor, tk);
  return { from, next, dir, result, rung: hl.rung, rungBefore, tierUp, before: prize, after, tk };
}

/** Kept for old tickets (no consolation): the ticket goes with nothing. */
export async function leave(actor) {
  const tk = ticketOf(actor);
  if (!tk) return;
  await saveTicket(actor, null);
  leaveLine(actor);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="rpg-card miss"><p>${t("HL.BustLine", { name: esc(actor.name), n: tk.hl?.steps ?? 0 })}${tk.paid ? ` · ${t("Paid", { cost: formatCp(tk.paid) })}` : ""}</p></div>` });
}

/* ---------------- taking the prize ---------------- */

export function prizeName(p) {
  if (!p) return "";
  if (p.kind === "coins") return formatCp(p.cp);
  return p.qty > 1 ? `${p.name} ×${p.qty}` : p.name;
}

/** What the find is worth in coins instead (setting, 75%). 0 = no such offer (coins, or no price). */
export function cashValue(p) {
  if (!p || p.kind === "coins") return 0;
  return Math.max(0, Math.floor((Number(p.value) || 0) * (Number(setting("cashRate", 0.75)) || 0)));
}

/** Food from the Rutz catalog (the same items Days eats and the Shop sells). */
function foodSource(p) {
  return catalogFood(p.key, p.qty ?? 1, { [MID]: { found: { tier: p.tier } } });
}

export async function take(actor, index, { cash = false } = {}) {
  const tk = ticketOf(actor);
  const p = tk?.spins?.[index];
  if (!p) return null;
  const cashCp = cash ? cashValue(p) : 0;
  if (cash && cashCp > 0) await actor.inventory.addCoins(cpOf(cashCp));
  else if (p.kind === "coins") await actor.inventory.addCoins(cpOf(p.cp));
  else if (p.kind === "food") await actor.createEmbeddedDocuments("Item", [foodSource(p)]);
  else {
    const doc = await fromUuid(p.uuid).catch(() => null);
    if (doc) {
      const src = doc.toObject();
      delete src._id;
      src.system.quantity = p.qty ?? 1;
      src._stats = { ...(src._stats ?? {}), compendiumSource: doc.uuid };
      src.flags = { ...(src.flags ?? {}), [MID]: { found: { tier: p.tier, lost: !!p.lost } } };
      const [made] = await actor.createEmbeddedDocuments("Item", [src]);
      // Someone's lost weapon has seen better days (Rutz's PF2e Forge gives it Hit Points first).
      if (made && p.lost) setTimeout(() => {
        const hp = made.system?.hp;
        if (hp?.max > 0) made.update({ "system.hp.value": Math.max(1, Math.ceil(hp.max * 0.6)) }).catch(() => null);
      }, 600);
    }
  }
  await saveTicket(actor, null);
  leaveLine(actor);
  const stars = "★".repeat(TIER_STARS[p.tier]);
  const machine = machineOf(tk.machine);
  const others = machine === "highlow" ? 0 : tk.spins.length - 1;
  const how = machine === "highlow"
    ? (tk.bust ? t("HL.ConsolationLine", { name: esc(actor.name), n: tk.hl?.steps ?? 0, rung: tk.hl?.log?.at(-1)?.rung ?? 0 }) : t("HL.WonLine", { name: esc(actor.name), n: tk.hl?.rung ?? 0 }))
    : t("Won", { name: esc(actor.name), n: tk.spins.length });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="rpg-card won ${p.tier}" style="--c:${TIER_COLOR[p.tier]}"><header><span class="stars">${stars}</span> <b>${t(`Tier.${p.tier}`)}</b> <small class="mach">${machineName(machine)}</small></header>
      <div class="prize"><img src="${esc(p.img)}" alt=""><div><b>${esc(prizeName(p))}</b>${cashCp ? `<small>${t("CashedLine", { cost: formatCp(cashCp) })}</small>` : p.lost ? `<small>${t("Lost")}</small>` : ""}</div></div>
      <p class="dim">${how}${tk.paid ? ` · ${t("Paid", { cost: formatCp(tk.paid) })}` : ""}${others ? ` · ${t(keepMode() === "last" ? "Discarded" : "LeftBehind", { n: others })}` : ""}</p></div>`
  });
  return p;
}

function cpOf(cp) {
  return { pp: 0, gp: Math.floor(cp / 100), sp: Math.floor((cp % 100) / 10), cp: cp % 10 };
}
