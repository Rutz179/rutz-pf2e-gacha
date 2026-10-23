import { MID, SOCKET, setting, t } from "./util.mjs";

/* ======================================================================== *
 * Taking turns: one character at the machines at a time.
 * Opening your window with a chance in hand puts you in line; the one at
 * the front plays, everyone else's window says whose turn it is and where
 * they stand. Done (took the find, left empty-handed, or closed the window)
 * — the next in line is told and their window comes up.
 * The active GM keeps the line (world setting "turn", so every client sees
 * it and it survives a reload). A turn idle too long (setting, 90 s) or a
 * player who went offline moves on; the chance itself is never lost.
 * With no GM online there is no line.
 * ======================================================================== */

const EMPTY = { active: null, queue: [] };

export function turnState() {
  try { return { ...EMPTY, ...JSON.parse(setting("turn", "{}") || "{}") }; } catch (_) { return { ...EMPTY }; }
}

export const turnsOn = () => !!setting("queue", true) && !!game.users?.activeGM;
const isKeeper = () => game.users.activeGM?.id === game.user.id;

/** May this character play now? */
export function canAct(actor) {
  if (!turnsOn()) return true;
  return turnState().active?.actor === actor?.id;
}

/** "mine" | { wait: n (1 = next), now: actorId } | "out" (not in line) | "off" */
export function standing(actor) {
  if (!turnsOn()) return "off";
  const s = turnState();
  if (s.active?.actor === actor.id) return "mine";
  const i = s.queue.findIndex(q => q.actor === actor.id);
  if (i >= 0) return { wait: i + 1, now: s.active?.actor ?? null, machine: s.active?.machine ?? null };
  return "out";
}

function send(type, actor, extra = {}) {
  const msg = { type, actor: actor?.id ?? actor, user: game.user.id, ...extra };
  if (isKeeper()) return handle(msg);
  game.socket.emit(SOCKET, msg);
}

export function joinLine(actor, machine) {
  if (!turnsOn() || !actor) return;
  const s = turnState();
  if (s.active?.actor === actor.id || s.queue.some(q => q.actor === actor.id)) return;
  send("turnReq", actor, { machine });
}
export const leaveLine = actor => { if (turnsOn() && actor) send("turnDone", actor); };
export const keepAlive = actor => { if (turnsOn() && actor) send("turnPing", actor); };

/* ---------------- the keeper (active GM) ---------------- */

let saving = Promise.resolve();
async function save(fn) {
  saving = saving.then(async () => {
    const s = turnState();
    if (fn(s) === false) return;
    await game.settings.set(MID, "turn", JSON.stringify(s));
  }).catch(err => console.warn(`${MID} | turn`, err));
  return saving;
}

function advance(s) {
  const next = s.queue.shift() ?? null;
  s.active = next ? { ...next, at: Date.now() } : null;
}

export function handle(msg) {
  if (!isKeeper() || !msg?.type?.startsWith("turn")) return;
  return save(s => {
    const now = Date.now();
    if (msg.type === "turnReq") {
      if (s.active?.actor === msg.actor || s.queue.some(q => q.actor === msg.actor)) return false;
      const row = { actor: msg.actor, user: msg.user, machine: msg.machine ?? null };
      if (!s.active) s.active = { ...row, at: now };
      else s.queue.push(row);
    } else if (msg.type === "turnDone") {
      if (s.active?.actor === msg.actor) advance(s);
      else if (s.queue.some(q => q.actor === msg.actor)) s.queue = s.queue.filter(q => q.actor !== msg.actor);
      else return false;
    } else if (msg.type === "turnPing") {
      if (s.active?.actor !== msg.actor) return false;
      s.active.at = now;
    } else if (msg.type === "turnClear") {
      s.active = null; s.queue = [];
    }
  });
}

/** The keeper moves a stuck line on: idle too long, or the player went offline. */
export function startKeeper() {
  setInterval(() => {
    if (!isKeeper() || !turnsOn()) return;
    const s = turnState();
    if (!s.active) return;
    const idle = Date.now() - (s.active.at ?? 0) > Math.max(20, Number(setting("turnTimeout", 90)) || 90) * 1000;
    const gone = !game.users.get(s.active.user)?.active;
    if (idle || gone) save(x => { if (x.active?.actor !== s.active.actor) return false; advance(x); });
    // Waiting players who went offline drop out of line too.
    if (s.queue.some(q => !game.users.get(q.user)?.active)) save(x => { x.queue = x.queue.filter(q => game.users.get(q.user)?.active); });
  }, 5000);
}

/** Every client: the line changed — redraw the windows, and tell whoever's turn it is now. */
let lastActive = null;
export function onTurnChange(open) {
  const s = turnState();
  for (const app of foundry.applications.instances.values()) if (app.id?.startsWith("rpg-gacha-") && !app.spinning) app.render();
  const a = s.active?.actor ?? null;
  if (a && a !== lastActive && s.active.user === game.user.id) {
    const actor = game.actors.get(a);
    if (actor) {
      ui.notifications.info(t("Turn.YourTurn", { name: actor.name }));
      const app = open(actor);
      setTimeout(() => app?.bringToFront?.(), 300);
    }
  }
  lastActive = a;
}
