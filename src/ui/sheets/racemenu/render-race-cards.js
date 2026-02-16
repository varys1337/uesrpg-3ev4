export function renderRaceCards(races) {
    const raceCards = [];
    for (const raceKey in races) {
        const race = races[raceKey];
        raceCards.push(renderRaceCard(raceKey, race));
    }
    return raceCards;
}

function renderRaceCard(raceKey, race) {
    const traits = renderTraits(race.traits);
    const baselineCells = renderBaselineCells(race.baseline);
    const inputId = `race-${toSlug(raceKey)}`;
    return `
        <div class="menu-card">
            <input type="radio" class="raceSelect" id="${inputId}" name="raceRadio" value="${raceKey}">
            ${race.img ? `<img class="card-portrait" src="${race.img}" alt="${race.name}" height="100" width="70">` : ''}
            <div class="card-body">
                <div class="card-actions">
                    <label for="${inputId}" class="card-btn">${race.name}</label>
                </div>
                <table class="baseline-table">
                    <thead>
                        <tr><td class="baseline-header" colspan="7">Characteristic Baseline</td></tr>
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
        baselineCellsList.push(`<td>${baseValue}</td>`)
    }
    return baselineCellsList.join('');
}

function renderTraits(traits) {
    const traitList = [];
    for (const trait of traits) {
        traitList.push(`<li>${trait}</li>`)
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
