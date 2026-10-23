import { SOCKET, esc, formatCp, setting, t, walletCp } from "./util.mjs";
import { TIERS, TIER_COLOR, TIER_STARS } from "./pool.mjs";
import { GachaApp, chime, tone } from "./app.mjs";
import { cashValue, guess, guessCost, hlOdds, leave, nextCost, rankOf, rungsPerTier, spin, suitOf, ticketOf, topRung } from "./ticket.mjs";

/* ======================================================================== *
 * 하이 & 로우 — double up.
 *   [일반 ●●][고급 ●○][희귀 ○○][영웅 ○○][전설]   ← the ladder; two rungs a tier
 *   ┌───┐   ┌───┐
 *   │ 7 │   │ ? │        [▲ 높다 46%] [▼ 낮다 46%]
 *   └───┘   └───┘        [♥ 빨강 +2] [♠ 검정 +2]   (all-in)
 * A real 52-card deck, no card comes back: the odds on the buttons are
 * counted from what is left. Right: a rung up (every two rungs the find is
 * redrawn a tier higher). Wrong — or the same rank (the house wins) — the
 * pot is gone; a bite of food is all you take home. A critical success on
 * the check forgives one miss. Stop and take it whenever you like.
 * The higher the climb, the longer the drumroll and the redder the table.
 * Watchers get each step (before/after) and see it play out; they draw from
 * that, not from the ticket, so nothing shows early.
 * ======================================================================== */

const RANK = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = [["♠", "b"], ["♥", "r"], ["♦", "r"], ["♣", "b"]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = x => `${Math.round(x * 100)}%`;

function cardFace(id, cls = "") {
  if (id === null || id === undefined) return `<div class="pc back ${cls}"><i class="fa-solid fa-dragon"></i></div>`;
  const r = RANK[rankOf(id)];
  const [s, color] = SUITS[suitOf(id)];
  return `<div class="pc face ${color} ${cls}"><span class="c tl">${r}<br>${s}</span><span class="mid">${s}</span><span class="c br">${r}<br>${s}</span><b class="rk">${r}</b></div>`;
}

/** What the table shows: from the ticket (the player) or from the last step played (watchers). */
function viewOf(tk) {
  if (!tk) return null;
  const hl = tk.hl ?? {};
  return { drawn: !!tk.spins?.length || !!tk.bust, card: hl.card ?? null, deck: hl.deck ?? [], prize: tk.spins?.[0] ?? null,
    steps: hl.steps ?? 0, rung: hl.rung ?? 0, start: hl.start ?? tk.spins?.[0]?.tier ?? "common", safe: hl.safe ?? 0, bust: !!tk.bust, crit: !!tk.crit,
    old: tk.bust && !tk.spins?.length };
}

export class HighLowApp extends GachaApp {
  static MACHINE = "highlow";

  get spinWord() { return "HL.Draw"; }

  /** The step last played here wins over the ticket: a watcher's ticket is ahead of what it has seen. */
  current(tk) {
    if (!tk) return null;
    return this.view ?? viewOf(tk);
  }

  ladderHtml(v) {
    const per = rungsPerTier();
    const from = TIERS.indexOf(v.start);
    let n = 0;
    return TIERS.slice(from).map((k, i) => {
      const last = from + i === TIERS.length - 1;
      const pips = last ? "" : Array.from({ length: per }, () => { n += 1; return `<i class="${n <= v.rung ? "on" : ""}"></i>`; }).join("");
      const here = v.prize?.tier === k && !v.bust;
      return `<li class="${here ? "on" : ""}" style="--c:${TIER_COLOR[k]}"><span>${"★".repeat(TIER_STARS[k])}</span><small>${t(`Tier.${k}`)}</small>${pips ? `<em>${pips}</em>` : ""}</li>`;
    }).join("");
  }

  leftHtml(tk, own) {
    const v = this.current(tk);
    if (!v?.drawn) {
      return `${this.whoHtml(own)}
        <div class="felt"><div class="slot-a">${cardFace(null)}</div><div class="vs"></div><div class="slot-b">${cardFace(null)}</div><div class="banner"></div></div>
        <p class="hl-rules">${t("HL.Rules")}</p>${this.oddsHtml()}`;
    }
    const top = topRung(v.start);
    const heat = top ? Math.min(1, v.rung / top) : 0;
    const cost = guessCost(tk);
    const live = !v.bust && v.rung < top;
    const can = own && cost !== null && live && !this.spinning;
    const odds = v.card !== null && v.deck?.length ? hlOdds(v) : null;
    const poor = cost > 0 && walletCp(this.actor) < cost;
    const dis = can && !poor ? "" : "disabled";
    const btns = live ? `<div class="guess">
        <button type="button" class="hi" data-a="hi" ${dis}><i class="fa-solid fa-caret-up"></i> ${t("HL.Hi")} <small>${odds ? pct(odds.hi) : ""}</small></button>
        <button type="button" class="lo" data-a="lo" ${dis}><i class="fa-solid fa-caret-down"></i> ${t("HL.Lo")} <small>${odds ? pct(odds.lo) : ""}</small></button>
        <button type="button" class="red allin" data-a="red" ${dis} data-tooltip="${esc(t("HL.AllInHint"))}">♥ ${t("HL.Red")} <small>${odds ? pct(odds.red) : ""} · +2</small></button>
        <button type="button" class="black allin" data-a="black" ${dis} data-tooltip="${esc(t("HL.AllInHint"))}">♠ ${t("HL.Black")} <small>${odds ? pct(odds.black) : ""} · +2</small></button></div>` : "";
    const note = [
      v.bust ? null : t("HL.Streak", { n: v.rung, max: top }),
      odds ? t("HL.Left", { n: odds.left }) : null,
      odds && live ? t(setting("hlTie", "lose") === "push" ? "HL.TiePush" : "HL.TieHouse", { p: pct(odds.tie) }) : null,
      cost > 0 && live ? formatCp(cost) : null,
      v.safe ? `<span class="safe"><i class="fa-solid fa-shield-halved"></i> ${t("HL.Safe")}</span>` : null,
      !live && !v.bust ? t("HL.Top") : null
    ].filter(Boolean).join(" · ");
    return `${this.whoHtml(own)}
      <ol class="ladder">${this.ladderHtml(v)}</ol>
      <div class="felt ${v.bust ? "bust" : ""}" style="--heat:${heat.toFixed(2)}">
        <div class="slot-a">${cardFace(v.card)}</div>
        <div class="vs">${live ? "?" : ""}</div>
        <div class="slot-b">${cardFace(null)}</div>
        <div class="streak">${v.rung && !v.bust ? `<b>${v.rung}</b><small>${t("HL.Wins")}</small>` : ""}</div>
        <div class="banner"></div>
      </div>
      ${btns}
      <p class="hl-note">${note}</p>`;
  }

  rightHtml(tk, own) {
    if (!tk) return `<div class="none"><i class="fa-solid fa-moon"></i><p>${t("NoTicket")}</p></div>`;
    const v = this.current(tk);
    if (!v?.drawn) {
      const can = own && nextCost(tk) === 0;
      return `<div class="stage"><div class="placeholder">${t("HL.Hint")}</div></div>
        <div class="pulls"><h4>${v?.crit ? `<span class="crit">${t("HL.CritBonus")}</span>` : "&nbsp;"}</h4></div>
        <div class="btns">${can ? `<button type="button" class="spin free" data-a="spin"><i class="fa-solid fa-layer-group"></i> ${t("HL.Draw")}</button>` : ""}</div>`;
    }
    // An old ticket that went bust with nothing at all.
    if (v.old) {
      return `<div class="stage"><div class="placeholder bust"><i class="fa-solid fa-heart-crack"></i><p>${t("HL.Bust")}</p></div></div>
        <div class="pulls"><h4>&nbsp;</h4></div>
        <div class="btns">${own ? `<span class="end"><button type="button" class="take" data-a="leave">${t("HL.Leave")}</button></span>` : ""}</div>`;
    }
    if (v.bust) {
      return `<div class="stage lost"><div class="bustmsg"><i class="fa-solid fa-heart-crack"></i> ${t("HL.PotLost")}</div>${this.cardHtml(v.prize, true)}</div>
        <div class="pulls"><h4>${t("HL.Consolation")}</h4></div>
        <div class="btns">${own ? `<span class="end"><button type="button" class="take" data-a="take"><i class="fa-solid fa-drumstick-bite"></i> ${t("HL.TakeConsolation")}</button></span>` : ""}</div>`;
    }
    const cash = cashValue(v.prize);
    return `<div class="stage">${this.cardHtml(v.prize, true)}</div>
      <div class="pulls"><h4>${t("HL.Pot")}</h4></div>
      <div class="btns">${own ? `<span class="end">
        ${cash ? `<button type="button" class="cash" data-a="cash" data-tooltip="${esc(t("CashHint"))}"><i class="fa-solid fa-coins"></i> ${t("Cash", { cost: formatCp(cash) })}</button>` : ""}
        <button type="button" class="take" data-a="take"><i class="fa-solid fa-hand-holding-heart"></i> ${t("HL.Stop")}</button></span>` : ""}</div>`;
  }

  async onClick(ev) {
    const el = ev.target.closest("[data-a]");
    if (!el || el.disabled || this.spinning) return;
    if (["hi", "lo", "red", "black"].includes(el.dataset.a)) { ev.preventDefault(); return this.guessIt(el.dataset.a); }
    if (el.dataset.a === "leave") { ev.preventDefault(); return this.leaveIt(); }
    return super.onClick(ev);
  }

  lock() {
    this.spinning = true;
    this.element?.querySelectorAll(".window-content button").forEach(b => { b.disabled = true; });
  }

  /** The first draw: a find and a card. */
  async spinIt() {
    this.lock();
    const before = viewOf(ticketOf(this.actor));
    const prize = await spin(this.actor);
    if (!prize) { this.spinning = false; return this.render(); }
    const after = viewOf(ticketOf(this.actor));
    const d = { type: "hl", phase: "draw", actor: this.actor.id, before, after, user: game.user.id };
    if (setting("broadcast", true)) game.socket.emit(SOCKET, d);
    await this.showDraw(d);
  }

  async guessIt(dir) {
    this.lock();
    const before = viewOf(ticketOf(this.actor));
    const r = await guess(this.actor, dir);
    if (!r) { this.spinning = false; return this.render(); }
    const d = { type: "hl", phase: "guess", actor: this.actor.id, before, after: viewOf(r.tk), from: r.from, next: r.next, dir, result: r.result, tierUp: r.tierUp, rung: r.rung, user: game.user.id };
    if (setting("broadcast", true)) game.socket.emit(SOCKET, d);
    await this.showGuess(d);
  }

  async play(d) {
    this.view = d.before;
    this.spinning = false;
    await this.render();
    if (d.phase === "draw") await this.showDraw(d);
    else await this.showGuess(d);
  }

  /** Deal the first card face down, turn it over, show the find. */
  async showDraw(d) {
    this.lock();
    const a = this.element?.querySelector(".slot-a");
    if (a) {
      a.innerHTML = cardFace(null, "deal");
      tone(500, 0.05, "triangle", 0.1);
      await sleep(450);
      a.innerHTML = cardFace(d.after.card, "flip");
      tone(900, 0.06, "triangle", 0.12);
      await sleep(650);
    }
    await this.settle(d);
  }

  /** Turn the next card over and say how it went: the higher the climb, the longer the wait. */
  async showGuess(d) {
    const root = this.element;
    const felt = root?.querySelector(".felt");
    const b = root?.querySelector(".slot-b");
    const banner = root?.querySelector(".banner");
    root?.querySelector(`.guess [data-a="${d.dir}"]`)?.classList.add("picked");
    felt?.classList.add("tense");
    const beats = 6 + Math.min(14, (d.before.rung ?? 0) * 2) + (d.dir === "red" || d.dir === "black" ? 4 : 0);
    for (let i = 0; i < beats; i++) {
      tone(140 + i * 18, 0.05, "square", 0.05 + i * 0.004);
      await sleep(Math.max(55, 130 - i * 4));
    }
    if (b) b.innerHTML = cardFace(d.next, "flip");
    tone(1000, 0.05, "triangle", 0.12);
    await sleep(520);
    felt?.classList.remove("tense");
    const kind = { win: d.tierUp ? "WinUp" : "Win", lose: "Lose", saved: "Saved", push: "Push" }[d.result] ?? "Lose";
    if (banner) { banner.textContent = t(`HL.${kind}`, { n: d.rung }); banner.className = `banner show ${d.result} ${d.tierUp ? "up" : ""}`; }
    if (d.result === "win") {
      [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.16, "triangle", 0.14, i * 0.08));
      if (d.tierUp) setTimeout(() => chime(d.after.prize.tier), 350);
    } else if (d.result === "saved" || d.result === "push") tone(520, 0.25, "triangle", 0.12);
    else {
      // The crash: the table shakes, the pot is swept away.
      root?.querySelector(".rpg")?.classList.add("crash");
      [392, 311, 233, 175, 131].forEach((f, i) => tone(f, 0.3, "sawtooth", 0.1, i * 0.09));
    }
    await sleep(d.result === "lose" ? 1500 : 1100);
    root?.querySelector(".rpg")?.classList.remove("crash");
    await this.settle(d);
  }

  async settle(d) {
    if (!this.rendered) { this.spinning = false; return; }
    this.view = d.after;
    this.spinning = false;
    this._redrawLater = false;
    await this.render();
    const p = d.after.prize;
    const shine = p && !d.after.bust && (d.phase === "draw" || d.tierUp);
    if (shine && d.phase === "draw") chime(p.tier);
    if (shine && ["epic", "legendary"].includes(p.tier)) this.confetti(p.tier);
  }

  async takeIt(opts = {}) {
    this.sel = 0;
    return super.takeIt(opts);
  }

  async leaveIt() {
    this.lock();
    await leave(this.actor);
    if (setting("broadcast", true)) game.socket.emit(SOCKET, { type: "took", actor: this.actor.id, user: game.user.id });
    this.spinning = false;
    this.close();
  }
}
