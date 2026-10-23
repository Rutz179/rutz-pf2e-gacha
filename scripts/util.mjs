export const MID = "rutz-pf2e-gacha";
export const SOCKET = `module.${MID}`;

export function t(key, data) {
  const k = `RPG.${key}`;
  return data ? game.i18n.format(k, data) : game.i18n.localize(k);
}
export const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
export function setting(key, fallback = null) {
  try { return game.settings.get(MID, key); } catch (_) { return fallback; }
}

export function cpToCoins(cp) {
  cp = Math.max(0, Math.round(Number(cp) || 0));
  return { gp: Math.floor(cp / 100), sp: Math.floor((cp % 100) / 10), cp: cp % 10 };
}
export function formatCp(cp) {
  const c = cpToCoins(cp);
  return [c.gp ? `${c.gp} gp` : "", c.sp ? `${c.sp} sp` : "", c.cp ? `${c.cp} cp` : ""].filter(Boolean).join(" ") || "0 cp";
}
export function walletCp(actor) {
  const c = actor?.inventory?.coins ?? {};
  if (typeof c.copperValue === "number") return c.copperValue;
  return (c.pp ?? 0) * 1000 + (c.gp ?? 0) * 100 + (c.sp ?? 0) * 10 + (c.cp ?? 0);
}
export async function pay(actor, cp) {
  if (cp <= 0) return true;
  if (walletCp(actor) < cp) return false;
  try { return (await actor.inventory.removeCoins(cpToCoins(cp), { byValue: true })) !== false; } catch (_) { return false; }
}

/* PF2e level-based DCs (GM Core). */
const LEVEL_DC = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
export function levelDC(level) {
  return LEVEL_DC[Math.max(0, Math.min(25, Number(level) || 0))];
}

export function sluggify(s) {
  const f = game.pf2e?.system?.sluggify;
  if (f) return f(String(s ?? ""));
  return String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function playSound(src, volume = 0.6) {
  try {
    const AH = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    AH?.play?.({ src, volume, loop: false }, false);
  } catch (_) { /* no sound is fine */ }
}

/**
 * "1 sp", "2gp 5sp", "1.5 gp", "50" (a bare number is copper) → copper. Korean units too (금화/은화/동화).
 * Returns NaN when nothing could be read.
 */
export function parseCoins(text) {
  if (typeof text === "number") return Math.round(text);
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return NaN;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const RATE = { pp: 1000, gp: 100, sp: 10, cp: 1, 백금화: 1000, 금화: 100, 은화: 10, 동화: 1, 백금: 1000, 금: 100, 은: 10, 동: 1 };
  let total = 0;
  let found = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(pp|gp|sp|cp|백금화|금화|은화|동화|백금|금|은|동)/g)) {
    total += Number(m[1]) * RATE[m[2]];
    found = true;
  }
  return found ? Math.round(total) : NaN;
}
