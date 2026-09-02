> [!WARNING]
> ## AI-Assisted Development Disclaimer
>
> This Foundry VTT system was developed with extensive AI assistance across implementation, debugging, testing, and code-side review workflows.
>
> The author does not personally understand or can explain every component of the shipped codebase; nevertheless, full responsibility for all code included in this project as well as its maintainenace is accepted by the author. Software execution was heavily AI-assisted, but package direction, architecture oversight, UX intent, and release responsibility were human-led. The author’s role in this project was primarily that of project lead and UX designer: defining the system vision, directing the workflow, setting priorities, shaping feature scope, making high-level architectural decisions, and determining the user-experience design of the final system.
>
> Some visual UI elements and presentation assets were assembled from licensed or stock source materials and manually edited by the author. Where AI-assisted visual processing was used, it was both limited to post-processing and editing of human-made source assets rather or standalone AI-originated prepared artwork.

# UESRPG 3e v4 - Automation and QoL 
This system is a fork of the original uesrpg d100 system created by DogBoneZone at https://gitlab.com/DogBoneZone/uesrpg-3e and the earlier compatibility fork at https://github.com/jamesjtb/uesrpg-3ev4. This fork targets Foundry VTT v14.363 and later v14 builds only, and is verified against v14.367.

This specific fork has advanced combat automation, active effects implementation and other up to date features of the current Foundry VTT iteration. 

A system and a few compendiums used to play the UESRPG game. Special thanks to 2Minute Tabletop and to drhodesw for the tokens and help creating the compendiums.

Express permission to use the artwork and tokens included in the compendiums of this system was given by 2MinuteTabletop and the copyright holder.

You can find the lively UESRPG Discord Community here: https://discord.gg/KAkXdf9

Documentation:
- Localization guide: [docs/Localization.md](docs/Localization.md)

## Ready release folder

Run `build-release-folder.cmd` on Windows, or run `npm run build:folder` from a terminal.

The command validates the source and creates a ready-to-install Foundry system at `dist/uesrpg-3ev4`. The folder contains only runtime files required by the system; development dependencies, automation, repository metadata, and transient compendium lock/log files are excluded.

## Publishing a GitHub release

The package version is plain SemVer (for example, `14.0.8`); only the Git tag has the `v` prefix (`v14.0.8`). Publish releases from a clean branch with:

```powershell
npm ci
npm run build:release
npm version patch
git push origin main --follow-tags
```

`npm version patch` synchronizes `package.json`, `package-lock.json`, and `system.json`, including the version-specific Foundry download URL. The pushed tag starts the GitHub Actions workflow, which rebuilds the validated runtime folder, verifies that the tag matches the package version, creates `uesrpg-3ev4.zip`, validates its contents, and uploads both the ZIP and `system.json` to the matching GitHub Release.

Do not create or reuse a release tag whose version differs from `package.json`, and do not edit the manifest download URL by hand. The release validator rejects either discrepancy.
