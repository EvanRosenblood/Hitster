// DEV-ONLY: run when adding new songs OR improving existing youtubeIds
//
// tools/populate-youtube-ids.js
// Script to add youtubeId to server/songs.json OR (optionally) upgrade "bad" ids.
//
// Usage (from project root):
//   node tools/populate-youtube-ids.js
//
// Resume from a specific index (0-based):
//   node tools/populate-youtube-ids.js --start=120
//
// Tweak speed (ms delay between requests):
//   node tools/populate-youtube-ids.js --delay=2000
//
// Write to a new file instead of overwriting:
//   node tools/populate-youtube-ids.js --out=server/songs.withIds.json
//
// NEW (Option B):
//   Prefer "clean audio" sources and upgrade bad IDs:
//   node tools/populate-youtube-ids.js --prefer-clean=1
//
// Tune candidate testing:
//   node tools/populate-youtube-ids.js --prefer-clean=1 --maxCandidates=10
//

const fs = require("fs");
const path = require("path");
const https = require("https");

const { normalizeSong } = require("../server/deck");
const { resolveYoutubeIdFromQuery } = require("../server/youtube-search");

const SONGS_IN = path.join(__dirname, "..", "server", "songs.json");

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (const a of args) {
        const m = a.match(/^--([^=]+)=(.*)$/);
        if (m) out[m[1]] = m[2];
        else if (a.startsWith("--")) out[a.slice(2)] = true;
    }
    return out;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isValidId(x) {
    return !!x && /^[a-zA-Z0-9_-]{11}$/.test(String(x));
}

function safeReadJson(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error("songs.json must be an array");
    return data;
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Heuristic: if we get too many consecutive failures, YouTube likely blocked us.
function shouldStopEarly(consecutiveFails) {
    return consecutiveFails >= 8;
}

function normSpaces(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}

function buildFallbackQuery(song) {
    const title = normSpaces(song?.title);
    const artists = Array.isArray(song?.artists)
        ? song.artists.join(" ")
        : normSpaces(song?.artists);
    return normSpaces(`${title} ${artists}`);
}

/**
 * Minimal HTTPS GET returning text.
 * Uses Accept-Encoding: identity to avoid gzip/br handling.
 */
function getText(url) {
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
                    return resolve(getText(nextUrl));
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

async function searchTopIds(query, limit) {
    const q = normSpaces(query);
    if (!q) return [];
    const url =
        "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
    const html = await getText(url);
    const ids = extractVideoIds(html);
    return ids.slice(0, Math.max(1, limit | 0));
}

/**
 * Fetch watch page and extract title + channel-ish text (best-effort).
 * Cached to avoid re-fetching the same video across songs.
 */
const watchMetaCache = new Map(); // id -> { title, channel, raw }

function decodeHtmlEntities(s) {
    return String(s || "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function extractWatchMeta(html) {
    if (!html) return { title: "", channel: "" };

    // Prefer og:title if available
    let title = "";
    let channel = "";

    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i);
    if (ogTitle) title = decodeHtmlEntities(ogTitle[1]);

    if (!title) {
        const t = html.match(/<title>([^<]+)<\/title>/i);
        if (t) title = decodeHtmlEntities(t[1]).replace(/\s*-\s*YouTube\s*$/i, "");
    }

    // Best-effort channel name (varies by page)
    const ch1 = html.match(/"ownerChannelName":"([^"]+)"/i);
    if (ch1) channel = decodeHtmlEntities(ch1[1]);

    if (!channel) {
        const ch2 = html.match(/"channelName":"([^"]+)"/i);
        if (ch2) channel = decodeHtmlEntities(ch2[1]);
    }

    return { title: normSpaces(title), channel: normSpaces(channel) };
}

async function getWatchMeta(videoId) {
    const id = String(videoId || "");
    if (!isValidId(id)) return null;

    if (watchMetaCache.has(id)) return watchMetaCache.get(id);

    const url = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
    const html = await getText(url);

    const meta = extractWatchMeta(html);
    watchMetaCache.set(id, meta);

    // cache cap
    if (watchMetaCache.size > 4000) {
        const firstKey = watchMetaCache.keys().next().value;
        watchMetaCache.delete(firstKey);
    }

    return meta;
}

/**
 * Clean-audio scoring heuristic.
 * Higher score = better candidate.
 */
function scoreMeta(meta) {
    const t = (meta?.title || "").toLowerCase();
    const c = (meta?.channel || "").toLowerCase();
    const text = `${t} ${c}`;

    let score = 0;

    // Strong positives
    if (text.includes(" - topic") || c.includes("topic")) score += 80;
    if (text.includes("official audio")) score += 60;
    if (text.includes("audio")) score += 15;
    if (text.includes("lyrics") || text.includes("lyric video")) score += 35;
    if (text.includes("provided to youtube")) score += 35;
    if (text.includes("hq")) score += 8;

    // Negatives: likely intros / wrong versions
    if (text.includes("official video") || text.includes("music video")) score -= 60;
    if (text.includes("live")) score -= 50;
    if (text.includes("cover")) score -= 50;
    if (text.includes("remix")) score -= 35;
    if (text.includes("reaction")) score -= 60;
    if (text.includes("sped up") || text.includes("sped-up") || text.includes("sped")) score -= 60;
    if (text.includes("slowed")) score -= 60;
    if (text.includes("nightcore")) score -= 60;
    if (text.includes("instrumental")) score -= 40;
    if (text.includes("karaoke")) score -= 60;
    if (text.includes("8d")) score -= 40;
    if (text.includes("tiktok")) score -= 30;

    return score;
}

function looksCleanEnough(score) {
    // Tuneable threshold:
    // Topic/Official Audio should exceed this easily.
    return score >= 65;
}

function buildTopicQuery(original) {
    const q = normSpaces(original);
    if (!q) return "";
    const add = q.toLowerCase().includes("topic") ? "" : " topic";
    return normSpaces(
        `${q}${add} -live -cover -remix -reaction -sped -slowed -instrumental -karaoke -8d -nightcore -tiktok`
    );
}

function buildCleanAudioQuery(original) {
    const q = normSpaces(original);
    if (!q) return "";
    const lower = q.toLowerCase();
    const alreadyHinted =
        lower.includes("official audio") ||
        lower.includes("lyrics") ||
        lower.includes("lyric") ||
        lower.includes("topic") ||
        lower.includes(" audio");

    const prefer = alreadyHinted
        ? ""
        : ' "official audio" OR lyrics OR "lyric video" OR "audio" OR topic';

    return normSpaces(
        `${q}${prefer} hq -live -cover -remix -reaction -sped -slowed -instrumental -karaoke -8d -nightcore -tiktok`
    );
}

async function findBetterIdForSong(query, currentId, maxCandidates, perRequestPauseMs) {
    const base = normSpaces(query);
    if (!base) return null;

    // Build 3 queries and merge candidates (topic first is usually best)
    const q1 = buildTopicQuery(base);
    const q2 = buildCleanAudioQuery(base);
    const q3 = base;

    const merged = [];
    const seen = new Set();

    const addIds = async (q) => {
        const ids = await searchTopIds(q, maxCandidates);
        for (const id of ids) {
            if (!seen.has(id)) {
                seen.add(id);
                merged.push(id);
                if (merged.length >= maxCandidates) return;
            }
        }
    };

    await addIds(q1);
    if (merged.length < maxCandidates) await addIds(q2);
    if (merged.length < maxCandidates) await addIds(q3);

    // Score candidates by watch page meta
    let bestId = null;
    let bestScore = -9999;

    for (const id of merged) {
        // avoid pointless replacement with the same id
        // (still allow scoring it so we can compare)
        const meta = await getWatchMeta(id);
        if (perRequestPauseMs > 0) await sleep(perRequestPauseMs);

        const s = scoreMeta(meta);

        if (s > bestScore) {
            bestScore = s;
            bestId = id;
        }

        // Early exit if we found a *very* strong candidate
        if (bestScore >= 90) break;
    }

    // If best is the same as current, caller can decide to keep it.
    return bestId ? { id: bestId, score: bestScore } : null;
}

async function main() {
    const args = parseArgs();

    const startIndex = Math.max(0, Number(args.start ?? 0) || 0);
    const delayMs = Math.max(250, Number(args.delay ?? 1500) || 1500);
    const outPath = args.out
        ? path.isAbsolute(args.out)
            ? args.out
            : path.join(__dirname, "..", args.out)
        : SONGS_IN;

    const checkpointEvery = Math.max(1, Number(args.checkpoint ?? 5) || 5);

    const preferClean = String(args["prefer-clean"] ?? args.preferClean ?? "0") === "1";
    const maxCandidates = Math.max(3, Number(args.maxCandidates ?? 12) || 12);

    // When upgrading, we do extra requests per song; pause slightly between candidate meta fetches
    // to reduce burstiness.
    const perCandidatePauseMs = preferClean ? 250 : 0;

    if (!fs.existsSync(SONGS_IN)) {
        console.error("songs.json not found at:", SONGS_IN);
        process.exit(1);
    }

    let songs = safeReadJson(SONGS_IN);

    console.log("Input:", SONGS_IN);
    console.log("Output:", outPath === SONGS_IN ? "(overwrite) " + outPath : outPath);
    console.log("Start index:", startIndex);
    console.log("Delay:", delayMs, "ms");
    console.log("Checkpoint every:", checkpointEvery, "songs");
    console.log("Prefer clean audio:", preferClean ? "YES" : "no");
    console.log("Max candidates:", maxCandidates);
    console.log("");

    let filled = 0;
    let upgraded = 0;
    let skipped = 0;
    let failed = 0;

    let consecutiveFails = 0;
    let nextDelay = delayMs;

    let interrupted = false;
    process.on("SIGINT", () => {
        interrupted = true;
        console.log("\nCaught Ctrl+C. Will save progress and exit…");
    });

    for (let i = startIndex; i < songs.length; i++) {
        if (interrupted) break;

        const s = songs[i];
        const existing = s.youtubeId ?? s.youtube_id ?? null;
        const hasId = isValidId(existing);

        const normalized = normalizeSong(s, `s${i + 1}`);
        const query =
            normSpaces(normalized.youtube_query) || buildFallbackQuery(normalized);

        // Case 1: no ID -> fill normally
        if (!hasId) {
            process.stdout.write(`(${i + 1}/${songs.length}) Missing ID, searching: ${query} ... `);

            const id = await resolveYoutubeIdFromQuery(query);

            if (isValidId(id)) {
                songs[i] = { ...s, youtubeId: String(id) };
                filled++;
                consecutiveFails = 0;
                nextDelay = delayMs;
                console.log(`OK (${id})`);
            } else {
                failed++;
                consecutiveFails++;
                console.log("FAILED");

                nextDelay = Math.min(15000, Math.round(nextDelay * 1.6));
                console.log(`  Backoff: waiting ${nextDelay}ms (consecutive fails: ${consecutiveFails})`);

                if (shouldStopEarly(consecutiveFails)) {
                    console.log("\nStopping early: looks like YouTube is blocking/rate-limiting.");
                    console.log("Wait 30–120 minutes, then resume with:");
                    console.log(`  node tools/populate-youtube-ids.js --start=${i + 1} --delay=${delayMs}`);
                    break;
                }
            }

            // Save progress periodically
            if ((i + 1) % checkpointEvery === 0) {
                try {
                    writeJson(outPath, songs);
                    console.log(`  ✅ checkpoint saved to ${outPath}`);
                } catch (e) {
                    console.log("  ⚠️ checkpoint write failed:", e?.message || e);
                }
            }

            await sleep(nextDelay);
            continue;
        }

        // Case 2: has ID and preferClean is off -> skip
        if (!preferClean) {
            skipped++;
            continue;
        }

        // Case 3: has ID and preferClean is on -> evaluate + possibly upgrade
        const curId = String(existing);
        process.stdout.write(`(${i + 1}/${songs.length}) Checking ID ${curId} ... `);

        let curMeta = null;
        try {
            curMeta = await getWatchMeta(curId);
        } catch {
            curMeta = null;
        }

        const curScore = scoreMeta(curMeta);
        const isClean = looksCleanEnough(curScore);

        if (isClean) {
            skipped++;
            console.log(`keep (score ${curScore})`);
            // still wait a bit to avoid hammering
            await sleep(delayMs);
            continue;
        }

        console.log(`upgrade? (score ${curScore})`);

        try {
            // Find best candidate among top search results
            const best = await findBetterIdForSong(query, curId, maxCandidates, perCandidatePauseMs);
            if (!best || !isValidId(best.id)) {
                skipped++;
                consecutiveFails = 0;
                nextDelay = delayMs;
                console.log("  No better candidate found.");
            } else {
                // Only replace if it's meaningfully better
                const betterBy = best.score - curScore;
                if (best.id !== curId && best.score >= 35 && betterBy >= 15) {
                    songs[i] = { ...s, youtubeId: String(best.id) };
                    upgraded++;
                    console.log(`  ✅ upgraded to ${best.id} (score ${best.score}, +${betterBy})`);
                } else {
                    skipped++;
                    console.log(`  Keep current (best ${best.id} score ${best.score}, +${betterBy})`);
                }

                consecutiveFails = 0;
                nextDelay = delayMs;
            }
        } catch (e) {
            failed++;
            consecutiveFails++;
            console.log("  FAILED (search/verify)");

            nextDelay = Math.min(15000, Math.round(nextDelay * 1.6));
            console.log(`  Backoff: waiting ${nextDelay}ms (consecutive fails: ${consecutiveFails})`);

            if (shouldStopEarly(consecutiveFails)) {
                console.log("\nStopping early: looks like YouTube is blocking/rate-limiting.");
                console.log("Wait 30–120 minutes, then resume with:");
                console.log(
                    `  node tools/populate-youtube-ids.js --prefer-clean=1 --start=${i + 1} --delay=${delayMs}`
                );
                break;
            }
        }

        if ((i + 1) % checkpointEvery === 0) {
            try {
                writeJson(outPath, songs);
                console.log(`  ✅ checkpoint saved to ${outPath}`);
            } catch (e) {
                console.log("  ⚠️ checkpoint write failed:", e?.message || e);
            }
        }

        await sleep(nextDelay);
    }

    writeJson(outPath, songs);

    console.log("\nDone.");
    console.log("Filled:", filled);
    console.log("Upgraded:", upgraded);
    console.log("Skipped:", skipped);
    console.log("Failed:", failed);
    console.log("Wrote:", outPath);

    if (outPath === SONGS_IN) console.log("Note: songs.json updated in-place.");
    else console.log("Note: original songs.json unchanged.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
