// tools/build-songs.js
// Usage: node tools/build-songs.js
//
// Reads songs.csv and writes songs.json (and server/songs.json if /server exists).
// Auto-builds a "clean audio" youtube_query to reduce music-video intros.
//
// CSV headers supported:
// title, artists, year, youtube_query (optional), youtubeId / youtube_id (optional)

const fs = require("fs");
const path = require("path");

function parseCSV(csvText) {
    // Basic CSV parser w/ quote support.
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const c = csvText[i];
        const next = csvText[i + 1];

        if (inQuotes) {
            if (c === '"' && next === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                inQuotes = false;
            } else {
                field += c;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
            } else if (c === ",") {
                row.push(field);
                field = "";
            } else if (c === "\n") {
                row.push(field);
                field = "";
                // ignore blank last line
                if (row.some((x) => String(x).trim() !== "")) rows.push(row);
                row = [];
            } else if (c === "\r") {
                // ignore CR
            } else {
                field += c;
            }
        }
    }

    // last line
    row.push(field);
    if (row.some((x) => String(x).trim() !== "")) rows.push(row);

    return rows;
}

function normSpaces(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}

function extractMainArtist(artistsRaw) {
    const s = normSpaces(artistsRaw);

    // common separators in your dataset
    const parts = s
        .split(/;|,|&| feat\.| featuring | ft\. | ft | x | and /i)
        .map((p) => normSpaces(p))
        .filter(Boolean);

    return parts[0] || s;
}

function buildCleanAudioQuery(title, artistsRaw) {
    const t = normSpaces(title);
    const mainArtist = extractMainArtist(artistsRaw);

    // Bias toward cleaner audio uploads (Topic/Official Audio/Lyrics)
    // and avoid alt versions.
    return normSpaces(
        `${t} ${mainArtist} official audio lyrics topic hq` +
        ` -live -cover -remix -reaction -sped -slowed -instrumental -karaoke -8d -nightcore -tiktok`
    );
}

function toYearNumber(v) {
    const n = Number(String(v || "").trim());
    return Number.isFinite(n) ? n : null;
}

function pickYoutubeId(v) {
    const raw = String(v || "").trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
    return null;
}

function writeJSONPretty(filepath, obj) {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

(function main() {
    const root = process.cwd();

    const csvPath = path.join(root, "songs.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("❌ songs.csv not found at:", csvPath);
        process.exit(1);
    }

    const csv = fs.readFileSync(csvPath, "utf8");
    const rows = parseCSV(csv);
    if (rows.length < 2) {
        console.error("❌ songs.csv has no data rows.");
        process.exit(1);
    }

    const headers = rows[0].map((h) => normSpaces(h).toLowerCase());
    const dataRows = rows.slice(1);

    const idxTitle = headers.indexOf("title");
    const idxArtists = headers.indexOf("artists");
    const idxYear = headers.indexOf("year");
    const idxYtQuery = headers.indexOf("youtube_query");
    const idxYtId = headers.indexOf("youtubeid");
    const idxYtId2 = headers.indexOf("youtube_id");

    if (idxTitle < 0 || idxArtists < 0 || idxYear < 0) {
        console.error("❌ songs.csv must have headers: title, artists, year (youtube_query optional)");
        console.error("   Found headers:", headers);
        process.exit(1);
    }

    const out = [];
    for (let i = 0; i < dataRows.length; i++) {
        const r = dataRows[i];

        const title = normSpaces(r[idxTitle]);
        const artists = normSpaces(r[idxArtists]);
        const year = toYearNumber(r[idxYear]);

        if (!title || !artists || year === null) continue;

        // Always generate a clean-audio query (keeps your dataset consistent)
        const youtube_query = buildCleanAudioQuery(title, artists);

        const youtubeId = pickYoutubeId(
            idxYtId >= 0 ? r[idxYtId] : idxYtId2 >= 0 ? r[idxYtId2] : ""
        );

        const obj = { title, artists, year, youtube_query };
        if (youtubeId) obj.youtubeId = youtubeId;

        out.push(obj);
    }

    // Write songs.json at root (handy for you)
    const rootJson = path.join(root, "songs.json");
    writeJSONPretty(rootJson, out);

    // Also write to server/songs.json if server/ exists (your server loads from there)
    const serverDir = path.join(root, "server");
    if (fs.existsSync(serverDir) && fs.statSync(serverDir).isDirectory()) {
        const serverJson = path.join(serverDir, "songs.json");
        writeJSONPretty(serverJson, out);
        console.log(`✅ Wrote ${out.length} songs to: songs.json AND server/songs.json`);
    } else {
        console.log(`✅ Wrote ${out.length} songs to: songs.json`);
    }
})();
