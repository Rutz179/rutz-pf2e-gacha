import { MID, esc, formatCp, setting, t } from "./util.mjs";
import { foodName } from "./foods.mjs";
import { BOARDS, FOODS, MACHINES, TIERS, TIER_COLOR, TIER_STARS, WEIGHT_KEY, loadIndex, priceCp, rulesAsEntries, saveTables, tables, weights, weightsRaw } from "./pool.mjs";

/* ======================================================================== *
 * 품목 편집 (GM): each tier's own list, or the built-in rules.
 *   [일반][고급][희귀][영웅][전설]           등급 확률 70 18 8 3.5 0.5
 *   ☑ 직접 만든 목록 사용 · 캐릭터 레벨 +[1]까지 · [기본 규칙으로 채우기]
 *   찾기 ________ (+)   음식: [육포][빵]…   동전 [40] cp (+)
 *   ┌ img  이름            레벨  수량  가중치  확률 ┐
 * Items come in by search (PF2e's equipment, the PF2e-KR copy if present)
 * or dragged from any compendium or the sidebar.
 * ======================================================================== */

export class TableEditor extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "rpg-tables",
    classes: ["rpg-ed"],
    window: { title: "RPG.Ed.Title", icon: "fa-solid fa-list", resizable: true },
    position: { width: 820, height: 680 }
  };

  constructor() {
    super();
    this.ui = { machine: "forage", tier: "common", q: "", level: Math.max(1, Math.round(averageLevel())) , coins: 40 };
    loadIndex().then(() => this.render());
  }

  async _renderHTML() {
    const m = this.ui.machine;
    const tb = tables(m);
    const tier = this.ui.tier;
    const cur = tb[tier];
    const w = weights(m);
    const raw = weightsRaw(m).split(/[,\s]+/);
    const machines = BOARDS.map(k => `<button type="button" class="mtab ${k === m ? "on" : ""} ${k === "forage" ? "forage" : ""}" data-a="machine" data-m="${k}"><i class="fa-solid ${{ forage: "fa-campground", roulette: "fa-dharmachakra", slot: "fa-7", highlow: "fa-layer-group" }[k]}"></i> ${k === "forage" ? t("Set.forage") : `${t("Set.loot")} · ${t(`Machine.${k}`)}`}</button>`).join("");
    const tabs = TIERS.map((k, i) => `<div class="tier ${k === tier ? "on" : ""}" style="--c:${TIER_COLOR[k]}">
      <button type="button" data-a="tier" data-tier="${k}"><span class="stars">${"★".repeat(TIER_STARS[k])}</span> ${t(`Tier.${k}`)}${tb[k].on && tb[k].entries.length ? ` <small>${t("Ed.Own")}</small>` : ""}</button>
      <span class="w"><input type="number" min="0" step="0.5" value="${esc(raw[i] ?? 0)}" data-w="${i}" class="n" data-tooltip="${esc(t("Ed.WeightHint"))}">%</span></div>`).join("");
    const sum = cur.entries.reduce((n, e) => n + Math.max(0, Number(e.weight) || 0), 0) || 1;
    const rows = cur.entries.map((e, i) => {
      const name = e.type === "food" ? foodName(e.key) : e.type === "coins" ? formatCp(e.cp) : e.name;
      const img = e.type === "food" ? FOODS[e.key]?.img : e.type === "coins" ? "systems/pf2e/icons/equipment/treasure/currency/silver-pieces.webp" : e.img;
      const chance = ((Math.max(0, Number(e.weight) || 0) / sum) * w[tier] * 100);
      return `<tr data-i="${i}"><td><img src="${esc(img)}" alt=""></td>
        <td class="nm">${esc(name)} ${e.type === "food" ? `<small>${t("Ed.Food")}</small>` : ""}</td>
        <td>${e.type === "item" ? e.level ?? 0 : e.type === "coins" && e.level != null && e.level !== "" ? `<span data-tooltip="${esc(t("Ed.CoinScale", { level: e.level }))}">${e.level} <i class="fa-solid fa-arrow-trend-up"></i></span>` : ""}</td>
        <td>${e.type === "coins" ? `<input type="number" min="1" value="${e.cp}" data-f="cp" class="n"> cp` : `<input type="number" min="1" value="${e.qty ?? 1}" data-f="qty" class="n">`}</td>
        <td><input type="number" min="0" step="0.5" value="${e.weight ?? 1}" data-f="weight" class="n"></td>
        <td class="pct">${chance < 0.1 ? chance.toFixed(2) : chance.toFixed(1)}%</td>
        <td><button type="button" class="mini" data-a="del"><i class="fa-solid fa-xmark"></i></button></td></tr>`;
    }).join("");
    const idx = await loadIndex();
    const words = this.ui.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? idx.filter(e => words.every(w => e.name.toLowerCase().includes(w) || e.slug.includes(w))).slice(0, 40) : [];
    return `<div class="ed">
      <nav class="machines">${machines}</nav>
      <nav class="tiers">${tabs}</nav>
      <div class="bar">
        <label><input type="checkbox" data-a="on" ${cur.on ? "checked" : ""}> <b>${t("Ed.UseOwn")}</b></label>
        <label>${t("Ed.Cap")} <input type="number" step="1" value="${cur.cap ?? ""}" data-a="cap" class="n" placeholder="—"></label>
        <span class="sp"></span>
        <label>${t("Ed.Level")} <input type="number" min="1" max="20" value="${this.ui.level}" data-a="level" class="n"></label>
        <button type="button" data-a="fill"><i class="fa-solid fa-wand-magic-sparkles"></i> ${t("Ed.Fill")}</button>
        <button type="button" data-a="clear"><i class="fa-solid fa-trash"></i> ${t("Ed.Clear")}</button></div>
      <p class="hint">${t(cur.on && cur.entries.length ? "Ed.HintOwn" : "Ed.HintRules")}</p>
      <div class="add">
        <div class="find"><input type="search" data-a="q" value="${esc(this.ui.q)}" placeholder="${esc(t("Ed.Search"))}">
          ${hits.length ? `<div class="hits">${hits.map(e => `<button type="button" data-a="add-item" data-uuid="${esc(e.uuid)}"><span class="lv">${e.level}</span><img src="${esc(e.img)}" alt="">${esc(e.name)}<small>${formatCp(Math.round(e.price))}</small><i class="fa-solid fa-plus"></i></button>`).join("")}</div>` : ""}</div>
        <div class="foods">${Object.keys(FOODS).map(k => `<button type="button" class="chip" data-a="add-food" data-key="${k}"><img src="${esc(FOODS[k].img)}" alt=""> ${esc(foodName(k))}<small class="q ${FOODS[k].quality}">${t(`Quality.${FOODS[k].quality}`)}</small></button>`).join("")}
          <span class="coins"><input type="number" min="1" value="${this.ui.coins}" data-a="coins" class="n"> cp <button type="button" class="chip" data-a="add-coins"><i class="fa-solid fa-coins"></i> ${t("Ed.AddCoins")}</button></span></div>
      </div>
      <div class="list drop"><table><thead><tr><th></th><th>${t("Ed.Name")}</th><th>${t("Ed.Lv")}</th><th>${t("Ed.Qty")}</th><th>${t("Ed.Weight")}</th><th>${t("Ed.Chance")}</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">${t("Ed.Empty")}</td></tr>`}</tbody></table></div>
      <p class="hint drophint"><i class="fa-solid fa-hand-pointer"></i> ${t("Ed.Drop")}</p></div>`;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".list")?.scrollTop ?? 0;
    const typing = document.activeElement?.dataset?.a === "q" && content.contains(document.activeElement);
    content.innerHTML = result;
    const list = content.querySelector(".list");
    if (list && top) list.scrollTop = top;
    if (typing) { const q = content.querySelector("[data-a='q']"); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }
    if (this._wired === content) return;
    this._wired = content;
    content.addEventListener("click", ev => this.onClick(ev));
    content.addEventListener("change", ev => this.onChange(ev));
    const typed = ev => {
      if (ev.isComposing || ev.target.dataset.a !== "q") return; // Korean IME: wait for the syllable
      this.ui.q = ev.target.value;
      clearTimeout(this._qt);
      this._qt = setTimeout(() => this.render(), 250);
    };
    content.addEventListener("input", typed);
    content.addEventListener("compositionend", typed);
    content.addEventListener("dragover", ev => ev.preventDefault());
    content.addEventListener("drop", ev => this.onDrop(ev));
  }

  async edit(fn) {
    const tb = tables(this.ui.machine);
    fn(tb[this.ui.tier], tb);
    await saveTables(tb, this.ui.machine);
    this.render();
  }

  async itemEntry(uuid) {
    const idx = await loadIndex();
    const e = idx.find(x => x.uuid === uuid);
    if (e) return { type: "item", uuid, name: e.name, img: e.img, level: e.level, itemType: e.type, price: e.price, qty: 1, weight: 1 };
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc || doc.documentName !== "Item") return null;
    return { type: "item", uuid: doc.uuid, name: doc.name, img: doc.img, level: Number(doc.system?.level?.value ?? 0) || 0, itemType: doc.type, price: priceCp(doc.system?.price), qty: 1, weight: 1 };
  }

  async onDrop(ev) {
    ev.preventDefault();
    let data;
    try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (_) { return; }
    if (data?.type !== "Item" || !data.uuid) return;
    const entry = await this.itemEntry(data.uuid);
    if (!entry) return;
    await this.edit(cur => { cur.entries.push(entry); cur.on = true; });
  }

  async onClick(ev) {
    const el = ev.target.closest("[data-a]");
    if (!el || el.tagName === "INPUT") return;
    ev.preventDefault();
    const i = Number(el.closest("[data-i]")?.dataset.i);
    switch (el.dataset.a) {
      case "tier": this.ui.tier = el.dataset.tier; return this.render();
      case "machine": this.ui.machine = el.dataset.m; return this.render();
      case "add-item": {
        const entry = await this.itemEntry(el.dataset.uuid);
        if (entry) await this.edit(cur => { cur.entries.push(entry); cur.on = true; });
        return;
      }
      case "add-food": return this.edit(cur => { cur.entries.push({ type: "food", key: el.dataset.key, qty: FOODS[el.dataset.key].qty, weight: 1 }); cur.on = true; });
      case "add-coins": return this.edit(cur => { cur.entries.push({ type: "coins", cp: Math.max(1, Number(this.ui.coins) || 1), level: Math.max(1, Math.round(Number(this.ui.level) || 1)), weight: 1 }); cur.on = true; });
      case "del": return this.edit(cur => { cur.entries.splice(i, 1); });
      case "fill": {
        const entries = await rulesAsEntries(this.ui.tier, this.ui.level, this.ui.machine);
        return this.edit(cur => { cur.entries = entries; cur.on = true; if (cur.cap === null || cur.cap === undefined) cur.cap = { common: null, uncommon: 0, rare: 0, epic: 1, legendary: 2 }[this.ui.tier]; });
      }
      case "clear": {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: t("Ed.Clear") }, content: `<p>${t("Ed.ClearAsk")}</p>`, rejectClose: false }).catch(() => false);
        if (ok) await this.edit(cur => { cur.entries = []; cur.on = false; });
      }
    }
  }

  async onChange(ev) {
    const el = ev.target;
    if (el.dataset.a === "q") return;
    if (el.dataset.w !== undefined) {
      const raw = weightsRaw(this.ui.machine).split(/[,\s]+/).map(Number);
      while (raw.length < 5) raw.push(0);
      raw[Number(el.dataset.w)] = Math.max(0, Number(el.value) || 0);
      await game.settings.set(MID, WEIGHT_KEY[this.ui.machine], raw.join(","));
      return this.render();
    }
    if (el.dataset.a === "on") return this.edit(cur => { cur.on = el.checked; });
    if (el.dataset.a === "cap") return this.edit(cur => { cur.cap = el.value === "" ? null : Number(el.value); });
    if (el.dataset.a === "level") { this.ui.level = Math.max(1, Number(el.value) || 1); return; }
    if (el.dataset.a === "coins") { this.ui.coins = Math.max(1, Number(el.value) || 1); return; }
    if (el.dataset.f) {
      const i = Number(el.closest("[data-i]")?.dataset.i);
      const v = Math.max(0, Number(el.value) || 0);
      return this.edit(cur => { if (cur.entries[i]) cur.entries[i][el.dataset.f] = v; });
    }
  }
}

function averageLevel() {
  const pcs = game.actors?.filter(a => a.type === "character" && a.hasPlayerOwner) ?? [];
  return pcs.length ? pcs.reduce((n, a) => n + (a.level ?? 1), 0) / pcs.length : 1;
}

export function openTables() {
  if (!game.user.isGM) return null;
  const open = foundry.applications.instances.get("rpg-tables");
  if (open) { open.render(true); return open; }
  const app = new TableEditor();
  app.render(true);
  return app;
}

/** For the settings menu. */
export class TableMenu extends foundry.applications.api.ApplicationV2 {
  render() { openTables(); return this; }
}
