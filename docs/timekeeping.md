# UESRPG Timekeeping

UESRPG 3ev4 centralizes timekeeping behind a small, stable API that does not require any calendar module.

## Canonical source of time

* **Authoritative time is always Foundry world time (seconds)** via `game.time.worldTime`.
* Optional calendar modules (currently **Calendaria**) can enhance formatting and date conversions, but never replace world time as the canonical clock.

## Public API

The system exposes a stable namespace:

```js
// Always present once the system initializes
game.uesrpg.time
```

### Methods

* `getWorldTimeSeconds(): number`
* `getRoundTimeSeconds(): number`
* `worldTimeSecondsToComponents(seconds): object | null`
* `componentsToWorldTimeSeconds(components): number | null`
* `formatWorldTime(time?, formatter?, options?): string`

### Optional Calendaria adapter

If the module is active and its public API is available, an additional nested namespace is exposed:

```js
game.uesrpg.time.calendaria
```

Functions:

* `timestampToDate(worldTimeSeconds): object | null`
* `dateToTimestamp(dateTime): number | null`
* `formatDateTime(dateTime, options?): string | null`

If Calendaria is not active, `game.uesrpg.time.calendaria` is `null`.

## Hooks

UESRPG emits a stable time-change hook:

```js
Hooks.on("uesrpg.timeChanged", (payload) => {
  // ...
});
```

A combat-focused hook is also emitted for combat advancement notifications:

```js
Hooks.on("uesrpg.combatTimeChanged", (payload) => {
  // ...
});
```

### Payload contract

The payload is a single object:

```js
{
  worldTime: number,
  dtSeconds: number,
  source: "worldTime" | "calendaria" | "combat" | "combatTurn" | "combatRound",
  userId: string | null,
  options: object | null,
  combat: null | {
    id: string | null,
    started: boolean,
    round: number,
    turn: number,

    // When source is combatTurn/combatRound (pre-update)
    phase?: "pre",
    priorRound?: number,
    priorTurn?: number,
    advanceTime?: number,
    direction?: number,

    // When source is combat (post-update)
    phase?: "post",
    prior?: object | null,
    current?: object | null
  }
}
```

Notes:

* `combatTurn` and `combatRound` payloads are emitted **before** the Combat document update (initiating client).
* `combat` payloads are emitted **after** the Combat document update (all clients) via `combatTurnChange`.
* Calendar modules may emit their own UI events; UESRPG performs short-window deduplication to avoid emitting two identical `worldTime` ticks for a single advancement.

## Integration examples

### Listen for time passing

```js
Hooks.on("uesrpg.timeChanged", ({ worldTime, dtSeconds, source, combat }) => {
  if (combat?.started) return; // ignore realtime ticks during combat
  console.log("World time advanced", { worldTime, dtSeconds, source });
});
```

### Run code on each new combat turn (GM)

```js
Hooks.on("uesrpg.combatTimeChanged", ({ source, combat }) => {
  if (!game.user.isGM) return;
  if (source !== "combatTurn" && source !== "combatRound") return; // pre-update only
  console.log("Combat is advancing", combat);
});
```
