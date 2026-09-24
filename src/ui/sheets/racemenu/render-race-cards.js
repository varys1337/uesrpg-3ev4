import { t } from "../../../utils/i18n.js";

export function renderRaceCards(races, { idPrefix = "uesrpg-race" } = {}) {
    const raceCards = [];
    for (const raceKey in races) {
        const race = races[raceKey];
        raceCards.push(renderRaceCard(raceKey, race, idPrefix));
    }
    return raceCards;
}

function renderRaceCard(raceKey, race, idPrefix) {
    const traits = renderTraits(race.traits);
    const baselineCells = renderBaselineCells(race.baseline);
    const inputId = `${toSlug(idPrefix)}-race-${toSlug(raceKey)}`;
    const escapedRaceKey = foundry.utils.escapeHTML(raceKey);
    const escapedName = foundry.utils.escapeHTML(race.name);
    const escapedImage = foundry.utils.escapeHTML(race.img);
    return `
        <div class="menu-card">
            <input type="radio" class="raceSelect" id="${inputId}" name="raceRadio" value="${escapedRaceKey}">
            <span class="menu-card__selected" aria-hidden="true"></span>
            ${race.img ? `<img class="card-portrait" src="${escapedImage}" alt="${escapedName}" height="100" width="70">` : ''}
            <div class="card-body">
                <div class="card-actions">
                    <label for="${inputId}" class="card-btn">${escapedName}</label>
                </div>
                <table class="baseline-table">
                    <thead>
                        <tr><td class="baseline-header" colspan="7">${t("UESRPG.Apps.CharGen.CharacteristicBaseline")}</td></tr>
                        <tr>
                            <th>STR</th><th>END</th><th>AGI</th><th>INT</th><th>WP</th><th>PRC</th><th>PRS</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>${baselineCells}</tr>
                    </tbody>
                </table>
                <ul class="card-traits">${traits}</ul>
            </div>
        </div>`;
}

function renderBaselineCells(baseline) {
    const baselineCellsList = [];
    for (let char in baseline) {
        const baseValue = baseline[char];
        baselineCellsList.push(`<td>${Number(baseValue) || 0}</td>`)
    }
    return baselineCellsList.join('');
}

function renderTraits(traits) {
    const traitList = [];
    for (const trait of traits) {
        traitList.push(`<li>${foundry.utils.escapeHTML(trait)}</li>`)
    }
    return traitList.join('');
}

function toSlug(value) {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
