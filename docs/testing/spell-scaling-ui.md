# Spell Scaling UI Test Steps

1. Open a spell item sheet and go to the Attributes tab.
2. In Scaling Levels, add a level and edit Level, Cost, Damage Formula, Duration value/unit, and Description. Verify the dropdown stays open while selecting and the sheet does not rerender mid-selection.
3. Close the spell sheet and reopen it. Confirm scaling values persist and the scaling table is shown.
4. Refresh the browser/world and reopen the same spell. Confirm scaling values still persist.
5. Change several scaling fields quickly (e.g., Level and Duration unit). Confirm no values are lost and no validation dialogs appear during mid-edit.
6. Verify permissions:
   - As GM or owner, scaling inputs and add/remove buttons are editable.
   - As a non-owner/readonly user, scaling inputs and add/remove buttons are disabled.
