// app-state.js
// Pure helpers derived from game state

function norm(s) {
    return String(s || "").toLowerCase().trim();
}

export function findPlayerByName(state, name) {
    return (state?.players || []).find(
        (p) => norm(p.name) === norm(name)
    );
}

export function amHost(state, myName) {
    return norm(state?.host) === norm(myName);
}

export function amActivePlayer(state, myName) {
    return norm(state?.game?.activePlayer) === norm(myName);
}

export function myTokenCount(state, myName) {
    return Number(findPlayerByName(state, myName)?.tokens ?? 0);
}

export function secondsLeft(state) {
    const t = state?.game?.challengeEndsAt;
    return t ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : 0;
}

export function myExistingChallengeIndex(state, myName) {
    const c = (state?.game?.challenges || []).find(
        (x) => norm(x.name) === norm(myName)
    );
    return c ? Number(c.placementIndex) : null;
}

export function getChallengeMap(state) {
    const m = new Map();
    for (const c of state?.game?.challenges || []) {
        const i = Number(c.placementIndex);
        if (!m.has(i)) m.set(i, []);
        m.get(i).push(c.name);
    }
    return m;
}

export function isSlotDisabledForMe(state, myName, idx) {
    if (Number(state?.game?.activeGuessIndex) === idx) return true;
    for (const c of state?.game?.challenges || []) {
        if (norm(c.name) !== norm(myName) && Number(c.placementIndex) === idx)
            return true;
    }
    return false;
}
