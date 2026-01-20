// server/deck.js
// Song normalization + shuffle helper

function normalizeSong(s, idHint) {
    const title = String(s.title || "").trim();
    const year = Number(s.year);

    const artists = Array.isArray(s.artists)
        ? s.artists.map((a) => String(a).trim()).filter(Boolean)
        : String(s.artists || "")
            .split(";")
            .map((a) => a.trim())
            .filter(Boolean);

    const youtube_query = String(s.youtube_query || `${title} ${artists.join(" ")}`).trim();

    // NEW: accept pre-filled youtubeId
    const rawId = s.youtubeId ?? s.youtube_id ?? null;
    const youtubeId =
        rawId && /^[a-zA-Z0-9_-]{11}$/.test(String(rawId)) ? String(rawId) : null;

    return {
        id: String(s.id || idHint || `${title}-${year}`),
        title,
        year,
        artists,
        youtube_query,
        youtubeId, // NEW
    };
}

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

module.exports = {
    normalizeSong,
    shuffleInPlace,
};
