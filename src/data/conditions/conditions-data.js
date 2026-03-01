/**
 * src/data/conditions/conditions-data.js
 *
 * Single source of truth for all UESRPG 3ev4 condition definitions.
 *
 * Each entry contains:
 *  - id:          Stable canonical key (lowercase, kebab-case).
 *  - name:        Localized display name.
 *  - img:        Foundry core SVG icon path.
 *  - description: **Verbatim RAW rules text** from the UESRPG 3ev4 rulebook chapters,
 *                 minimally wrapped in HTML for Foundry rendering.
 *  - rulesRef:    Chapter + section for traceability.
 *  - hudVisible:  Whether this condition appears on the Token HUD status palette.
 *
 * Rules for maintenance:
 *  1. Do NOT paraphrase — copy the exact text from the rulebook chapters.
 *  2. Preserve bullet structure as <ul>/<li> and tables as <table>.
 *  3. Keep `id` stable; renaming breaks flag-keyed lookups across saved worlds.
 *  4. When updating RAW text, update the `description` here — the sync pipeline
 *     and the condition engine both import from this module.
 *
 * How to add a new condition:
 *  1. Add an entry to CONDITIONS_DATASET below with all required fields.
 *  2. If it should appear on the Token HUD, set `hudVisible: true` and add the id
 *     to TOKEN_HUD_CONDITION_ORDER in condition-engine.js.
 *  3. If it needs AE modifier automation, add a corresponding entry to
 *     STATIC_CONDITIONS in condition-engine.js with the `changes` array.
 * How to update RAW text safely:
 *  1. Edit the `description` field below.
 *  2. The condition engine will pick up the new description automatically.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Dataset
// ─────────────────────────────────────────────────────────────────────────────

const CONDITIONS_DATASET = Object.freeze([

  // ── Bleeding (X) ──────────────────────────────────────────────────────────
  {
    id: "bleeding",
    name: "Bleeding (X)",
    img: "icons/svg/blood.svg",
    hudVisible: true,
    description:
      `<p>Reduce Wound Threshold by 1. At the end of the character's next Turn, they take X damage (bypass AR/resistance); then X is reduced by 1. If the character regains HP from any source, subtract the total HP regained (including HP that would go beyond the character's maximum HP) from X.</p>` +
      `<p>Bleeding can also be reduced by making a Profession [Medicine] +0 skill test and using a Healer's Kit. Reduce X by the DoS of the test. The Healer's Kit is not consumed in the process.</p>` +
      `<p>If X ever becomes 0, the Bleeding condition is removed.</p>` +
      `<p>If the Bleeding(X) condition would be inflicted on a character that already has a Bleeding condition, the value of each is added together and replaces the current Bleeding condition.</p>` +
      `<p><strong>Optional Rule Note: Alternate Wounds</strong> — If your group is using the optional rule for wounds, replace the text "Reduce Wound Threshold by 1." with "Characters take a -10 penalty to Shock Tests.".</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Blinded ────────────────────────────────────────────────────────────────
  {
    id: "blinded",
    name: "Blinded",
    img: "icons/svg/blind.svg",
    hudVisible: true,
    description:
      `<p>The character loses all vision and suffers the following penalties:</p>` +
      `<ul>` +
      `<li>Cannot see anything.</li>` +
      `<li>Suffers a -30 to tests benefitting from sight.</li>` +
      `<li>Automatically fail any tests that rely solely on sight.</li>` +
      `</ul>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Burning (X) ────────────────────────────────────────────────────────────
  {
    id: "burning",
    name: "Burning (X)",
    img: "icons/svg/fire.svg",
    hudVisible: true,
    description:
      `<p>The target is engulfed in flames, with the intensity of the fire determined by a number X.</p>` +
      `<ul>` +
      `<li><strong>Start of Turn:</strong> At the end of each of their turns, a burning character suffers a single hit of X fire damage to the appropriate hit location (body is the default). Then increase X by 1.</li>` +
      `<li><strong>Stacking Burning:</strong> If a second instance of burning is inflicted on a character, simply combine the two X values.</li>` +
      `<li><strong>Taking Action:</strong> A burning character must pass a Willpower test with a -20 penalty at the beginning of a Turn in order to attempt any action other than putting out the fire.</li>` +
      `<li><strong>Putting It Out:</strong> A burning character can attempt to extinguish the flames on their Turn by spending an Action Point and making a Strength or Agility test with a +20 bonus and a -10 penalty for every point of the X value beyond 1. The burning character becomes prone and, if the test succeeds, loses the burning condition.</li>` +
      `</ul>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Chameleon (X) ──────────────────────────────────────────────────────────
  {
    id: "chameleon",
    name: "Chameleon (X)",
    img: "icons/svg/eye.svg",
    hudVisible: false,
    description:
      `<p>A character with this condition blends into their environment. Sight based tests to detect this character are made with a -X penalty. Only apply the highest value version of this condition if a character would receive it more than once.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Crippled Body Part ─────────────────────────────────────────────────────
  {
    id: "crippled",
    name: "Crippled Body Part",
    img: "icons/svg/bones.svg",
    hudVisible: true,
    description:
      `<p>A piece of the character's body has been rendered temporarily useless. Multiple instances of this condition can affect a character at once as long as each affects a different hit location and/or the body parts associated with that hit location. Any body part that has been crippled suffers all the same penalties as if it had been lost. Use Lost Eye or Lost Ear if the head location has been crippled and the Organ Damage condition if the body location has been crippled.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Dazed ──────────────────────────────────────────────────────────────────
  {
    id: "dazed",
    name: "Dazed",
    img: "icons/svg/daze.svg",
    hudVisible: true,
    description:
      `<p>The character gains one less Action Point at the beginning of each round, to a minimum of one.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Deafened ───────────────────────────────────────────────────────────────
  {
    id: "deafened",
    name: "Deafened",
    img: "icons/svg/deaf.svg",
    hudVisible: true,
    description:
      `<p>The character loses all hearing and suffers the following penalties:</p>` +
      `<ul>` +
      `<li>Cannot hear anything.</li>` +
      `<li>Suffers a -30 to tests benefitting from hearing.</li>` +
      `<li>Automatically fail any tests that rely solely on hearing.</li>` +
      `</ul>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Entangled ──────────────────────────────────────────────────────────────
  {
    id: "entangled",
    name: "Entangled",
    img: "icons/svg/net.svg",
    hudVisible: true,
    description:
      `<p>The character makes all Combat Style tests with a -20 penalty and their movement speed is halved (round up).</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Fatigued ───────────────────────────────────────────────────────────────
  {
    id: "fatigued",
    name: "Fatigued",
    img: "icons/svg/sleep.svg",
    hudVisible: false,
    description:
      `<p>When a character gains a level of fatigue, they acquire the Fatigued condition. If they gain additional levels of fatigue, the effects worsen. Fatigue is most typically gained when a character falls below 0 SP or spends/loses SP when they are at 0.</p>` +
      `<table>` +
      `<thead><tr><th>Level</th><th>Name</th><th>Effect</th></tr></thead>` +
      `<tbody>` +
      `<tr><td>1</td><td>Fatigued</td><td>-10 penalty to all tests.</td></tr>` +
      `<tr><td>2</td><td>Exhausted</td><td>-20 penalty to all tests.</td></tr>` +
      `<tr><td>3</td><td>Drained</td><td>-30 penalty to all tests.</td></tr>` +
      `<tr><td>4</td><td>Unconscious</td><td>Character falls unconscious.</td></tr>` +
      `<tr><td>5+</td><td>Death</td><td>Character dies.</td></tr>` +
      `</tbody>` +
      `</table>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Feinted ────────────────────────────────────────────────────────────────
  {
    id: "feinted",
    name: "Feinted",
    img: "icons/svg/combat.svg",
    hudVisible: false,
    description:
      `<p>Character attempts a Combat Style or Deceive test against an opponent's Observe or Combat Style within a 2m range. If successful, they treat their next melee attack against the target as if they were Hidden. This effect only applies if the attack occurs before the end of the character's current Turn.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Special Actions — Feint" }
  },

  // ── Frenzied ───────────────────────────────────────────────────────────────
  {
    id: "frenzied",
    name: "Frenzied",
    img: "icons/svg/terror.svg",
    hudVisible: true,
    description:
      `<p>The character is flung into an uncontrollable rage. Frenzied characters gain the following rules:</p>` +
      `<ul>` +
      `<li>Must attempt to attack the nearest person or creature in melee combat each Turn if able, using only All Out Attacks.</li>` +
      `<li>If not within range of a potential target, the character must move toward the nearest potential target. They may not attempt to flee the fight.</li>` +
      `<li>Increase WT by 3 and SB by 1.</li>` +
      `<li>Suffer a -20 penalty to all skill tests based on anything except Strength, Agility, or Endurance.</li>` +
      `<li>Gain an extra SP, which can exceed their SP maximum.</li>` +
      `<li>Immune to the effects of the stunned condition, fear, and passive wound effects.</li>` +
      `</ul>` +
      `<p>Once the encounter has ended, the character snaps out of their frenzied state and loses 2 SP (this cannot kill them). The character can also test Willpower at a -20 as a Secondary Action during combat to attempt to snap out of frenzy, which ends the condition.</p>` +
      `<p><strong>Optional Rule Note: Alternate Wounds</strong> — If you're using the rules for Alternate Wounds, disregard the WT increase in this bullet point.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Grappled ───────────────────────────────────────────────────────────────
  {
    id: "grappled",
    name: "Grappled",
    img: "icons/svg/grab.svg",
    hudVisible: false,
    description:
      `<p>In place of making a normal attack a character can choose to attempt to grapple their opponent. This requires a Combat Style test (the style must include unarmed combat) opposed against either a Combat Style (with unarmed), Athletics, or Evade test. On success, the target gains the restrained condition. The target may attempt to escape by using the resist action. On success they break free.</p>` +
      `<p>Characters suffer a -30 penalty when attempting to grapple characters of larger size than them, and they cannot grapple characters of two or more sizes larger. While they have an opponent restrained, the character may not move but may take the following actions (each is a primary action that costs 1 AP):</p>` +
      `<ul>` +
      `<li><strong>Takedown:</strong> The character may render their victim, and themself, prone. They suffer no prone penalties in relation to any tests made against their target.</li>` +
      `<li><strong>Move:</strong> The character may move themself and their victim a number of meters up to their Strength bonus in any direction.</li>` +
      `<li><strong>Attack:</strong> The character may make a normal attack against their restrained victim, who cannot defend themself. They must use a weapon with a 1m range or less. If the target is both prone and restrained and the character is armed, this can be a coup de grâce. If the character is unarmed, then they can choose to instead cause the target to lose 1 Stamina point.</li>` +
      `</ul>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Unarmed Combat — Grappling" }
  },

  // ── Hidden ─────────────────────────────────────────────────────────────────
  {
    id: "hidden",
    name: "Hidden",
    img: "icons/svg/cowled.svg",
    hudVisible: true,
    description:
      `<p>The character is hidden from enemies and moving stealthily. Characters must spend 2 meters of their movement for the round for each 1 meter that they actually move while hidden, and they cannot Dash. Enemies cannot attempt to defend themselves against the attacks of hidden characters, but attacking causes a character to lose this condition immediately afterwards.</p>` +
      `<p>If a hidden character would enter line of sight of at least one character from whom they have not previously hidden, they must make a Stealth test opposed by that character's Observe. On success, or if they achieve more degrees of success, they remain hidden. Otherwise that character becomes aware of them.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Immobilized ────────────────────────────────────────────────────────────
  {
    id: "immobilized",
    name: "Immobilized",
    img: "icons/svg/statue.svg",
    hudVisible: true,
    description:
      `<p>Immobilized characters cannot move. They may still attack and take other actions and can defend themselves.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Invisible ──────────────────────────────────────────────────────────────
  {
    id: "invisible",
    name: "Invisible",
    img: "icons/svg/invisible.svg",
    hudVisible: true,
    description:
      `<p>Invisible characters cannot be seen. Characters fail all sight related tests related to spotting the Invisible character and attack them at a -30 penalty, assuming they can guess where the character might be in the first place.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Lost Body Part ─────────────────────────────────────────────────────────
  {
    id: "lost-body-part",
    name: "Lost Body Part",
    img: "icons/svg/skull.svg",
    hudVisible: false,
    description:
      `<p>The character loses a part of their body. A character can have multiple instances of this condition at once, each affecting a different body part. If an attack would hit a body part that has been entirely lost, the attack hits the body location instead. This condition applies additional penalties that vary based on the body part. In the case of the head, there is a choice between an ear or an eye (GM's decision).</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Lost Ear ───────────────────────────────────────────────────────────────
  {
    id: "lost-ear",
    name: "Lost Ear",
    img: "icons/svg/deaf.svg",
    hudVisible: false,
    description:
      `<p>The character has had their ear removed or destroyed and their hearing damaged. They suffer the following penalties:</p>` +
      `<ul>` +
      `<li>All tests that rely on hearing are made with a -20 penalty.</li>` +
      `<li>If both ears are lost, the character gains the deafened condition permanently.</li>` +
      `</ul>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Lost Eye ───────────────────────────────────────────────────────────────
  {
    id: "lost-eye",
    name: "Lost Eye",
    img: "icons/svg/blind.svg",
    hudVisible: false,
    description:
      `<p>The character has had their eye removed or destroyed and suffers the following penalties:</p>` +
      `<ul>` +
      `<li>All tests that rely on sight are made with a -20 penalty.</li>` +
      `<li>If both eyes are lost, the character gains the blinded condition permanently.</li>` +
      `</ul>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Lost Foot/Leg ──────────────────────────────────────────────────────────
  {
    id: "lost-foot-leg",
    name: "Lost Foot/Leg",
    img: "icons/svg/downgrade.svg",
    hudVisible: false,
    description:
      `<p>The character has had their leg severed somewhere between the ankle and the hip and suffers the following penalties.</p>` +
      `<ul>` +
      `<li>Gain the slowed condition permanently.</li>` +
      `<li>All tests that rely on the use of two legs are made with a -20 penalty.</li>` +
      `<li>If both legs are lost, gain the Immobilized condition permanently and fail any tests that rely entirely on movement.</li>` +
      `</ul>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Lost Hand/Arm ──────────────────────────────────────────────────────────
  {
    id: "lost-hand-arm",
    name: "Lost Hand/Arm",
    img: "icons/svg/sword.svg",
    hudVisible: false,
    description:
      `<p>The character has had their arm severed somewhere between the wrist and the shoulder, and suffers the following penalties:</p>` +
      `<ul>` +
      `<li>Can no longer use two-handed weapons, shields (if the whole arm is missing), or one handed weapons in that arm.</li>` +
      `<li>All tests that rely on the use of two hands are made with a -20 penalty.</li>` +
      `<li>If both hands are lost, the character cannot wield weapons and automatically fails all tests that rely on the use of hands.</li>` +
      `</ul>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Muffled (X) ────────────────────────────────────────────────────────────
  {
    id: "muffled",
    name: "Muffled (X)",
    img: "icons/svg/sound-off.svg",
    hudVisible: false,
    description:
      `<p>A character with this condition is harder to hear. Hearing based tests to detect this character are made with a -X penalty. Only apply the highest value version of this condition if a character would receive it more than once.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Organ Damage ───────────────────────────────────────────────────────────
  {
    id: "organ-damage",
    name: "Organ Damage",
    img: "icons/svg/hazard.svg",
    hudVisible: false,
    description:
      `<p>The character has had their internal organs damaged. Characters with this condition heal damage at half speed and reduce their SP maximum and WT by 1.</p>` +
      `<p><strong>Optional Rule Note: Alternate Wounds</strong> — If you're using the rules for Alternate Wounds; instead of reducing WT by 1, increase the passive wound penalty to all tests to -30.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Paralyzed ──────────────────────────────────────────────────────────────
  {
    id: "paralyzed",
    name: "Paralyzed",
    img: "icons/svg/paralysis.svg",
    hudVisible: true,
    description:
      `<p>The character is frozen, unable to move any part of their body. They may only cast spells that do not require speech or motion.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Prone ──────────────────────────────────────────────────────────────────
  {
    id: "prone",
    name: "Prone",
    img: "icons/svg/falling.svg",
    hudVisible: true,
    description:
      `<p>The character is prone, and every 1 meter that they move while prone costs 2 meters of their movement for the round. They also suffer a -20 penalty to all combat related tests and count any full armor they are wearing as partial (to represent that it is easier for characters to take advantage of gaps in their defenses while they are down).</p>` +
      `<p>Dropping prone costs no movement, but standing up requires that a character spend movement equal to half of their base Speed. If the character does not have this much movement left over to use, then they cannot get up unless they take the Arise action.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Restrained ─────────────────────────────────────────────────────────────
  {
    id: "restrained",
    name: "Restrained",
    img: "icons/svg/anchor.svg",
    hudVisible: true,
    description:
      `<p>The character is restrained and thus unable to move. They also cannot attack or defend themselves. They may only cast spells that do not require motion.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Silenced ───────────────────────────────────────────────────────────────
  {
    id: "silenced",
    name: "Silenced",
    img: "icons/svg/sound-off.svg",
    hudVisible: true,
    description:
      `<p>Magically silenced characters believe they are making sound, but in reality their words never pass their lips. They suffer the usual -20 penalty for being unable to speak when casting spells. At the start of each round they can roll a Perception test to see if they realize what is happening.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Slowed ─────────────────────────────────────────────────────────────────
  {
    id: "slowed",
    name: "Slowed",
    img: "icons/svg/wingfoot.svg",
    hudVisible: true,
    description:
      `<p>The character's Speed is reduced by half (round up).</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Stunned ────────────────────────────────────────────────────────────────
  {
    id: "stunned",
    name: "Stunned",
    img: "icons/svg/stoned.svg",
    hudVisible: true,
    description:
      `<p>The character immediately loses all remaining Action Points upon becoming stunned. Stunned characters do not regain Action Points at the start of each round.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Unconscious ────────────────────────────────────────────────────────────
  {
    id: "unconscious",
    name: "Unconscious",
    img: "icons/svg/unconscious.svg",
    hudVisible: true,
    description:
      `<p>The character is knocked out and loses consciousness. They fall prone if the circumstances allow and may not take actions. If a character gains a level of fatigue while unconscious, they die.</p>`,
    rulesRef: { chapter: "Chapter 5 - Advanced Mechanics", section: "Conditions" }
  },

  // ── Flanked (X) (Homebrew — Engagement & Flanking) ─────────────────────────
  {
    id: "flanked",
    name: "Flanked (X)",
    img: "icons/svg/target.svg",
    hudVisible: true,
    description:
      `<p>This combatant is under coordinated melee pressure. <strong>Flanked (X)</strong> is auto-calculated as:</p>` +
      `<p><code>max(Enemies Threatening - Engagement Score - Ally Support, 0)</code></p>` +
      `<p>Ally Support is contributed by allies who threaten the same enemies; each enemy can be canceled only once.</p>` +
      `<p>Attackers gain <strong>+5 TN per X</strong> on melee attacks and melee combat maneuvers against this target.</p>` +
      `<p><em>Homebrew — Engagement &amp; Flanking. This status is automated and should not be toggled manually.</em></p>`,
    rulesRef: { chapter: "Homebrew — Engagement & Flanking", section: "Flanked (X)" }
  },

  // ── In Close (Homebrew — Reach & Length Overhaul) ──────────────────────────
  {
    id: "inclose",
    name: "In Close",
    img: "icons/svg/combat.svg",
    hudVisible: true,
    description:
      `<p>This combatant is engaged In Close with one or more opponents (within 1 m). While In Close, the <strong>longer</strong> weapon suffers the Length Penalty instead of the shorter weapon. Apply the <em>In Close</em> status when combatants close to within 1 m via the Close In manoeuvre or by moving adjacent.</p>` +
      `<p><em>Homebrew — Reach &amp; Length Overhaul. Requires the "Enable Reach &amp; Length Overhaul" setting to be active.</em></p>`,
    rulesRef: { chapter: "Homebrew — Reach & Length Overhaul", section: "In Close" }
  }

]);


// ─────────────────────────────────────────────────────────────────────────────
// Lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map of condition id → full HTML description. */
export const CONDITION_DESCRIPTIONS = Object.freeze(
  new Map(CONDITIONS_DATASET.map(c => [c.id, c.description]))
);

/** Map of condition id → full condition entry. */
const CONDITIONS_BY_ID = Object.freeze(
  new Map(CONDITIONS_DATASET.map(c => [c.id, c]))
);
