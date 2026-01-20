// server/text-match.js
// Pure fuzzy matching helpers

function normText(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function isCloseEnough(guess, actual) {
    const g = normText(guess);
    const a = normText(actual);
    if (!g || !a) return false;
    if (g === a) return true;

    // len>=4 substring match (matches your existing behavior)
    if (g.length >= 4 && (a.includes(g) || g.includes(a))) return true;

    return false;
}

function artistGuessMatches(artistGuess, artistsArray) {
    const g = normText(artistGuess);
    if (!g) return false;
    for (const a of artistsArray || []) {
        if (isCloseEnough(g, a)) return true;
    }
    return false;
}

module.exports = {
    normText,
    isCloseEnough,
    artistGuessMatches,
};
