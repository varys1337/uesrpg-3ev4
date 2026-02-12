# Card Renderer Fix - Phase 20.1

**Date**: February 3, 2026  
**Issue**: Runtime TypeError: `_renderCard is not a function` at card-updater.js:37  
**Root Cause**: Action handlers were calling `updateCard(message, data)` with only 2 parameters, but `updateCard` requires a 3rd parameter: `_renderCard` (dependency injection pattern)

## Problem

After the Phase 20 refactoring, action handlers were importing `updateCard` directly from card-updater.js:

```javascript
import { updateCard as _updateCard } from "../card-updater.js";

export async function handleAttackerAction(action, ctx) {
  // ...
  await _updateCard(message, data);  // ERROR: Missing 3rd parameter!
}
```

But `card-updater.js` expects:
```javascript
export async function updateCard(message, data, _renderCard) {
  // Line 37: _renderCard(data, message.id) - ERROR if _renderCard is undefined!
}
```

## Solution

**Dependency Injection via Context Object**

1. **dispatch.js** now builds a `_renderCard` wrapper function and injects `_updateCard` into the `ctx` object
2. **Action handlers** extract `_updateCard` from `ctx` instead of importing it directly

### Changes Made

#### 1. dispatch.js
- Added imports for card renderers and schema helpers
- Created `_renderCard(data, messageId)` function that delegates to renderMultiDefenderCard or renderSingleDefenderCard
- Created `_updateCard(message, data)` wrapper that calls `_updateCardViaUpdater(message, data, _renderCard)`
- Added `_updateCard` to the `ctx` object passed to all action handlers

#### 2. All Action Handlers (8 files)
**Files Updated:**
- attacker.js
- defender-commit.js (3 functions)
- defender-roll.js (2 functions)
- damage.js (2 functions)
- resolve.js (2 functions)
- banked-roll.js
- talents.js

**Pattern Applied:**
```diff
- import { updateCard as _updateCard } from "../card-updater.js";
  
  export async function handleAttackerAction(action, ctx) {
-   const { message, data, attacker } = ctx;
+   const { message, data, attacker, _updateCard } = ctx;
    // ... rest of function unchanged
  }
```

#### 3. IMPORT_GUIDE.md
- Added "Critical Pattern: Context Object (ctx)" section at the top
- Documented the ctx object structure and why _updateCard must not be imported
- Updated common mistakes table to highlight this pattern

## Testing

✅ Static validation: Zero TypeScript/ESLint errors  
⏳ Runtime validation: Ready for smoke testing  

**Test Scenarios:**
1. Create pending opposed attack (tests card rendering)
2. Attacker roll (tests card update)
3. Defender roll (tests card update)
4. Damage roll (tests card update with resolved state)
5. Multi-defender attack (tests renderMultiDefenderCard path)
6. Banked-choice workflow (tests commit + auto-roll)
7. Defender advantage resolution
8. Block resolution
9. Follow-up Strike
10. Counter-attack

## Architectural Notes

**Why Dependency Injection?**

The `_renderCard` function needs access to:
- Schema helpers (_getDefenderEntries, _isMultiDefender, etc.)
- Utility helpers (_anyActiveGMOnline, _safeGetSetting, etc.)
- Banking state helpers (_getBankCommitState, _allDefendersCommitted, etc.)

By building this function in `dispatch.js` and injecting it through `ctx`, we:
1. Avoid circular imports (action handlers → card-updater → renderers → schema → action handlers)
2. Keep the rendering logic centralized
3. Maintain the dependency injection pattern used by card-updater.js
4. Simplify action handler code (no need to import and wire up all renderer dependencies)

**Future Considerations**

If additional card update functions are needed (e.g., partial updates, bulk updates), follow the same pattern:
1. Build the wrapper in dispatch.js with all required dependencies
2. Inject via ctx object
3. Document in IMPORT_GUIDE.md
