import { machineOf } from "./pool.mjs";
import { ticketOf } from "./ticket.mjs";
import { GachaApp } from "./app.mjs";
import { SlotApp } from "./slot.mjs";
import { HighLowApp } from "./highlow.mjs";
import { joinLine } from "./turn.mjs";

const KIND = { roulette: GachaApp, slot: SlotApp, highlow: HighLowApp };

/**
 * Open the machine of this character's ticket (the roulette when there is none).
 * pending: a spin index still to be played here (hidden until then); view: High & Low's table before a step.
 */
export function openGacha(actor, { pending = null, machine = null, view = null, watch = false } = {}) {
  if (!actor) return null;
  const tk = ticketOf(actor);
  const m = machineOf(machine ?? tk?.machine);
  // Opened to play (not to watch someone): get in line.
  if (!watch && tk && actor.isOwner) joinLine(actor, m);
  const id = `rpg-gacha-${actor.id}`;
  const open = foundry.applications.instances.get(id);
  if (open && open.machine === m) {
    if (!watch) open.watch = false;
    if (pending !== null) { open.pending = pending; open.reveal = null; }
    if (view && !open.spinning) open.view = view;
    open.render(true);
    return open;
  }
  // Another machine's window for this character: make way.
  if (open) { open.spinning = false; open._keepTurn = true; open.close({ animate: false }); }
  const app = new KIND[m](actor);
  app.watch = watch;
  app.pending = pending;
  if (view) app.view = view;
  app.render(true);
  return app;
}
