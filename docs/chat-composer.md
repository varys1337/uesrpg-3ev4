# Compact chat composer

Open **Game Settings → Configure Settings → UESRPG → Configure Interface**, enable **Chat: Hide Formatting Toolbar**, and save. The option hides the chat formatting toolbar and removes its reserved space. Clear the option and save to restore the normal presentation.

The toolbar is **visible by default**. This is a Foundry user-scoped preference: each player and GM chooses independently, and their saved choice follows their user in that world. It applies at setup and immediately when saved, without reloading or rebuilding the editor. The native chat editor, commands, formatting shortcuts, message-mode buttons, and existing chat actions remain available. The stylesheet targets chat input only, including the sidebar, chat popout within the main window, and notification composer.

Players can now open Interface settings to change personal preferences. World settings remain available only to GMs; the form handler independently filters unauthorized and unknown fields before writing. Existing settings keep their original client or world scopes.

## Oliver's Foundry Tweaks

This feature operates independently of Oliver's Foundry Tweaks (OFT). The system does not read, import, or change OFT settings. If OFT's own **Hide Chat Text Menu** option is enabled, it may continue hiding the toolbar when the UESRPG option is off. Disable the OFT option when using the system toggle as the sole control, or disable OFT while verifying this feature.

## Manual acceptance

These live checks are **not yet performed**. Use Foundry 14.368 or a later v14 build in a disposable world, with OFT's equivalent option disabled first.

| Done | Check | Expected result |
| --- | --- | --- |
| [ ] | Open Interface as a user with no saved preference. | The new checkbox is clear and the formatting toolbar is visible. |
| [ ] | Enable the option and save. | Only the chat formatting toolbar disappears; no empty toolbar band remains. |
| [ ] | Type an unsent draft, then disable the option and save. | The normal toolbar returns and the draft remains intact. |
| [ ] | Reload after enabling, then compare a second user with the option disabled. | Each user retains their own choice. Changing one does not change the other. |
| [ ] | Open Interface as a player and save personal settings. | Personal settings save normally. System Font, startup dialog, loadouts, and custom cursor world settings are absent. |
| [ ] | In a controlled development check, submit a forged world-setting or unknown field as a player. | The form handler ignores unauthorized fields and does not call the setting writer for them. |
| [ ] | Open Interface as a GM and save existing world and personal settings. | Existing settings remain available. Unchanged values are not written again. |
| [ ] | Submit chat, use a slash command, enter multiple lines, and use a formatting shortcut. | Native input behavior remains available with the toolbar hidden. |
| [ ] | Use message modes and existing chat actions, including GM export and clear controls. | Controls remain visible and behave as before. |
| [ ] | Check sidebar, main-window chat popout, and focused/unfocused notification input at 100%, 150%, and 200% scaling. | No residual toolbar gap, clipping, or unbounded growth appears. |
| [ ] | Open Item and journal rich-text editors. | Their formatting menus are unchanged. |
| [ ] | Re-enable OFT and its equivalent option, then turn the system option off. | OFT may still hide the toolbar; turning off both options restores normal presentation. |

Static validation uses `npm run lint` and `npm run validate`. No automated runtime tests or test framework are introduced. No package version or document schema changes are required.

## Source checkpoint

The pre-change source is saved in `release/backups/consolidation-20260925/07-before-chat-toolbar/`. The completed source is saved in `08-chat-toolbar/` beside it, with a change manifest and patch. These local backups are excluded from release packages.

Disabling the system option reverses its presentation changes immediately. A source rollback also restores the previous GM-only Interface menu; restoring source does not erase saved preferences. No release package or deployment is part of this update.
