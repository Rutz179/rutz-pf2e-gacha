# Rutz's Gacha & Loot

[Discord](https://discord.gg/bB7Ca666Bv) · [Wiki](https://github.com/Rutz179/rutz-pf2e-gacha/wiki) · [한국어](README.ko.md)

A reward machine for **Pathfinder 2e** in Foundry VTT. After Rest for the Night each character can try a check — success opens a treasure wheel of camp finds: mostly food, gear and potions, rarely something special. Pay to spin again, then take the pull or its value in coins — everyone at once, or one at a time while the table watches.

<img src="media/EN_08.gif" alt="The treasure wheel: SPIN, and the find lands on the right" width="613">

## Features
- **Chance after rest** — PF2e's Rest for the Night posts one card for everyone who rested: each player picks one of the game's checks against a level-based DC. A critical success is a tier up; a failure still gets one go at lower odds.
- **Treasure wheel** — five tiers from common to legendary; re-spins cost coins (scaled to level, up to 3); the last pull is yours, or its value in coins instead.
- **Play together or in turns** — by default each player plays their own chance at once; or one at a time, each spin on every screen with whose turn it is.
- **For GMs** — give a chance any time from the Rutz toolkit (🎁), or without a roll from the card; every option in one **gacha manager** window, with a prize list to exclude a find or limit how many there are.
- **Hand out loot** — one GM window to deal out items and cash after a fight, with a cash cap per level.
- **Gacha log** — who drew what, and when.

<img src="media/EN_04.png" alt="The Search the campsite card" height="290"> <img src="media/EN_14.png" alt="After a critical success: the wheel a tier up" height="290">

## Install
Foundry → *Add-on Modules* → *Install Module* → Manifest URL:
```
https://github.com/Rutz179/rutz-pf2e-gacha/releases/latest/download/module.json
```
Foundry VTT v13–v14 · Pathfinder 2e system · English / 한국어 (follows Foundry's language)

## Quick start
1. Enable the module in a PF2e world.
2. Rest for the Night — a **Search the campsite** card appears in chat. Each player presses **Search**.
3. On a success the wheel opens: **SPIN**, spin again if you like, then **Take**.
4. GM: the 🎁 button in the Rutz toolkit group gives a chance any time.

Full guide: **[Wiki](https://github.com/Rutz179/rutz-pf2e-gacha/wiki)** · Macro: `game.rutzGacha.offer(actors)`

Questions and bug reports: [Issues](https://github.com/Rutz179/rutz-pf2e-gacha/issues) or [Discord](https://discord.gg/bB7Ca666Bv).
