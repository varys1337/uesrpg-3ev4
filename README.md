> [!WARNING]
> ## AI-Assisted Development Disclaimer
>
> This Foundry VTT system was developed with extensive AI assistance across implementation, debugging, testing, and code-side review workflows.
>
> The author does not personally understand or cannot explain every component of the shipped codebase; nevertheless, the author accepts full responsibility for all code included in this project and its maintenance. Software execution was heavily AI-assisted, but package direction, architecture oversight, UX intent, and release responsibility were human-led. The author's role in this project was primarily that of project lead and UX designer: defining the system vision, directing the workflow, setting priorities, shaping feature scope, making high-level architectural decisions, and determining the user-experience design of the final system.
>
> Some visual UI elements and presentation assets were assembled from licensed or stock source materials and manually edited by the author. Where AI-assisted visual processing was used, it was limited to post-processing and editing human-made source assets rather than generating standalone artwork.

# UESRPG 3e v4 - Automation and QoL 
This system is a fork of the original uesrpg d100 system created by DogBoneZone at https://gitlab.com/DogBoneZone/uesrpg-3e and the earlier compatibility fork at https://github.com/jamesjtb/uesrpg-3ev4. This fork targets Foundry VTT v14.368 and later v14 builds only. The manifest retains its existing verified build of v14.368; source changes require the live acceptance checks in [the consolidation checklist](docs/consolidation-acceptance.md) before deployment.

This specific fork has advanced combat automation, active effects implementation and other up to date features of the current Foundry VTT iteration. 

A system and a few compendiums used to play the UESRPG game. Special thanks to 2Minute Tabletop and to drhodesw for the tokens and help creating the compendiums.

Express permission to use the artwork and tokens included in the compendiums of this system was given by 2MinuteTabletop and the copyright holder.

You can find the lively UESRPG Discord Community here: https://discord.gg/KAkXdf9

Documentation:

- [Architecture and support handbook](docs/architecture.md)
- [Testing and current native acceptance procedures](docs/testing.md)
- [Localization guide](docs/Localization.md)
- [Release and deployment guide](docs/Release.md)
- [Consolidation implementation audit](docs/consolidation-audit.md)
- [Live Foundry acceptance checklist](docs/consolidation-acceptance.md)
- [Compact chat composer preference](docs/chat-composer.md)

## Ready release folder

Run `build-release-folder.cmd` on Windows, or run `npm run build:folder` from a terminal.

The command validates the source and creates a ready-to-install Foundry system at `dist/uesrpg-3ev4`. The folder contains only runtime files required by the system; development dependencies, automation, repository metadata, and transient compendium lock/log files are excluded.

Use Node.js 24 for local validation and release builds. Follow the [canonical testing guide](docs/testing.md) for locked dependency installation, `npm test`, lint, syntax, schema, catalog and source-validation checks. Source validation does not establish native acceptance; use the [release and deployment guide](docs/Release.md) for the separate build and publishing workflow.

## Installation and update source

Use this fork's stable manifest URL to install or reinstall the system in Foundry:

https://github.com/varys1337/uesrpg-3ev4/releases/latest/download/system.json

The system ID remains `uesrpg-3ev4`. The upstream system uses the same ID and is listed in Foundry's package directory. A user has reported that Foundry's Update System action replaced this fork with the upstream release. The cause is not yet confirmed; the release manifest checks do not prevent this behavior.

Until the update behavior is resolved, avoid Foundry's Update System and Update All actions for this system. To restore or update the fork, first back up your worlds and the installed system, including any system-local data. Install the desired fork release using its manifest URL or its ZIP from this fork's GitHub Releases. Do not launch a world with an unintended system version; restore the matching world backup if it was opened with the upstream system and its data may have changed.

After installation, inspect `Data/systems/uesrpg-3ev4/system.json` in your Foundry user-data directory. Its `version` must match the intended fork release, its `manifest` must be the stable fork URL above, and its `download` must point to that version's ZIP under `https://github.com/varys1337/uesrpg-3ev4/releases/download/`. Changing only the manifest URL does not replace upstream files with the fork. Native update behavior remains unverified; do not assume a matching manifest prevents Foundry from selecting the upstream package.
