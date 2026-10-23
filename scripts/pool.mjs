import { MID, setting, sluggify } from "./util.mjs";
import { FOOD_CATALOG, foodName } from "./foods.mjs";

/* ======================================================================== *
 * What a spin can give. Five tiers, drawn from PF2e's equipment compendium
 * (the PF2e-KR copy when there is one) and the Rutz food catalog.
 * 야영 식량 찾기 (forage, after a night's rest):
 *   common     food (some cheap, a few drinks), camp gear (rations, torches …), a few coins
 *   uncommon   fine food, or a low healing potion
 *   rare       a healing potion up to the character's level, or a feast / fine drink
 *   epic       two of the best healing potions, or a potion / talisman
 *   legendary  a permanent magic item, or a purse of gold
 * 전투 전리품 (loot, after a fight):
 *   common     gear, supplies that fit the level, coins (food only about 15%)
 *   uncommon   alchemical consumables up to the character's level
 *   rare       potions and talismans up to the character's level
 *   epic       a rune, or someone's lost weapon/armor (a little worse for wear)
 *   legendary  a permanent magic item a level or two above, or a purse of gold
 * Tier odds are the GM's (per board: forage, and each machine's loot).
 * ======================================================================== */

export const TIERS = ["common", "uncommon", "rare", "epic", "legendary"];
export const TIER_COLOR = { common: "#a3a9b0", uncommon: "#5fcf72", rare: "#4f9dff", epic: "#bf6bff", legendary: "#ffbf2e" };
export const TIER_STARS = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

// What a camp turns up besides food.
const CAMP = new Set(["rations", "waterskin", "torch", "candle", "oil-1-pint", "flint-and-steel", "rope", "feed-standard", "soap"]);
// Exploration gear from the compendium: slug → how many come in the find.
const EXPLORE = {
  rations: 2, torch: 3, rope: 1, chalk: 5, candle: 3, "flint-and-steel": 1, soap: 1, waterskin: 1, "oil-1-pint": 2,
  bedroll: 1, "feed-standard": 2, sack: 1, piton: 3, "fishing-tackle": 1, "grappling-hook": 1, "signal-whistle": 1,
  "lantern-hooded": 1, caltrops: 1, "climbing-kit": 1, "healers-toolkit": 1, mirror: 1, cookware: 1, "tent-pup": 1,
  "compass": 1, "crowbar": 1, "hammer": 1, "snare-kit": 1, "writing-set": 1, "manacles-simple": 1, "spyglass": 1
};

/*
 * Food: the Rutz food catalog (foods.mjs — the same items Days eats and the Shop sells).
 * How many meals a find holds goes by quality.
 */
const FIND_QTY = { poor: 3, plain: 2, fine: 1, luxury: 1 };
export const FOODS = Object.fromEntries(Object.entries(FOOD_CATALOG).map(([k, f]) => [k, { cp: f.cp, img: f.img, food: f.kind === "food", kind: f.kind, quality: f.quality, qty: f.kind === "drink" ? 1 : FIND_QTY[f.quality] ?? 1 }]));
const foodsBy = (...q) => Object.keys(FOODS).filter(k => q.includes(FOODS[k].quality) && k !== "keg");
export function foodPrize(tier, key, qty = null) {
  const f = FOODS[key];
  if (!f) return null;
  const n = Math.max(1, Number(qty) || f.qty);
  return { tier, kind: "food", key, name: foodName(key), img: f.img, qty: n, value: f.cp * n };
}

/*
 * Two sets of tables:
 *   forage  야영 후 식량 찾기 — nearly all food and healing potions; treasure is rare.
 *           One set for every machine.
 *   loot    전투 후 전리품 — gear, coins, alchemy, magic; little food. Each machine its own.
 * A "board" is what the odds and tables belong to: "forage", or a machine (= loot on it).
 */
export const SETS = ["forage", "loot"];
export const setOf = s => (s === "forage" ? "forage" : "loot");
export const BOARDS = ["forage", "roulette", "slot", "highlow"];

/* The machines: each has its own tier odds and its own item tables (for loot). */
export const MACHINES = ["roulette", "slot", "highlow"];
export const WEIGHT_KEY = { roulette: "weights", slot: "weightsSlot", highlow: "weightsHighLow", forage: "weightsForage" };
export const WEIGHT_DEFAULT = { roulette: "70,18,8,3.5,0.5", slot: "76,12,7,4,1", highlow: "82,12,4.5,1.3,0.2", forage: "78,15,5.5,1.3,0.2" };
const TABLE_KEY = { roulette: "tables", slot: "tablesSlot", highlow: "tablesHighLow", forage: "tablesForage" };
export const machineOf = m => (MACHINES.includes(m) ? m : "roulette");
export const boardOf = (machine, set) => (setOf(set) === "forage" ? "forage" : machineOf(machine));
const boardKey = b => (b === "forage" ? "forage" : machineOf(b));

export function weightsRaw(board = "roulette") {
  const m = boardKey(board);
  return String(setting(WEIGHT_KEY[m], WEIGHT_DEFAULT[m]) || WEIGHT_DEFAULT[m]);
}

export function weights(board = "roulette") {
  const raw = weightsRaw(board).split(/[,\s]+/).map(Number);
  const w = {};
  TIERS.forEach((k, i) => { w[k] = Math.max(0, Number.isFinite(raw[i]) ? raw[i] : 0); });
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  for (const k of TIERS) w[k] = w[k] / sum;
  return w;
}

/* ---------------- the GM's own tables ---------------- */

/*
 * setting "tables": { <tier>: { on: bool, cap: number|null, entries: [entry] } }
 *   entry: { type: "item", uuid, name, img, level, itemType, price, qty, weight }
 *        | { type: "food", key, qty, weight } | { type: "coins", cp, weight }
 *   cap: only items up to the character's level + cap (null = any level)
 * A tier that is "on" with entries uses them; otherwise the built-in rules below.
 */
export function tables(board = "roulette") {
  let raw = {};
  try { raw = JSON.parse(setting(TABLE_KEY[boardKey(board)], "{}") || "{}") ?? {}; } catch (_) { raw = {}; }
  const out = {};
  for (const k of TIERS) out[k] = { on: false, cap: null, entries: [], ...(raw[k] ?? {}) };
  return out;
}

export async function saveTables(tb, board = "roulette") {
  await game.settings.set(MID, TABLE_KEY[boardKey(board)], JSON.stringify(tb));
}

function weighted(list) {
  const sum = list.reduce((n, e) => n + Math.max(0, Number(e.weight) || 0), 0);
  if (sum <= 0) return list[Math.floor(Math.random() * list.length)];
  let r = Math.random() * sum;
  for (const e of list) { r -= Math.max(0, Number(e.weight) || 0); if (r < 0) return e; }
  return list.at(-1);
}

function fromTable(tier, level, board) {
  const tb = tables(board)[tier];
  if (!tb?.on || !tb.entries?.length) return null;
  const cap = tb.cap === null || tb.cap === "" || tb.cap === undefined ? null : Number(level) + Number(tb.cap);
  const fits = tb.entries.filter(e => e.type !== "item" || cap === null || (Number(e.level) || 0) <= cap);
  const e = weighted(fits.length ? fits : tb.entries);
  if (!e) return null;
  if (e.type === "coins") return coinPrize(tier, scaledCp(e, level));
  if (e.type === "food") return foodPrize(tier, e.key, e.qty);
  const qty = Math.max(1, Number(e.qty) || 1);
  return { tier, kind: "item", uuid: e.uuid, name: e.name, img: e.img, qty, value: Math.round((Number(e.price) || 0) * qty), lost: tier === "epic" && ["weapon", "armor", "shield"].includes(e.itemType) };
}

/* A permanent item's price by level (gp, PF2e GM Core): what coins are worth at each level. */
const ITEM_GP = [10, 20, 35, 60, 100, 160, 250, 360, 500, 700, 1000, 1400, 2000, 3000, 4500, 6500, 10000, 15000, 24000, 40000, 70000];
/** Copper a level's worth of money comes to (level 0–20; above 20 keeps climbing ×1.6). */
export function levelCp(level) {
  const L = Math.max(0, Math.round(Number(level) || 0));
  const gp = L <= 20 ? ITEM_GP[L] : ITEM_GP[20] * 1.6 ** (L - 20);
  return Math.round(gp * 100);
}
/** A table's coin entry: written for one level ("level"), it grows or shrinks with the character's. */
export function scaledCp(e, level) {
  const cp = Number(e.cp) || 1;
  if (e.level === undefined || e.level === null || e.level === "") return cp;
  return Math.max(1, Math.round(cp * levelCp(level) / levelCp(e.level)));
}

/** How much of the common tier is still food and plain gear (the rest are supplies): 100% to level 4, 20% from level 12. */
export function commonShare(L) {
  return L <= 4 ? 0.88 : Math.max(0.18, 0.88 - (L - 4) * 0.09);
}
/** A few coins in the common tier: 20–70 cp at level 1, about 3–8% of an item four levels below later on. */
function commonCoins(L) {
  if (L <= 4) return (2 + Math.floor(Math.random() * 6)) * 10 * Math.max(1, L - 1);
  return Math.round(levelCp(L - 4) * (0.03 + Math.random() * 0.05));
}
function supplyPrize(tier, e) {
  const qty = e.category === "ammo" ? 5 : 1;
  return { tier, kind: "item", uuid: e.uuid, name: e.name, img: e.img, qty, value: Math.round((e.price || 0) * qty) };
}

function coinPrize(tier, cp) {
  return { tier, kind: "coins", cp, name: null, img: cp >= 100 ? "systems/pf2e/icons/equipment/treasure/currency/gold-pieces.webp" : "systems/pf2e/icons/equipment/treasure/currency/silver-pieces.webp", qty: 1, value: 0 };
}

/** The built-in rules as table entries, for the GM to start from (a character of this level). */
export async function rulesAsEntries(tier, level, board = "roulette") {
  await loadIndex();
  const L = Math.max(1, Number(level) || 1);
  const item = (e, qty = 1, weight = 1) => ({ type: "item", uuid: e.uuid, name: e.name, img: e.img, level: e.level, itemType: e.type, price: e.price, qty, weight });
  const food = (key, weight = 1) => ({ type: "food", key, qty: FOODS[key].qty, weight });
  if (board === "forage") {
    // Food (and drink) first; healing potions; treasure only at the top.
    const heal = near(poolOf("healing", L), L);
    if (tier === "common") return [...foodsBy("poor", "plain").map(k => food(k, FOODS[k].kind === "food" ? 3 : 1)),
      ...poolOf("camp", L).map(e => item(e, EXPLORE[e.slug] ?? 1, 1)), { type: "coins", cp: 20 * Math.max(1, L - 1), weight: 1 }];
    if (tier === "uncommon") return [...foodsBy("fine").map(k => food(k, 2)), ...heal.filter(e => e.level <= Math.max(1, Math.ceil(L / 2))).map(e => item(e, 1, 2))];
    if (tier === "rare") return [...heal.map(e => item(e, 1, 3)), ...foodsBy("luxury").map(k => food(k, 2))];
    if (tier === "epic") return [...near(poolOf("healing", L + 1), L + 1).map(e => item(e, 2, 3)), ...poolOf("rare", L).map(e => item(e, 1, 1))];
    return [...poolOf("legendary", L).map(e => item(e)), { type: "coins", cp: Math.round(levelCp(Math.min(L + 1, 20)) * 0.6), level: L, weight: 3 }];
  }
  const items = poolOf(tier, L).map(e => item(e, tier === "common" ? (EXPLORE[e.slug] ?? 1) : 1));
  if (tier === "common") {
    const sup = L > 4 ? poolOf("supplies", L).map(e => item(e, e.category === "ammo" ? 5 : 1)) : [];
    // Loot: food is a small part (about 15%), coins 15%, the rest gear and supplies.
    const foods = foodsBy("plain").filter(k => FOODS[k].kind === "food").map(k => food(k));
    const gearW = items.length + sup.length || 1;
    const foodW = Math.max(0.1, Math.round((0.15 / 0.7) * gearW / Math.max(1, foods.length) * 10) / 10);
    foods.forEach(f => (f.weight = foodW));
    const coinW = Math.max(1, Math.round(gearW * 0.2));
    const coinCp = L <= 4 ? 40 * Math.max(1, L - 1) : Math.round(levelCp(L - 4) * 0.05);
    return [...foods, ...items, ...sup, { type: "coins", cp: coinCp, ...(L > 4 ? { level: L } : {}), weight: coinW }];
  }
  if (tier === "legendary") return [...items, { type: "coins", cp: Math.round(levelCp(Math.min(L + 1, 20)) * 0.6), level: L, weight: Math.max(1, Math.round(items.length / 2)) }];
  return items;
}

/** Low-level leftovers drop out as the character grows (up to 6 levels below), unless nothing would be left. */
function near(list, L, below = 6) {
  const f = list.filter(e => e.level >= L - below);
  return f.length ? f : list;
}

export function pickTier(w = weights(), r = Math.random()) {
  let acc = 0;
  for (const k of TIERS) { acc += w[k]; if (r < acc) return k; }
  return "common";
}

/* ---------------- the compendium ---------------- */

let INDEX = null;
const FIELDS = ["system.price", "system.level.value", "system.traits", "system.category", "system.usage.value", "system.slug", "system.price", "flags.PF2e-KR.originalName", "flags.babele.originalName"];

function equipmentPack() {
  const packs = game.packs.filter(p => p.documentName === "Item" && p.metadata?.name === "equipment-srd");
  return packs.find(p => (p.metadata.packageName ?? p.metadata.package) !== "pf2e") ?? packs[0] ?? null;
}

export async function loadIndex() {
  if (INDEX) return INDEX;
  const pack = equipmentPack();
  if (!pack) return (INDEX = []);
  const idx = await pack.getIndex({ fields: FIELDS });
  INDEX = [...idx].map(e => {
    const s = e.system ?? {};
    const english = e.flags?.["PF2e-KR"]?.originalName ?? e.flags?.babele?.originalName ?? e.name;
    return {
      uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, name: e.name, img: e.img, type: e.type,
      slug: s.slug || sluggify(english), level: Number(s.level?.value ?? 0) || 0,
      traits: s.traits?.value ?? [], rarity: s.traits?.rarity ?? "common", category: s.category ?? "", usage: s.usage?.value ?? "",
      price: priceCp(s.price)
    };
  });
  return INDEX;
}

/** Copper per one item (price ÷ per). */
export function priceCp(price) {
  const v = price?.value ?? {};
  const cp = (v.pp ?? 0) * 1000 + (v.gp ?? 0) * 100 + (v.sp ?? 0) * 10 + (v.cp ?? 0);
  return cp / Math.max(1, Number(price?.per) || 1);
}

const pick = list => list[Math.floor(Math.random() * list.length)];

/** Candidates of a tier for a character of this level. */
export function poolOf(tier, level, idx = INDEX ?? []) {
  const L = Math.max(0, Number(level) || 0);
  const common = e => e.rarity === "common";
  switch (tier) {
    case "common": return idx.filter(e => EXPLORE[e.slug] && common(e));
    // What a camp turns up besides food: rations, water, light, rope.
    case "camp": return idx.filter(e => CAMP.has(e.slug) && common(e));
    // Healing potions and elixirs of life up to the character's level.
    case "healing": return idx.filter(e => e.type === "consumable" && common(e) && /^(healing-potion|elixir-of-life)/.test(e.slug) && e.level <= Math.max(1, L));
    // Road supplies for a higher-level party: ammunition, oils, gadgets, snares … a few levels below theirs.
    case "supplies": return idx.filter(e => e.type === "consumable" && common(e) && !e.traits.includes("alchemical")
      && !["potion", "talisman", "scroll", "wand", "toolkit"].includes(e.category) && e.level >= Math.max(1, L - 7) && e.level <= Math.max(1, L - 2));
    case "uncommon": return near(idx.filter(e => e.type === "consumable" && e.traits.includes("alchemical") && e.level <= Math.max(1, L) && common(e)), L);
    case "rare": return near(idx.filter(e => e.type === "consumable" && ["potion", "talisman"].includes(e.category) && e.level <= Math.max(1, L) && common(e)), L);
    case "epic": return idx.filter(e => e.level >= 1 && e.level <= L + 1 && e.rarity !== "unique" && e.rarity !== "rare"
      && ((e.type === "equipment" && e.usage.startsWith("etched-onto")) || (["weapon", "armor", "shield"].includes(e.type) && e.traits.includes("magical"))));
    case "legendary": return idx.filter(e => ["equipment", "weapon", "armor", "shield"].includes(e.type) && e.traits.includes("magical")
      && e.level >= Math.max(1, Math.min(L + 1, 20)) && e.level <= L + 2 && e.rarity !== "unique" && e.rarity !== "rare");
  }
  return [];
}

/** One prize of a tier: { tier, kind: "item" | "food" | "coins", uuid, key, name, img, qty, cp, value, lost }. */
export function drawPrize(tier, level, board = "roulette") {
  const L = Math.max(1, Number(level) || 1);
  const own = fromTable(tier, L, board);
  if (own) return own;
  return board === "forage" ? drawForage(tier, L) : drawLoot(tier, L);
}

const coinsOf = (tier, cp) => coinPrize(tier, Math.max(1, Math.round(cp)));
const itemOf = (tier, e, qty = 1) => ({ tier, kind: "item", uuid: e.uuid, name: e.name, img: e.img, qty, value: Math.round((e.price || 0) * qty), lost: tier === "epic" && ["weapon", "armor", "shield"].includes(e.type) });
const fallback = (tier, L) => coinsOf(tier, Math.max(30, levelCp(L) * ({ common: 0, uncommon: 0.05, rare: 0.15, epic: 0.35, legendary: 0.6 }[tier] ?? 0)));

/* 야영 후 식량 찾기: nearly all food and healing. */
function drawForage(tier, L) {
  const roll = Math.random();
  const heal = near(poolOf("healing", L), L);
  if (tier === "common") {
    if (roll < 0.72) {
      // Mostly plain food; now and then cheap stuff (a gamble on the stomach) or a drink.
      const r = Math.random();
      const key = pick(r < 0.25 ? foodsBy("poor") : r < 0.9 ? foodsBy("plain").filter(k => FOODS[k].kind === "food") : foodsBy("plain").filter(k => FOODS[k].kind === "drink"));
      return foodPrize(tier, key);
    }
    if (roll < 0.94) { const camp = poolOf("camp", L); if (camp.length) { const e = pick(camp); return itemOf(tier, e, EXPLORE[e.slug] ?? 1); } }
    return coinsOf(tier, 20 * Math.max(1, L - 1) * (0.5 + Math.random()));
  }
  if (tier === "uncommon") {
    const low = heal.filter(e => e.level <= Math.max(1, Math.ceil(L / 2)));
    if (roll < 0.5 || !low.length) return foodPrize(tier, pick(foodsBy("fine")));
    return itemOf(tier, pick(low));
  }
  if (tier === "rare") {
    if (roll < 0.65 && heal.length) return itemOf(tier, pick(heal));
    return foodPrize(tier, pick(foodsBy("luxury")));
  }
  if (tier === "epic") {
    const best = near(poolOf("healing", L + 1), L + 1);
    if (roll < 0.7 && best.length) return itemOf(tier, pick(best), 2);
    const rare = poolOf("rare", L);
    return rare.length ? itemOf(tier, pick(rare)) : fallback(tier, L);
  }
  if (roll < 0.5) return coinsOf(tier, levelCp(Math.min(L + 1, 20)) * (0.4 + Math.random() * 0.4));
  const top = poolOf("legendary", L);
  return top.length ? itemOf(tier, pick(top)) : fallback(tier, L);
}

/* 전투 후 전리품: gear, coins, alchemy, magic — food is a small part. */
function drawLoot(tier, L) {
  const roll = Math.random();
  if (tier === "common") {
    if (roll < 0.15) return foodPrize(tier, pick(foodsBy("plain").filter(k => FOODS[k].kind === "food")));
    if (roll > 0.85) return coinsOf(tier, commonCoins(L));
    // From level 5 the plain gear gives way to supplies that fit the level.
    if (Math.random() >= commonShare(L)) {
      const sup = poolOf("supplies", L);
      if (sup.length) return supplyPrize(tier, pick(sup));
    }
  }
  if (tier === "uncommon" && roll < 0.05) return foodPrize(tier, pick(foodsBy("fine")));
  // A purse of gold: 40–80% of what an item a level above costs (level 20: about 28,000–56,000 gp).
  if (tier === "legendary" && roll < 0.35) return coinsOf(tier, levelCp(Math.min(L + 1, 20)) * (0.4 + Math.random() * 0.4));
  const list = poolOf(tier, L);
  if (!list.length) return fallback(tier, L);
  const e = pick(list);
  return itemOf(tier, e, tier === "common" ? (EXPLORE[e.slug] ?? 1) : 1);
}

export const FLAG = MID;
