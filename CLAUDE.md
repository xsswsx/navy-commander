# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

海军指挥官 (Navy Commander) — a digital naval tabletop wargame built with Vue 3 + TypeScript. Players design warships by installing equipment into compartments, then fight turn-based battles using a shared 116-card deck. Supports hotseat (local pass-and-play) and online multiplayer via Socket.IO.

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Start Vite dev server (client at localhost:5173)
npm run dev:server       # Start multiplayer server (localhost:3001, tsx watch)
npm run build            # Type-check (vue-tsc) + production build
```

There are no test scripts currently configured. The Vite dev server proxies `/socket.io` to the multiplayer server automatically.

This project is configured with GitHub Actions. Use git commands to push it to remote repo on every update.

## Architecture

### Layer separation

| Layer | Location | Role |
|-------|----------|------|
| Pure game logic | `src/game/` | Zero Vue dependencies — types, dice, deck, equipment definitions |
| State management | `src/stores/` | Pinia stores bridging game logic to Vue reactivity |
| Mode adapters | `src/modes/` | `IGameModeAdapter` interface abstracts hotseat/single/multiplayer differences |
| UI | `src/views/` + `src/components/` | Vue SFCs; views map 1:1 to game phases |
| Shared protocol | `shared/protocol.ts` | Type contract between client and server (room state, socket events, battle actions) |
| Server | `server/` | Express + Socket.IO, room/lobby lifecycle, battle action relay |

### Game phases and routing

`setup → design → battle → results`, driven by `useGameStore().phase`. Vue Router guards (`beforeEnter`) enforce phase order — e.g., `/design` redirects to `/` if `phase !== 'design'`. The `App.vue` header shows phase/round info during battle and hides during setup.

### Stores (Pinia)

- **`game.ts`** — Central orchestrator: mode, phase, players, teams, turn order, round number, win condition. Turn order interleaves players across teams. `initPlayers()` calculates first-round compensation (later-turn players get bonus card draws).
- **`ship.ts`** — Ship/compartment CRUD. `finalizeDesign()` converts `ShipDesign[]` into live `Ship` objects. `applyDamage()`, multi-compartment equipment spanning.
- **`card.ts`** — 116-card shared deck (move 40 / command 40 / action 20 / coffee 8 / scheme 8). Auto-reshuffles discard pile into draw pile when empty.
- **`combat.ts`** — Battle runtime state: active effects (smoke, fighters, depth charges), pending torpedo salvos (delayed damage), fighter tokens and air superiority, combat log, per-turn command/sortie usage counters.
- **`ui.ts`** — Battle action state machine: `idle → moving → commanding → targeting_compartment → targeting_ship`. Also manages card selection, turn transition overlay, confirmation dialogs.

### Mode adapter pattern

`IGameModeAdapter` (defined in `src/modes/types.ts`) exposes:
- `onTurnTransition()` — hotseat shows a privacy screen between players; multiplayer is a no-op
- `requestTargetSelection()` — resolves when the player picks a target; hotseat uses Promise that the UI resolves
- `isHandVisible()` / `getVisiblePlayerIds()` — controls information hiding per mode

Currently `useGameMode()` always returns the `HotseatAdapter`. Multiplayer setup bypasses the adapter and communicates directly via `MultiplayerClient` (Socket.IO wrapper).

### Equipment system

18 equipment types defined as data in `src/game/equipment/registry.ts`. Each `EquipmentDefinition` has:
- `commandsPerTurn` / `sortieCapacity` — usage limits per turn
- `commands[]` — active abilities with targeting rules (`scope` + `range`)
- `passiveEffects[]` — persistent modifiers keyed to game events
- `triggers[]` — event-driven effects (e.g., ammo depot explodes on destruction)
- `compartmentSpan` — multi-compartment equipment (e.g., large hangar spans 2 compartments)

`baseHp = 25 - compartmentCount`, so smaller ships have tougher compartments.

### Combat mechanics

- **Hit roll**: D8, target number depends on equipment/effects
- **Damage**: naval guns roll 2D6 (dual) or 3D6 (triple); torpedoes roll 1D12 per torpedo
- **Torpedoes**: fired with a delay (remainingTurns), resolve when tick reaches 0
- **Air superiority**: each fighter token provides 2 points; AA guns provide 3. Enemy air superiority reduces hit chance.
- **Smoke**: short (1 turn) or long (2 turns), prevents targeting of affected compartments
- **Ammo depot**: explodes on destruction, dealing damage to adjacent compartments (chain reaction possible)

### Multiplayer protocol

Server maintains rooms (`server/state.ts`) with `RoomState` (slots, phase). Key flows:
1. Host creates room → gets 6-char code → others join
2. Players claim slots → host starts game → all enter design phase
3. Design updates broadcast per-team via `design:state`
4. All ready → server emits `battle:init` with full game state
5. Battle actions relayed through server; server enforces turn order via `currentTurnSlot`
6. `socketSlotMap` tracks which socket owns which slot for permission checks

### Path aliases

Configured in both `vite.config.ts` and `tsconfig.json`:
- `@/` → `src/`
- `@shared/` → `shared/`
