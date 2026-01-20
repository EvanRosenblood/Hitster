// server/youtube-search.js
// Server-side: resolve YouTube videoId from a search query (no API key).
// CommonJS module (works with require()).
// This version DOES NOT rely on global fetch (works on Node <18 too).

const https = require("https");

const youtubeIdCache = new Map();

/**
 * Minimal HTTPS GET that returns response text.
 * Uses Accept-Encoding: identity so we don't have to deal with gzip/br.
 */
function getText(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            url,
            {
                method: "GET",
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                    Accept:
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Encoding": "identity",
                    ...headers,
                },
            },
            (res) => {
                // redirects
                if (
                    res.statusCode &&
                    res.statusCode >= 300 &&
                    res.statusCode < 400 &&
                    res.headers.location
                ) {
                    const nextUrl = res.headers.location.startsWith("http")
                        ? res.headers.location
                        : new URL(res.headers.location, url).toString();
                    res.resume();
                    return resolve(getText(nextUrl, headers));
                }

                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    return resolve(null);
                }

                let data = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => resolve(data));
            }
        );

        req.on("error", reject);
        req.end();
    });
}

function extractVideoIds(html) {
    if (!html) return [];

    const ids = [];

    const watchRe = /watch\?v=([a-zA-Z0-9_-]{11})/g;
    let m;
    while ((m = watchRe.exec(html)) !== null) ids.push(m[1]);

    const vidRe = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
    while ((m = vidRe.exec(html)) !== null) ids.push(m[1]);

    const seen = new Set();
    const unique = [];
    for (const id of ids) {
        if (!seen.has(id)) {
            seen.add(id);
            unique.push(id);
        }
    }
    return unique;
}

function buildCleanAudioQuery(original) {
    const q = String(original || "").trim();
    if (!q) return "";

    const lower = q.toLowerCase();
    const alreadyHinted =
        lower.includes("official audio") ||
        lower.includes(" lyrics") ||
        lower.includes("lyric") ||
        lower.includes(" topic") ||
        lower.includes(" audio");

    const prefer = alreadyHinted
        ? ""
        : ' "official audio" OR lyrics OR "lyric video" OR "audio" OR topic';

    const exclude =
        " -live -cover -remix -reaction -sped -slowed -instrumental -karaoke -8d -nightcore -tiktok";

    const extra = lower.includes("hq") ? "" : " hq";

    return `${q}${prefer}${extra}${exclude}`.trim();
}

function buildTopicFirstQuery(original) {
    const q = String(original || "").trim();
    if (!q) return "";
    const lower = q.toLowerCase();
    // explicitly bias toward YouTube "Artist - Topic" uploads
    const add = lower.includes("topic") ? "" : " topic";
    const exclude =
        " -live -cover -remix -reaction -sped -slowed -instrumental -karaoke -8d -nightcore -tiktok";
    return `${q}${add}${exclude}`.trim();
}

async function searchYoutubeFirstId(query) {
    const q = String(query || "").trim();
    if (!q) return null;

    const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
    const html = await getText(url);
    const candidates = extractVideoIds(html);
    return candidates.length ? candidates[0] : null;
}

async function resolveYoutubeIdFromQuery(query) {
    const original = String(query || "").trim();
    if (!original) return null;

    if (youtubeIdCache.has(original)) return youtubeIdCache.get(original);

    const topicFirst = buildTopicFirstQuery(original);
    const clean = buildCleanAudioQuery(original);

    try {
        // 1) try Topic bias first (often the cleanest)
        let id = await searchYoutubeFirstId(topicFirst);

        // 2) then try clean-audio query (official audio/lyrics/etc.)
        if (!id && clean && clean !== original) {
            id = await searchYoutubeFirstId(clean);
        }

        // 3) final fallback: original query
        if (!id) {
            id = await searchYoutubeFirstId(original);
        }

        youtubeIdCache.set(original, id);

        if (youtubeIdCache.size > 3000) {
            const firstKey = youtubeIdCache.keys().next().value;
            youtubeIdCache.delete(firstKey);
        }

        return id;
    } catch {
        youtubeIdCache.set(original, null);
        return null;
    }
}

module.exports = {
    youtubeIdCache,
    resolveYoutubeIdFromQuery,
};
