import { SOCKET, setting, t } from "./util.mjs";
import { TIERS, TIER_COLOR } from "./pool.mjs";
import { GachaApp, chime, tone } from "./app.mjs";
import { oddsText, spin, ticketOf } from "./ticket.mjs";

/* ======================================================================== *
 * 777 슬롯 — stop the reels yourself.
 *   ┌──────────────────────┐
 *   │  [7]   [7]   [◆]     │ ← the pay line is the middle row
 *   └──────────────────────┘
 *    [STOP] [STOP] [STOP]      [레버]
 * Three of a symbol: 7 legendary, ◆ epic, ★ rare, 🔔 uncommon; anything
 * else is common (a consolation find). As in a real pachislot the result is
 * drawn when the lever goes down; pressing STOP stops the reel, which then
 * slides up to four symbols to land on it ("slip"). Every symbol comes round
 * once in five, so it always can. Two alike with the last reel turning:
 * "리치!" — the last reel slows and flashes.
 * The reels stop by themselves if nobody presses (7 s).
 * Watchers see the same stops at the same moments (socket "slotStop").
 * ======================================================================== */

export const SYMBOL = { legendary: "seven", epic: "gem", rare: "star", uncommon: "bell", common: "lemon" };
const SYMBOLS = ["seven", "gem", "star", "bell", "lemon"];
// Each reel repeats a five-symbol order (a different order on each reel).
const ORDER = [
  ["seven", "lemon", "bell", "star", "gem"],
  ["gem", "bell", "seven", "lemon", "star"],
  ["star", "seven", "lemon", "gem", "bell"]
];
const LOOP = 20;       // cells before the strip repeats
const H = 64;          // cell height (px), as in the stylesheet
const SPEED = 15;      // cells a second at full spin
const AUTO_STOP = 7000;

const tierOf = sym => Object.keys(SYMBOL).find(k => SYMBOL[k] === sym) ?? "common";

export function symbolHtml(sym) {
  const c = TIER_COLOR[tierOf(sym)];
  if (sym === "seven") return `<b class="sym seven" style="--c:${c}">7</b>`;
  const icon = { gem: "fa-gem", star: "fa-star", bell: "fa-bell", lemon: "fa-lemon" }[sym];
  return `<i class="sym fa-solid ${icon}" style="--c:${c}"></i>`;
}

/** Where the reels land for this prize: three alike, or (common) anything but. */
export function targetsFor(tier) {
  if (tier !== "common") return [SYMBOL[tier], SYMBOL[tier], SYMBOL[tier]];
  // Now and then a near miss: two high symbols and a third that isn't.
  if (Math.random() < 0.3) {
    const hi = ["seven", "gem", "star"][Math.floor(Math.random() * 3)];
    const odd = Math.floor(Math.random() * 3);
    const others = SYMBOLS.filter(s => s !== hi);
    return [0, 1, 2].map(i => (i === odd ? others[Math.floor(Math.random() * others.length)] : hi));
  }
  let out;
  do out = [0, 1, 2].map(() => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
  while (out[0] === out[1] && out[1] === out[2]);
  return out;
}

const symAt = (reel, cell) => ORDER[reel][((cell % 5) + 5) % 5];
const ease = x => { const c = 1.4; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; }; // a small overshoot

export class SlotApp extends GachaApp {
  static MACHINE = "slot";

  constructor(actor) {
    super(actor);
    // Each reel's top cell (fractional while it turns). Middle row = p + 1.
    this.reelP = [Math.floor(Math.random() * LOOP), Math.floor(Math.random() * LOOP), Math.floor(Math.random() * LOOP)];
  }

  get spinWord() { return "Slot.Pull"; }
  get hintWord() { return "Slot.Hint"; }

  leftHtml(tk, own, cost) {
    const odds = oddsText(this.board);
    const reels = [0, 1, 2].map(r => {
      const cells = Array.from({ length: LOOP + 3 }, (_, i) => `<div class="cell">${symbolHtml(symAt(r, i))}</div>`).join("");
      return `<div class="reel" data-r="${r}"><div class="strip">${cells}</div></div>`;
    }).join("");
    const can = own && cost !== null;
    const pays = TIERS.slice().reverse().map(k => k === "common"
      ? `<li style="--c:${TIER_COLOR[k]}"><span class="trio dim">${t("Slot.Other")}</span><span>${t(`Tier.${k}`)}</span><b>${odds[k]}</b></li>`
      : `<li style="--c:${TIER_COLOR[k]}"><span class="trio">${symbolHtml(SYMBOL[k]).repeat(3)}</span><span>${t(`Tier.${k}`)}</span><b>${odds[k]}</b></li>`).join("");
    return `${this.whoHtml(own)}
      <div class="cabinet">
        <div class="marquee"><span>7</span><span>7</span><span>7</span></div>
        <div class="glass"><div class="reels">${reels}</div><div class="payline"></div><div class="reach">${t("Slot.Reach")}</div></div>
        <div class="stops">${[0, 1, 2].map(r => `<button type="button" class="stop" data-a="stop" data-r="${r}" disabled>STOP</button>`).join("")}</div>
        <button type="button" class="lever" data-a="spin" ${can ? "" : "disabled"}><i class="fa-solid fa-play"></i> ${t("Slot.Lever")}</button>
      </div>
      <ul class="pays">${pays}</ul>`;
  }

  _replaceHTML(result, content) {
    super._replaceHTML(result, content);
    this.paint();
  }

  paint() {
    this.element?.querySelectorAll(".reel").forEach(el => {
      const r = Number(el.dataset.r);
      const p = ((this.reelP[r] % LOOP) + LOOP) % LOOP;
      const strip = el.querySelector(".strip");
      if (strip) strip.style.transform = `translateY(${(-p * H).toFixed(1)}px)`;
    });
  }

  async onClick(ev) {
    const el = ev.target.closest("[data-a='stop'], .reel");
    if (el && this.run?.owner) {
      ev.preventDefault();
      const r = Number(el.dataset.r);
      this.requestStop(r);
      return;
    }
    return super.onClick(ev);
  }

  /** The owner stops reel r (or the next one still turning) and tells the watchers when. */
  requestStop(r) {
    const run = this.run;
    if (!run) return;
    if (!Number.isFinite(r) || run.reels[r].state !== "spin") r = run.reels.findIndex(x => x.state === "spin");
    if (r < 0 || run.reels[r].state !== "spin") return;
    const at = performance.now() - run.t0;
    run.stops.push({ reel: r, at });
    if (setting("broadcast", true)) game.socket.emit(SOCKET, { type: "slotStop", actor: this.actor.id, index: run.index, reel: r, at, user: game.user.id });
  }

  async spinIt() {
    this.spinning = true;
    this.element.querySelectorAll(".window-content button").forEach(b => { b.disabled = true; });
    const prize = await spin(this.actor);
    if (!prize) { this.spinning = false; return this.render(); }
    const index = ticketOf(this.actor).spins.length - 1;
    const targets = targetsFor(prize.tier);
    const d = { type: "spin", machine: "slot", actor: this.actor.id, prize, index, targets, stops: [], user: game.user.id };
    if (setting("broadcast", true)) game.socket.emit(SOCKET, { ...d, stops: undefined });
    await this.reelsGo(d, true);
  }

  async play(d) {
    d.stops ??= [];
    return this.reelsGo(d, false);
  }

  /** Spin the reels until each is stopped (by the owner, the owner's recorded stops, or the clock). */
  async reelsGo(d, owner) {
    const root = this.element;
    if (!root) return;
    this.spinning = true;
    root.querySelectorAll(".window-content button").forEach(b => { b.disabled = true; });
    root.querySelector(".stage")?.replaceChildren();
    root.querySelector(".rpg")?.classList.add("spinning");
    const run = this.run = { owner, index: d.index, t0: performance.now(), stops: d.stops, used: new Set(),
      reels: [0, 1, 2].map(r => ({ state: "spin", v: SPEED * (0.92 + r * 0.05), p: this.reelP[r] })) };
    if (owner) {
      root.querySelectorAll(".stop").forEach(b => { b.disabled = false; });
      this._keys = ev => { if (ev.code === "Space" && this.run === run) { ev.preventDefault(); this.requestStop(NaN); } };
      document.addEventListener("keydown", this._keys);
    }
    tone(330, 0.12, "sawtooth", 0.08); tone(440, 0.12, "sawtooth", 0.08, 0.08);
    let last = performance.now();
    let reach = false;
    await new Promise(done => {
      const frame = now => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const el = now - run.t0;
        // Stops due now: the owner's (and, for watchers, the owner's recorded ones); else the clock.
        for (const s of run.stops) {
          if (run.used.has(s) || el < s.at) continue;
          run.used.add(s);
          this.startStop(run, s.reel, d.targets[s.reel]);
        }
        const auto = (owner ? AUTO_STOP : AUTO_STOP + 6000) + run.reels.filter(x => x.state !== "spin").length * 700;
        if (el > auto) {
          const r = run.reels.findIndex(x => x.state === "spin");
          if (r >= 0) { if (owner) this.requestStop(r); else this.startStop(run, r, d.targets[r]); }
        }
        for (const [r, x] of run.reels.entries()) {
          if (x.state === "spin") x.p += x.v * dt;
          else if (x.state === "slide") {
            const k = Math.min(1, (now - x.s0) / x.dur);
            const np = x.from + (x.to - x.from) * ease(k);
            if (Math.floor(np) !== Math.floor(x.p)) tone(1200, 0.02, "square", 0.05);
            x.p = np;
            if (k >= 1) {
              x.p = x.to; x.state = "done";
              tone(180, 0.09, "square", 0.12);
              this.element?.querySelector(`.reel[data-r="${r}"]`)?.classList.add("landed");
              this.element?.querySelector(`.stop[data-r="${r}"]`)?.setAttribute("disabled", "");
              // Two alike (and worth something) with one reel left: 리치.
              const stopped = run.reels.map((y, i) => (y.state === "done" ? d.targets[i] : null));
              const left = run.reels.filter(y => y.state !== "done").length;
              if (!reach && left === 1) {
                const shown = stopped.filter(Boolean);
                if (shown.length === 2 && shown[0] === shown[1] && shown[0] !== "lemon") {
                  reach = true;
                  const rest = run.reels.find(y => y.state === "spin");
                  if (rest) rest.v = SPEED * 0.45;
                  this.element?.querySelector(".rpg")?.classList.add("reaching");
                  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, "square", 0.1, i * 0.07));
                }
              }
            }
          }
          this.reelP[r] = x.p;
        }
        this.paint();
        if (run.reels.every(x => x.state === "done")) return done();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    if (this._keys) { document.removeEventListener("keydown", this._keys); this._keys = null; }
    this.run = null;
    this.reelP = this.reelP.map(p => ((p % LOOP) + LOOP) % LOOP);
    await new Promise(r => setTimeout(r, 450));
    this.element?.querySelector(".rpg")?.classList.remove("reaching");
    if (!this.rendered) { this.spinning = false; return; }
    const win = d.prize.tier !== "common";
    if (win) this.element?.querySelector(".glass")?.classList.add("win");
    await this.finish(d.prize, d.index, win ? 900 : 0);
  }

  /** Slide reel r on to the next cell showing sym on the pay line (up to four cells further). */
  startStop(run, r, sym) {
    const x = run.reels[r];
    if (x.state !== "spin") return;
    const mid = x.p + 1;
    let k = Math.floor(mid) + 1;
    while (symAt(r, k) !== sym) k++;
    x.state = "slide";
    x.from = x.p;
    x.to = k - 1;
    x.s0 = performance.now();
    x.dur = 220 + (x.to - x.from) * 70;
  }

  async finish(prize, index, wait = 0) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    this.waiting = (this.waiting ?? []).filter(i => i !== index);
    this.pending = this.waiting.length ? Math.min(...this.waiting) : null;
    this.reveal = index;
    this.sel = index;
    this.shown = prize;
    this.spinning = false;
    this._redrawLater = false;
    chime(prize.tier);
    await this.render();
    if (["epic", "legendary"].includes(prize.tier)) this.confetti(prize.tier);
  }

  async _onClose(options) {
    if (this._keys) document.removeEventListener("keydown", this._keys);
    this.run = null;
    return super._onClose(options);
  }
}
