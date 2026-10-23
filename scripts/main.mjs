import { MID, SOCKET, setting, t } from "./util.mjs";
import { openGacha } from "./open.mjs";
import { offer, spin, take, ticketOf, wireOffer } from "./ticket.mjs";
import { MACHINES, WEIGHT_DEFAULT, loadIndex } from "./pool.mjs";
import { TableMenu, openTables } from "./tables.mjs";
import { handle as handleTurn, onTurnChange, startKeeper, turnState } from "./turn.mjs";

/* ======================================================================== *
 * Rutz's PF2e Gacha — a roulette of finds after a night's rest.
 * After PF2e's Rest for the Night a chat card offers each resting character
 * a Survival check; a success opens the wheel. The GM can also offer one any
 * time (token controls, or game.rutzGacha.offer(actors)).
 * ======================================================================== */

function registerSettings() {
  const s = (key, data) => game.settings.register(MID, key, { config: true, scope: "world", ...data });
  s("broadcast", { name: t("Settings.Broadcast"), hint: t("Settings.BroadcastHint"), type: Boolean, default: true });
  s("afterCombat", { name: t("Settings.AfterCombat"), hint: t("Settings.AfterCombatHint"), type: Boolean, default: false });
  s("onRest", { name: t("Settings.OnRest"), hint: t("Settings.OnRestHint"), type: Boolean, default: true });
  s("machine", { name: t("Settings.Machine"), hint: t("Settings.MachineHint"), type: String, default: "choice",
    choices: { choice: t("Machine.choice"), roulette: t("Machine.roulette"), slot: t("Machine.slot"), highlow: t("Machine.highlow") } });
  s("skill", { name: t("Settings.Skill"), hint: t("Settings.SkillHint"), type: String, default: "survival" });
  s("skillSlot", { name: t("Settings.SkillSlot"), hint: t("Settings.SkillOtherHint"), type: String, default: "thievery" });
  s("skillHighLow", { name: t("Settings.SkillHighLow"), hint: t("Settings.SkillOtherHint"), type: String, default: "perception" });
  s("dcMode", { name: t("Settings.DcMode"), hint: t("Settings.DcModeHint"), type: String, default: "level", choices: { level: t("Settings.DcLevel"), fixed: t("Settings.DcFixed") } });
  s("dc", { name: t("Settings.Dc"), type: Number, default: 15 });
  s("weights", { name: t("Settings.Weights"), hint: t("Settings.WeightsHint"), type: String, default: "70,18,8,3.5,0.5" });
  s("costMode", { name: t("Settings.CostMode"), hint: t("Settings.CostModeHint"), type: String, default: "level",
    choices: { level: t("Settings.CostLevel"), fixed: t("Settings.CostFixed"), table: t("Settings.CostTable") } });
  s("rerollCost", { name: t("Settings.Cost"), hint: t("Settings.CostHint"), type: String, default: "1 sp" });
  s("costTable", { name: t("Settings.CostTableName"), hint: t("Settings.CostTableHint"), type: String, default: "1: 1 sp, 3: 3 sp, 5: 5 sp, 7: 1 gp, 9: 2 gp, 11: 4 gp, 13: 7 gp, 15: 10 gp, 17: 15 gp, 19: 25 gp",
    // Writing a table means using it: switch the cost mode over so it doesn't sit unused under "level".
    onChange: () => { if (game.user.isGM && game.settings.get(MID, "costMode") !== "table") game.settings.set(MID, "costMode", "table"); } });
  s("keepMode", { name: t("Settings.Keep"), hint: t("Settings.KeepHint"), type: String, default: "pick",
    choices: { pick: t("Settings.KeepPick"), last: t("Settings.KeepLast") } });
  s("slotRate", { name: t("Settings.SlotRate"), hint: t("Settings.SlotRateHint"), type: Number, default: 0.5, range: { min: 0, max: 3, step: 0.1 } });
  s("slotMax", { name: t("Settings.SlotMax"), hint: t("Settings.SlotMaxHint"), type: Number, default: 5, range: { min: 0, max: 15, step: 1 } });
  s("hlRungs", { name: t("Settings.HlRungs"), hint: t("Settings.HlRungsHint"), type: Number, default: 2, range: { min: 1, max: 4, step: 1 } });
  s("hlRate", { name: t("Settings.HlRate"), hint: t("Settings.HlRateHint"), type: Number, default: 0, range: { min: 0, max: 3, step: 0.1 } });
  s("hlTie", { name: t("Settings.HlTie"), hint: t("Settings.HlTieHint"), type: String, default: "lose", choices: { lose: t("Settings.HlTieLose"), push: t("Settings.HlTiePush") } });
  s("cashRate", { name: t("Settings.Cash"), hint: t("Settings.CashHint"), type: Number, default: 0.75, range: { min: 0, max: 1, step: 0.05 } });
  s("maxRerolls", { name: t("Settings.Max"), hint: t("Settings.MaxHint"), type: Number, default: 3, range: { min: 0, max: 10, step: 1 } });
  s("queue", { name: t("Settings.Queue"), hint: t("Settings.QueueHint"), type: Boolean, default: true, onChange: () => onTurnChange(openGacha) });
  s("turnTimeout", { name: t("Settings.TurnTimeout"), hint: t("Settings.TurnTimeoutHint"), type: Number, default: 90, range: { min: 20, max: 600, step: 10 } });
  game.settings.register(MID, "turn", { scope: "world", config: false, type: String, default: "{}", onChange: () => onTurnChange(openGacha) });
  game.settings.register(MID, "tables", { scope: "world", config: false, type: String, default: "{}" });
  game.settings.register(MID, "tablesForage", { scope: "world", config: false, type: String, default: "{}" });
  game.settings.register(MID, "weightsForage", { scope: "world", config: false, type: String, default: WEIGHT_DEFAULT.forage });
  game.settings.register(MID, "tablesSlot", { scope: "world", config: false, type: String, default: "{}" });
  game.settings.register(MID, "tablesHighLow", { scope: "world", config: false, type: String, default: "{}" });
  game.settings.register(MID, "weightsSlot", { scope: "world", config: false, type: String, default: WEIGHT_DEFAULT.slot });
  game.settings.register(MID, "weightsHighLow", { scope: "world", config: false, type: String, default: WEIGHT_DEFAULT.highlow });
  game.settings.registerMenu(MID, "tablesMenu", { name: t("Ed.Title"), label: t("Ed.Open"), hint: t("Ed.MenuHint"), icon: "fa-solid fa-list", type: TableMenu, restricted: true });
  game.settings.register(MID, "volume", { name: t("Settings.Volume"), scope: "client", config: true, type: Number, default: 0.5, range: { min: 0, max: 1, step: 0.1 } });
}

function party() {
  const p = game.actors.party ?? game.actors.find(a => a.type === "party");
  const members = p?.members?.filter(a => a?.type === "character") ?? [];
  return members.length ? members : game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
}

function mine() {
  return game.user.character ?? party().find(a => a.isOwner && ticketOf(a)) ?? party().find(a => a.isOwner);
}

async function toolClick() {
  if (game.user.isGM) {
    const members = party();
    const withTicket = members.filter(a => ticketOf(a));
    let chosen = [];
    let machine = null;
    let set = "forage";
    const pick = await foundry.applications.api.DialogV2.wait({ window: { title: t("Title") },
      content: `<p>${t("ToolDlg.Ask")}</p>
        <div class="rpg-who">${members.map(a => `<label><input type="checkbox" name="a-${a.id}" checked><img src="${a.prototypeToken?.texture?.src || a.img}" alt=""> ${foundry.utils.escapeHTML(a.name)}${ticketOf(a) ? ` <small>🎁</small>` : ""}</label>`).join("")}</div>
        <p class="rpg-mach"><label>${t("ToolDlg.Set")} <select name="set"><option value="forage">${t("Set.forage")}</option><option value="loot">${t("Set.loot")}</option></select></label>
          <label>${t("ToolDlg.Machine")} <select name="machine">${["choice", ...MACHINES].map(m => `<option value="${m}" ${m === setting("machine", "choice") ? "selected" : ""}>${t(`Machine.${m}`)}</option>`).join("")}</select></label></p>
        ${turnState().active ? `<p class="hint">${t("Turn.Line", { list: [turnState().active, ...turnState().queue].map(q => game.actors.get(q.actor)?.name ?? "?").join(" → ") })}</p>` : ""}
        ${withTicket.length ? `<p class="hint">${t("ToolDlg.Open", { list: withTicket.map(a => a.name).join(", ") })}</p>` : ""}`,
      buttons: [{ action: "offer", label: t("ToolDlg.Offer"), icon: "fa-solid fa-gift", default: true,
          callback: (_e, button) => { chosen = members.filter(a => button.form?.elements[`a-${a.id}`]?.checked); machine = button.form?.elements.machine?.value ?? null; set = button.form?.elements.set?.value ?? "forage"; return "offer"; } },
        { action: "tables", label: t("Ed.Open"), icon: "fa-solid fa-list" },
        ...(turnState().active ? [{ action: "clear", label: t("Turn.Clear"), icon: "fa-solid fa-broom" }] : []),
        { action: "no", label: t("Cancel") }],
      rejectClose: false }).catch(() => null);
    if (pick === "offer") {
      if (!chosen.length) return ui.notifications.warn(t("ToolDlg.NoOne"));
      return offer(chosen, machine, set);
    }
    if (pick === "tables") return openTables();
    if (pick === "clear") return handleTurn({ type: "turnClear", user: game.user.id });
    return;
  }
  const a = mine();
  if (!a) return ui.notifications.warn(t("NotYours"));
  openGacha(a);
}

/* A scene-control button: v13+ calls onChange (and still the old onClick, so giving both ran it twice). */
const toolHandler = fn => (game.release?.generation ?? 13) >= 13 ? { onChange: fn } : { onClick: fn };

function addTool(controls) {
  const tool = { name: "rpg-gacha", title: "RPG.Tool", icon: "fa-solid fa-gift", button: true, order: 95, visible: true, ...toolHandler(() => toolClick()) };
  if (Array.isArray(controls)) controls.find(c => c.name === "token")?.tools.push(tool);
  else { const tk = controls.tokens ?? controls.token; if (tk?.tools) tk.tools[tool.name] = tool; }
}

Hooks.once("init", registerSettings);
Hooks.on("getSceneControlButtons", addTool);
Hooks.on("renderChatMessageHTML", wireOffer);

// PF2e calls this for every character that rests: gather them, one card for the lot.
const resting = new Set();
let soon = null;
Hooks.on("pf2e.restForTheNight", actor => {
  if (!setting("onRest", true) || actor?.type !== "character") return;
  resting.add(actor);
  clearTimeout(soon);
  soon = setTimeout(() => { const list = [...resting]; resting.clear(); offer(list, null, "forage"); }, 700);
});

// After a fight (setting): a chance at the loot for the characters who were in it.
Hooks.on("deleteCombat", combat => {
  if (!setting("afterCombat", false) || game.users.activeGM?.id !== game.user.id || !combat?.started) return;
  const pcs = [...new Set(combat.combatants.map(c => c.actor).filter(a => a?.type === "character" && a.hasPlayerOwner))];
  if (pcs.length) setTimeout(() => offer(pcs, null, "loot"), 1200);
});

/* ---------------- everyone watches ---------------- */
// Spins from other players play here too, one after another, with whose turn it is on top.
const queue = [];
let playing = false;
let current = null; // the spin playing now (a slot's stops may still be coming in)
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function playQueue() {
  if (playing) return;
  playing = true;
  try {
    while (queue.length) {
      const d = queue.shift();
      const actor = game.actors.get(d.actor);
      if (!actor) continue;
      current = d;
      let app;
      if (d.type === "hl") app = openGacha(actor, { machine: "highlow", view: d.before, watch: true });
      else {
        // Opened with this spin (and later ones) hidden: no spoilers before the wheel stops.
        app = openGacha(actor, { pending: d.index, machine: d.machine, watch: true });
        app.waiting = [...new Set([...(app.waiting ?? []), d.index, ...queue.filter(q => q.actor === d.actor && q.type === "spin").map(q => q.index)])];
      }
      for (let i = 0; i < 50 && !(app.rendered && app.element); i++) await sleep(100);
      while (app.spinning) await sleep(150);
      if (!app.rendered) continue;
      app.bringToFront?.();
      await app.play(d);
      current = null;
      await sleep(d.type === "hl" ? 600 : 1500);
    }
  } finally { playing = false; current = null; }
}

function onSocket(d) {
  if (d?.type?.startsWith("turn")) return handleTurn(d);
  if (!d || d.user === game.user.id || !setting("broadcast", true)) return;
  if (d.type === "slotStop") {
    // The owner stopped a reel: the copy of that spin here (playing or queued) stops it at the same moment.
    const s = [current, ...queue].find(q => q && q.type === "spin" && q.actor === d.actor && q.index === d.index);
    if (s) (s.stops ??= []).push({ reel: d.reel, at: d.at });
    return;
  }
  if (d.type === "hl") {
    const open = foundry.applications.instances.get(`rpg-gacha-${d.actor}`);
    if (open?.machine === "highlow" && !open.spinning && !queue.some(q => q.actor === d.actor)) open.view = d.before;
    queue.push(d);
    playQueue();
    return;
  }
  if (d.type === "spin") {
    if (d.machine === "slot") d.stops ??= [];
    // A window already open for that character must not show the new pull yet either.
    const open = foundry.applications.instances.get(`rpg-gacha-${d.actor}`);
    if (open && open.machine === (d.machine ?? "roulette")) {
      open.waiting = [...(open.waiting ?? []), d.index];
      if (open.pending === null || open.pending === undefined || d.index < open.pending) { open.pending = d.index; if (!open.spinning) open.render(); }
    }
    queue.push(d);
    playQueue();
  }
  if (d.type === "took") {
    const app = foundry.applications.instances.get(`rpg-gacha-${d.actor}`);
    if (app) setTimeout(() => { if (!app.spinning) app.close(); }, 2500);
  }
}

Hooks.once("ready", () => {
  game.socket.on(SOCKET, onSocket);
  startKeeper();
  onTurnChange(() => null); // remember whose turn it is, without opening anything
  if (game.system.id !== "pf2e" && game.system.id !== "sf2e") return;
  game.rutzGacha = { open: openGacha, offer, spin, take, ticket: ticketOf, party, tables: openTables };
  // The equipment index is big: warm it up later, on the GM's side only, when the browser is idle
  // (whoever draws first loads it anyway) — not while everyone is logging in.
  if (game.user.isGM) {
    const warm = () => loadIndex().catch(() => null);
    setTimeout(() => (globalThis.requestIdleCallback ? requestIdleCallback(warm, { timeout: 30000 }) : warm()), 20000);
  }
  // A ticket from before (a window closed mid-way): a nudge.
  const a = !game.user.isGM && mine();
  if (a && ticketOf(a)) ui.notifications.info(t("Pending", { name: a.name }));
});
