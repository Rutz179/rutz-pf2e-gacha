import { MID, SOCKET, esc, formatCp, setting, t, walletCp } from "./util.mjs";
import { TIERS, TIER_COLOR, TIER_STARS, machineOf, weights } from "./pool.mjs";
import { cashValue, keepMode, machineName, maxRerolls, nextCost, oddsText, prizeName, setName, spin, take, ticketBoard, ticketOf } from "./ticket.mjs";
import { joinLine, leaveLine, standing } from "./turn.mjs";

/* ======================================================================== *
 * 룰렛 창.
 *        ▼                    ┌──────────────┐
 *     ╱ ★ ★★ ★ ╲              │  ★★★ 희귀     │
 *    │  (SPIN)  │             │  [img] 물약   │
 *     ╲ ★★★ ★ ╱              └──────────────┘
 *                            [후보][후보][후보]
 *                            [다시 돌리기 · 1 sp] [이걸로 받기]
 * The wheel's slices are sized by the tier odds (a thin gold sliver for
 * legendary); the tier is drawn first, the wheel then stops inside one of
 * its slices — what you see is what the odds are.
 * Sounds are made on the spot (Web Audio): ticks, a chime, a fanfare.
 * ======================================================================== */

const PIECES = { common: 6, uncommon: 4, rare: 3, epic: 2, legendary: 1 };

/* ---------------- sound ---------------- */

let AC = null;
export function tone(freq, dur = 0.08, type = "triangle", vol = 0.15, when = 0) {
  const v = (Number(setting("volume", 0.5)) || 0) * vol;
  if (!v) return;
  try {
    AC ??= new (window.AudioContext || window.webkitAudioContext)();
    const t0 = AC.currentTime + when;
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(v, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(AC.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  } catch (_) { /* no audio */ }
}
export const tick = () => tone(1400, 0.03, "square", 0.08);
export function chime(tier) {
  const notes = { common: [660, 880], uncommon: [660, 880, 990], rare: [660, 880, 1100, 1320], epic: [523, 659, 784, 1047, 1319], legendary: [523, 659, 784, 1047, 1319, 1568, 2093] }[tier] ?? [660];
  notes.forEach((f, i) => tone(f, 0.25 + (i === notes.length - 1 ? 0.4 : 0), "triangle", 0.18, i * 0.09));
}

/* ---------------- the wheel ---------------- */

/** Slices: tiers spread round the wheel, each sized by its odds. */
function slices(board = "roulette") {
  const w = weights(board);
  const left = Object.fromEntries(TIERS.map(k => [k, w[k] > 0 ? PIECES[k] : 0]));
  const order = [];
  let prev = null;
  while (TIERS.some(k => left[k] > 0)) {
    const cands = TIERS.filter(k => left[k] > 0).sort((a, b) => left[b] / PIECES[b] - left[a] / PIECES[a] || left[b] - left[a]);
    const k = cands.find(c => c !== prev) ?? cands[0];
    order.push(k);
    left[k] -= 1;
    prev = k;
  }
  let a = 0;
  return order.map(tier => {
    const size = (w[tier] * 360) / PIECES[tier];
    const s = { tier, a0: a, a1: a + size };
    a += size;
    return s;
  });
}

const pt = (cx, cy, r, deg) => {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
};

function wheelSvg(list) {
  const C = 160;
  const R = 150;
  const paths = list.map((s, i) => {
    const [x0, y0] = pt(C, C, R, s.a0);
    const [x1, y1] = pt(C, C, R, s.a1);
    const large = s.a1 - s.a0 > 180 ? 1 : 0;
    const mid = (s.a0 + s.a1) / 2;
    const [lx, ly] = pt(C, C, R * 0.7, mid);
    const label = s.a1 - s.a0 >= 9 ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" transform="rotate(${mid.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})">${"★".repeat(TIER_STARS[s.tier])}</text>` : "";
    return `<path class="sl ${s.tier}" data-i="${i}" d="M${C},${C} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${TIER_COLOR[s.tier]}"/>${label}`;
  }).join("");
  // Pegs on the rim, one per slice border.
  const pegs = list.map(s => { const [x, y] = pt(C, C, R - 3, s.a0); return `<circle class="peg" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2"/>`; }).join("");
  return `<svg viewBox="0 0 320 320" class="wheel-svg"><defs>
      <radialGradient id="rpg-shade" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".35"/></radialGradient></defs>
    <circle cx="${C}" cy="${C}" r="${R + 7}" class="rim"/>${paths}<circle cx="${C}" cy="${C}" r="${R}" fill="url(#rpg-shade)" pointer-events="none"/>${pegs}</svg>`;
}

/* ---------------- the window ---------------- */

export class GachaApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["rpg-app"],
    window: { title: "RPG.Title", icon: "fa-solid fa-gift", resizable: false },
    position: { width: 820, height: 580 }
  };

  static MACHINE = "roulette";

  constructor(actor) {
    super({ id: `rpg-gacha-${actor.id}` });
    this.actor = actor;
    this.machine = this.constructor.MACHINE;
    this.rot = 0;
    this.spinning = false;
    this.sel = null;
    this.reveal = null;
    this.list = slices(this.board);
    this._listBoard = this.board;
  }

  get title() {
    return `${machineName(this.machine)} — ${this.actor.name}`;
  }

  /** Whose odds and tables: "forage" or this machine's loot (by the ticket). */
  get board() {
    return ticketBoard(ticketOf(this.actor) ?? { machine: this.machine, set: "forage" });
  }

  /**
   * No redraw while the wheel turns: a redraw (paying for a re-spin updates the character's coins,
   * which can make Foundry or another module redraw open windows) replaced the wheel mid-spin, so
   * only the result showed. A redraw asked for meanwhile happens once the wheel stops.
   */
  render(...args) {
    if (this.spinning && this.rendered) { this._redrawLater = true; return Promise.resolve(this); }
    return super.render(...args);
  }

  cardHtml(p, big = false) {
    if (!p) return "";
    // "치유 물약 (최하급)(Healing Potion (Minor))" → the Korean name on the card, the English under it (big card only).
    const full = prizeName(p);
    const m = /^(.*?[^\s(])\s*\(([A-Za-z][^]*)\)(\s*×\d+)?$/.exec(full);
    const main = m ? `${m[1]}${m[3] ?? ""}` : full;
    const sub = m ? m[2] : "";
    return `<div class="pcard ${p.tier} ${big ? "big" : ""}" style="--c:${TIER_COLOR[p.tier]}" data-tooltip="${esc(full)}">
      <div class="stars">${"★".repeat(TIER_STARS[p.tier])}</div>
      <img src="${esc(p.img)}" alt="">
      <div class="nm">${esc(main)}</div>${big && sub ? `<div class="en">${esc(sub)}</div>` : ""}
      <div class="tier">${t(`Tier.${p.tier}`)}${p.lost && big ? ` · <span class="lost">${t("LostShort")}</span>` : ""}</div></div>`;
  }

  /** Pulls this window may show (a watcher's copy hides the one still turning). */
  visibleSpins(tk) {
    return (tk?.spins ?? []).filter((_, i) => this.pending === null || this.pending === undefined || i < this.pending);
  }

  /** The right side: the big card, the pulls, the buttons — shared by the roulette and the slot. */
  rightHtml(tk, own, cost) {
    const spins = this.visibleSpins(tk);
    if (this.sel !== null && this.sel >= spins.length) this.sel = spins.length ? spins.length - 1 : null;
    if (this.sel === null && spins.length) this.sel = spins.length - 1;
    // "The last pull counts": earlier ones are shown crossed out and can't be chosen.
    const lastOnly = keepMode() === "last";
    if (lastOnly && spins.length) this.sel = spins.length - 1;
    const shown = this.reveal !== null ? (spins[this.reveal] ?? this.shown) : null;
    let spinBtn = "";
    if (own && cost !== null) {
      const label = cost === 0 ? t(spins.length ? "FreeAgain" : this.spinWord) : t("Reroll", { cost: formatCp(cost), n: maxRerolls(this.machine) - (tk.rerolls ?? 0) });
      const poor = cost > 0 && walletCp(this.actor) < cost;
      spinBtn = `<button type="button" class="spin ${cost === 0 ? "free" : ""}" data-a="spin" ${poor ? "disabled" : ""} ${poor ? `data-tooltip="${esc(t("NoMoney", { cost: formatCp(cost) }))}"` : ""}>
        <i class="fa-solid fa-rotate"></i> ${label}</button>`;
    }
    const chosen = spins[this.sel ?? -1];
    const cash = cashValue(chosen);
    const takeBtns = own && spins.length ? `<span class="end">
        ${cash ? `<button type="button" class="cash" data-a="cash" data-tooltip="${esc(t("CashHint"))}"><i class="fa-solid fa-coins"></i> ${t("Cash", { cost: formatCp(cash) })}</button>` : ""}
        <button type="button" class="take" data-a="take"><i class="fa-solid fa-hand-holding-heart"></i> ${t("Take")}</button></span>` : "";
    if (!tk) return `<div class="none"><i class="fa-solid fa-moon"></i><p>${t("NoTicket")}</p></div>`;
    return `<div class="stage">${shown ? this.cardHtml(shown, true) : `<div class="placeholder">${t(spins.length ? "PickHint" : this.hintWord)}</div>`}</div>
        <div class="pulls"><h4>${spins.length ? t("Pulls", { n: spins.length }) : "&nbsp;"}${tk.crit && !spins.length ? ` <span class="crit">${t(this.critWord)}</span>` : ""}</h4>
          <div class="row">${spins.map((p, i) => {
            const gone = lastOnly && i < spins.length - 1;
            return `<div class="pull ${i === this.sel ? "sel" : ""} ${gone ? "gone" : ""}" ${gone ? `data-tooltip="${esc(t("Gone"))}"` : `data-a="sel" data-i="${i}"`}>${this.cardHtml(p)}</div>`;
          }).join("")}</div></div>
        <div class="btns">${spinBtn}${takeBtns}</div>`;
  }

  get spinWord() { return "Spin"; }
  get hintWord() { return "SpinHint"; }
  get critWord() { return "CritBonus"; }

  whoHtml(own) {
    const tk = ticketOf(this.actor);
    return `<div class="who"><img src="${esc(this.actor.prototypeToken?.texture?.src || this.actor.img)}" alt=""><b>${esc(this.actor.name)}</b>${tk ? `<span class="set ${tk.set === "forage" ? "forage" : "loot"}">${esc(setName(tk.set ?? "loot"))}</span>` : ""}${own ? "" : `<small>${t("Watching")}</small>`}</div>`;
  }

  oddsHtml() {
    const odds = oddsText(this.board);
    return `<div class="odds">${TIERS.map(k => `<span style="--c:${TIER_COLOR[k]}"><i></i>${t(`Tier.${k}`)} ${odds[k]}</span>`).join("")}</div>`;
  }

  /** The left side: the machine itself. */
  leftHtml(tk, own, cost) {
    // A new chance on the other set: the wheel's slices follow its odds (never while it turns).
    if (!this.spinning && this._listBoard !== this.board) { this.list = slices(this.board); this._listBoard = this.board; }
    return `${this.whoHtml(own)}
        <div class="pointer"><i class="fa-solid fa-caret-down"></i></div>
        <div class="wheel"><div class="rot">${wheelSvg(this.list)}</div>
          <button type="button" class="hub" data-a="spin" ${own && cost !== null ? "" : "disabled"}>${t("Hub")}</button></div>
        ${this.oddsHtml()}`;
  }

  /** Someone else is at the machines: whose turn it is and where this character stands. */
  lineHtml(tk) {
    if (this.watch || !tk || !this.actor.isOwner || this.spinning) return "";
    const st = standing(this.actor);
    if (st === "mine" || st === "off") return "";
    if (st === "out") return `<div class="turnwait"><div><i class="fa-solid fa-people-line"></i><b>${t("Turn.Out")}</b>
      <button type="button" data-a="queue"><i class="fa-solid fa-right-to-bracket"></i> ${t("Turn.Join")}</button></div></div>`;
    const now = game.actors.get(st.now);
    return `<div class="turnwait"><div><i class="fa-solid fa-hourglass-half"></i><b>${t("Turn.Wait")}</b>
      ${now ? `<p>${t("Turn.Now", { name: esc(now.name), machine: st.machine ? machineName(st.machine) : "" })}</p>` : ""}
      <p class="pos">${t("Turn.Pos", { n: st.wait })}</p></div></div>`;
  }

  async _renderHTML() {
    const tk = ticketOf(this.actor);
    const own = this.actor.isOwner;
    const cost = nextCost(tk);
    return `<div class="rpg m-${this.machine}">
      <div class="left">${this.leftHtml(tk, own, cost)}</div>
      <div class="right">${this.rightHtml(tk, own, cost)}</div><div class="fx"></div>${this.lineHtml(tk)}</div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const rot = content.querySelector(".rot");
    if (rot) { rot.style.transition = "none"; rot.style.transform = `rotate(${this.rot}deg)`; }
    if (this._wired === content) return;
    this._wired = content;
    content.addEventListener("click", ev => this.onClick(ev));
  }

  /** A spin someone else made, played here (main.mjs's queue). */
  async play(d) {
    return this.animate(d.a, d.secs, d.prize, d.index);
  }

  async onClick(ev) {
    const el = ev.target.closest("[data-a]");
    if (!el || el.disabled || this.spinning) return;
    ev.preventDefault();
    if (el.dataset.a === "queue") return joinLine(this.actor, this.machine);
    if (el.dataset.a === "sel") { this.sel = Number(el.dataset.i); this.reveal = this.sel; return this.render(); }
    if (el.dataset.a === "take") return this.takeIt();
    if (el.dataset.a === "cash") return this.takeIt({ cash: true });
    if (el.dataset.a === "spin") return this.spinIt();
  }

  async spinIt() {
    this.spinning = true;
    // Only the buttons in the window body — the header's close button has to keep working.
    this.element.querySelectorAll(".window-content button").forEach(b => { b.disabled = true; });
    const prize = await spin(this.actor);
    if (!prize) { this.spinning = false; return this.render(); }
    const index = ticketOf(this.actor).spins.length - 1;
    // Stop inside a slice of the drawn tier, away from its edges.
    const mine = this.list.filter(s => s.tier === prize.tier);
    const s = mine[Math.floor(Math.random() * mine.length)];
    const a = s.a0 + (s.a1 - s.a0) * (0.18 + Math.random() * 0.64);
    const secs = 4.6 + Math.random() * 0.8;
    // Everyone else watches the same spin (setting broadcast).
    if (setting("broadcast", true)) game.socket.emit(SOCKET, { type: "spin", machine: "roulette", actor: this.actor.id, a, secs, prize, index, user: game.user.id });
    await this.animate(a, secs, prize, index);
  }

  /** Turn the wheel so that angle a (degrees on the wheel) stops under the pointer, then show the prize. */
  async animate(a, secs, prize, index) {
    this.spinning = true;
    this.element?.querySelectorAll(".window-content button").forEach(b => { b.disabled = true; });
    const base = this.rot + 360 * (5 + Math.floor(Math.random() * 2));
    const target = base + ((((-a - base) % 360) + 360) % 360);
    const root = this.element;
    if (!root) { this.spinning = false; return; }
    root.querySelector(".stage")?.replaceChildren();
    root.querySelector(".rpg")?.classList.add("spinning");
    // Look the wheel up each time: if the window was redrawn anyway, keep turning the new one.
    const wheel = () => this.element?.querySelector(".rot");
    const rot = wheel();
    const pointer = root.querySelector(".pointer");
    // Ticks: whenever a slice border passes the pointer.
    let last = -1;
    let alive = true;
    const watch = () => {
      if (!alive) return;
      const el = wheel();
      if (el && el !== rot && !el.dataset.turning) { el.dataset.turning = "1"; el.style.transition = rot.style.transition; el.style.transform = rot.style.transform; }
      const m = el ? getComputedStyle(el).transform : "none";
      if (m && m !== "none") {
        const [aa, bb] = m.match(/matrix\(([^)]+)\)/)?.[1].split(",").map(Number) ?? [1, 0];
        const deg = ((Math.atan2(bb, aa) * 180) / Math.PI + 360) % 360;
        const under = (360 - deg) % 360;
        const i = this.list.findIndex(x => under >= x.a0 && under < x.a1);
        if (i !== last) { last = i; tick(); pointer?.classList.remove("flick"); void pointer?.offsetWidth; pointer?.classList.add("flick"); }
      }
      requestAnimationFrame(watch);
    };
    rot.style.transition = `transform ${secs}s cubic-bezier(.1,.72,.12,1)`;
    requestAnimationFrame(() => { rot.style.transform = `rotate(${target}deg)`; requestAnimationFrame(watch); });
    await new Promise(res => { rot.addEventListener("transitionend", res, { once: true }); setTimeout(res, secs * 1000 + 400); });
    alive = false;
    this.rot = target % 3600;
    if (!this.rendered) { this.spinning = false; return; } // closed mid-spin: the prize is kept on the ticket
    // Later spins still waiting in the queue stay hidden.
    this.waiting = (this.waiting ?? []).filter(i => i !== index);
    this.pending = this.waiting.length ? Math.min(...this.waiting) : null;
    this.reveal = index;
    this.sel = index;
    this.shown = prize; // for watchers whose copy of the ticket hasn't arrived yet
    this.spinning = false;
    this._redrawLater = false;
    chime(prize.tier);
    await this.render();
    if (["epic", "legendary"].includes(prize.tier)) this.confetti(prize.tier);
  }

  confetti(tier) {
    const fx = this.element?.querySelector(".fx");
    if (!fx) return;
    const colors = tier === "legendary" ? ["#ffbf2e", "#fff3c4", "#ff8a3d", "#ffe066"] : ["#bf6bff", "#e3c4ff", "#7f5cff", "#ff7ad9"];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement("i");
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${Math.random() * 0.5}s`;
      p.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
      p.style.setProperty("--dx", `${(Math.random() - 0.5) * 160}px`);
      p.style.setProperty("--r", `${Math.random() * 720}deg`);
      fx.appendChild(p);
    }
    setTimeout(() => fx.replaceChildren(), 3500);
  }

  async takeIt({ cash = false } = {}) {
    const tk = ticketOf(this.actor);
    const i = keepMode() === "last" ? (tk?.spins?.length ?? 0) - 1 : this.sel ?? (tk?.spins?.length ?? 0) - 1;
    if (i < 0) return;
    const p = tk.spins[i];
    const amount = cash ? cashValue(p) : 0;
    if (cash || tk.spins.length > 1 || nextCost(tk) !== null) {
      const text = cash ? t("CashAsk", { item: esc(prizeName(p)), cost: formatCp(amount) }) : t("TakeAsk", { item: esc(prizeName(p)) });
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: t(cash ? "CashTitle" : "Take") }, content: `<p>${text}</p>`, rejectClose: false }).catch(() => false);
      if (!ok) return;
    }
    this.spinning = true;
    await take(this.actor, i, { cash });
    if (setting("broadcast", true)) game.socket.emit(SOCKET, { type: "took", actor: this.actor.id, user: game.user.id });
    this.spinning = false;
    this.close();
  }

  async _onClose(options) {
    this.spinning = false;
    // Walking away from the machine: the next in line goes (the chance stays on the character).
    if (!this.watch && !this._keepTurn) leaveLine(this.actor);
    return super._onClose?.(options);
  }
}

export const FLAG = MID;
