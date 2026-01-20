// server/game-engine.js
// Game rules + timers. No direct room lookup here; caller passes room + roomCode.

const { normalizeSong, shuffleInPlace } = require("./deck");
const { isCloseEnough, artistGuessMatches } = require("./text-match");
const { resolveYoutubeIdFromQuery } = require("./youtube-search");

const AUDIO_START_BUFFER_MS = 800;

function getActivePlayer(room) {
    return room.players[room.game.turnIndex] || null;
}

/**
 * Returns the allowed placement range for a card, given a timeline.
 * Placement index is an insertion position in [0..timeline.length].
 *
 * If the card's year matches existing cards, any position within the equal-year block is valid.
 * Example timeline years: [1999, 2001, 2001, 2004]
 * New card year 2001 => allowed min=1, max=3 (anywhere among the 2001s)
 */
function correctInsertionRange(timeline, card) {
    const y = Number(card?.year);
    const n = timeline.length;

    // Find first index with year >= y
    let firstGE = 0;
    while (firstGE < n && Number(timeline[firstGE].year) < y) firstGE++;

    // Find first index with year > y
    let firstGT = firstGE;
    while (firstGT < n && Number(timeline[firstGT].year) <= y) firstGT++;

    // Valid insertion positions:
    // - If no equals, firstGE === firstGT and only that single slot is valid
    // - If equals exist, any insertion position from firstGE..firstGT is valid
    return { min: firstGE, max: firstGT };
}

/**
 * Stable insert choice: after the last card with the same year.
 * That is, insert at range.max.
 */
function insertIntoTimelineSorted(timeline, card) {
    const r = correctInsertionRange(timeline, card);
    const idx = r.max;
    const newTl = timeline.slice();
    newTl.splice(idx, 0, card);
    return newTl;
}

function drawNextCard(room) {
    if (!room.game.deck || room.game.deck.length === 0) return null;
    return room.game.deck.shift();
}

function advanceTurn(room) {
    if (!room.players.length) return;
    room.game.turnIndex = (room.game.turnIndex + 1) % room.players.length;
}

function clearChallengeTimer(room) {
    if (room.game.challengeTimer) {
        clearTimeout(room.game.challengeTimer);
        room.game.challengeTimer = null;
    }
}

function pickYoutubeIdForCard(card) {
    const id = card?.youtubeId;
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(String(id))) return String(id);
    return null;
}

// Caller provides io + broadcastRoom, so this module stays “rules-only”
function resolveReveal({ room, roomCode, io, broadcastRoom }) {
    const active = getActivePlayer(room);
    const card = room.game.currentCard;
    if (!active || !card) return;

    const activeTimeline = active.timeline || [];
    const range = correctInsertionRange(activeTimeline, card);

    const activeChosenIdx = Number(room.game.activeGuess?.placementIndex);
    const activePlacementCorrect =
        Number.isFinite(activeChosenIdx) &&
        activeChosenIdx >= range.min &&
        activeChosenIdx <= range.max;

    let winnerName = null;
    let winnerPlayer = null;
    let winnerType = null; // "active" | "challenger"

    if (activePlacementCorrect) {
        winnerName = active.name;
        winnerPlayer = active;
        winnerType = "active";
    } else if (!room.game.singleplayer) {
        const correctChalls = (room.game.challenges || [])
            .filter((c) => {
                const pi = Number(c.placementIndex);
                return Number.isFinite(pi) && pi >= range.min && pi <= range.max;
            })
            .sort((a, b) => Number(a.at) - Number(b.at));

        if (correctChalls.length > 0) {
            const w = correctChalls[0];
            winnerName = w.name;
            winnerPlayer = room.players.find(
                (p) => p.name.toLowerCase() === String(w.name).toLowerCase()
            );
            winnerType = "challenger";
        }
    }

    const titleOk = isCloseEnough(room.game.activeGuess?.titleGuess, card.title);
    const artistOk = artistGuessMatches(room.game.activeGuess?.artistGuess, card.artists);

    // Token ONLY if active got: placement + title + artist correct
    let tokenAwarded = false;
    if (winnerType === "active" && titleOk && artistOk && activePlacementCorrect) {
        active.tokens = Number(active.tokens ?? 0) + 1;
        tokenAwarded = true;
    }

    if (winnerPlayer) {
        winnerPlayer.timeline = insertIntoTimelineSorted(winnerPlayer.timeline || [], card);
    }

    const challengeResults = room.game.singleplayer
        ? []
        : (room.game.challenges || []).map((c) => {
            const pi = Number(c.placementIndex);
            const ok = Number.isFinite(pi) && pi >= range.min && pi <= range.max;
            return { name: c.name, placementIndex: c.placementIndex, correct: ok };
        });

    room.game.lastReveal = {
        song: { title: card.title, artists: card.artists, year: card.year },

        // NEW: show the valid range
        correctMinIndex: range.min,
        correctMaxIndex: range.max,

        activeChosenIndex: activeChosenIdx,
        activePlacementCorrect,
        titleOk,
        artistOk,
        tokenAwarded,
        winner: winnerName,
        winnerType,
        challengeResults,
    };

    clearChallengeTimer(room);
    room.game.phase = "WAIT_PLAY";
    room.game.youtubeId = null;
    room.game.challengeEndsAt = null;
    room.game.activeGuess = null;
    room.game.challenges = [];
    room.game.challengeSpent = {};

    io.to(roomCode).emit("audio:stop");

    room.game.currentCard = null;

    advanceTurn(room);
    room.game.currentCard = drawNextCard(room);
    room.game.cardNonce = (room.game.cardNonce || 0) + 1;

    broadcastRoom(roomCode);
}

function startGame({ room, SONGS, broadcastRoom, roomCode }) {
    if (!SONGS.length) return { ok: false, error: "No songs loaded on server" };

    const deck = SONGS.map((s, idx) => normalizeSong(s, `s${idx + 1}`));
    shuffleInPlace(deck);

    if (deck.length < room.players.length + 1) {
        return { ok: false, error: "Not enough songs to start." };
    }

    for (const p of room.players) {
        p.tokens = 2;
        p.timeline = [deck.shift()];
        p.timeline = p.timeline.slice().sort((a, b) => Number(a.year) - Number(b.year));
    }

    room.game.started = true;
    room.game.deck = deck;
    room.game.turnIndex = 0;
    room.game.phase = "WAIT_PLAY";
    room.game.youtubeId = null;
    room.game.lastReveal = null;

    room.game.activeGuess = null;
    room.game.challenges = [];
    room.game.challengeEndsAt = null;
    room.game.challengeSpent = {};
    clearChallengeTimer(room);

    room.game.currentCard = drawNextCard(room);
    room.game.cardNonce = (room.game.cardNonce || 0) + 1;

    broadcastRoom(roomCode);
    return { ok: true };
}

async function playTurn({ room, roomCode, socketId, io, broadcastRoom }) {
    if (!room.game.started) return { ok: false, error: "Game not started" };

    const active = getActivePlayer(room);
    if (!active) return { ok: false, error: "No active player" };
    if (socketId !== active.socketId) return { ok: false, error: "Only the active player can play" };

    if (!room.game.currentCard) return { ok: false, error: "No current card available" };
    if (room.game.phase !== "WAIT_PLAY") return { ok: false, error: "Not in play-ready phase" };

    const card = room.game.currentCard;

    let youtubeId = pickYoutubeIdForCard(card);
    if (!youtubeId) youtubeId = await resolveYoutubeIdFromQuery(card.youtube_query);

    if (!youtubeId) return { ok: false, error: "Could not find a playable YouTube result" };

    room.game.youtubeId = youtubeId;
    room.game.phase = "PLAYING";
    room.game.lastReveal = null;

    room.game.activeGuess = null;
    room.game.challenges = [];
    room.game.challengeEndsAt = null;
    room.game.challengeSpent = {};
    clearChallengeTimer(room);

    const startAt = Date.now() + AUDIO_START_BUFFER_MS;
    io.to(roomCode).emit("audio:play", { youtubeId, startAt });

    broadcastRoom(roomCode);
    return { ok: true };
}

async function swapTurn({ room, roomCode, socketId, io, broadcastRoom }) {
    if (!room.game.started) return { ok: false, error: "Game not started" };

    const active = getActivePlayer(room);
    if (!active) return { ok: false, error: "No active player" };
    if (socketId !== active.socketId) return { ok: false, error: "Only active player can skip" };

    if (room.game.phase !== "PLAYING") {
        return { ok: false, error: "You can only skip while the song is playing" };
    }

    if ((active.tokens ?? 0) < 1) return { ok: false, error: "Need 1 token to skip" };
    if (!room.game.deck.length) return { ok: false, error: "Deck empty" };

    active.tokens -= 1;

    io.to(roomCode).emit("audio:stop");

    room.game.currentCard = drawNextCard(room);
    room.game.cardNonce = (room.game.cardNonce || 0) + 1;

    room.game.activeGuess = null;
    room.game.challenges = [];
    room.game.challengeEndsAt = null;
    room.game.challengeSpent = {};
    clearChallengeTimer(room);

    const card = room.game.currentCard;

    let youtubeId = pickYoutubeIdForCard(card);
    if (!youtubeId) youtubeId = await resolveYoutubeIdFromQuery(card.youtube_query);

    if (!youtubeId) {
        room.game.youtubeId = null;
        room.game.lastReveal = { note: "Skipped, but could not find a YouTube result for the next song." };
        broadcastRoom(roomCode);
        return { ok: false, error: "Skipped, but next song could not be played" };
    }

    room.game.youtubeId = youtubeId;
    room.game.lastReveal = { note: "Skipped song (spent 1 token)." };

    const startAt = Date.now() + AUDIO_START_BUFFER_MS;
    io.to(roomCode).emit("audio:play", { youtubeId, startAt });

    broadcastRoom(roomCode);
    return { ok: true };
}

function buyCard({ room, roomCode, socketId, broadcastRoom }) {
    if (!room.game.started) return { ok: false, error: "Game not started" };

    const active = getActivePlayer(room);
    if (!active) return { ok: false, error: "No active player" };
    if (socketId !== active.socketId) return { ok: false, error: "Only active player can buy" };

    if (room.game.phase !== "WAIT_PLAY") {
        return { ok: false, error: "You can only buy before you press Play" };
    }

    if ((active.tokens ?? 0) < 3) {
        return { ok: false, error: "Need 3 tokens to buy a card" };
    }

    const card = room.game.currentCard;
    if (!card) return { ok: false, error: "No current card" };

    active.tokens -= 3;
    active.timeline = insertIntoTimelineSorted(active.timeline || [], card);

    room.game.lastReveal = {
        note: `Bought card for 3 tokens: ${card.title} — ${card.artists.join(", ")} (${card.year})`,
    };

    room.game.currentCard = null;
    advanceTurn(room);
    room.game.currentCard = drawNextCard(room);
    room.game.cardNonce = (room.game.cardNonce || 0) + 1;

    broadcastRoom(roomCode);
    return { ok: true };
}

function submitGuess({ room, roomCode, socketId, io, broadcastRoom }) {
    if (!room.game.started) return { ok: false, error: "Game not started" };

    const active = getActivePlayer(room);
    if (!active) return { ok: false, error: "No active player" };
    if (socketId !== active.socketId) return { ok: false, error: "Only active player can submit" };

    if (room.game.phase !== "PLAYING") return { ok: false, error: "You must press play first" };

    const card = room.game.currentCard;
    if (!card) return { ok: false, error: "No current card" };

    return {
        ok: true,
        doSubmit: ({ placementIndex, titleGuess, artistGuess }) => {
            const timeline = active.timeline || [];
            const n = timeline.length;

            let idx = Number(placementIndex);
            if (!Number.isFinite(idx)) idx = n;
            idx = Math.max(0, Math.min(n, idx));

            room.game.activeGuess = {
                placementIndex: idx,
                titleGuess: String(titleGuess || ""),
                artistGuess: String(artistGuess || ""),
                at: Date.now(),
            };

            io.to(roomCode).emit("audio:stop");

            if (room.game.singleplayer) {
                room.game.phase = "WAIT_PLAY";
                room.game.challenges = [];
                room.game.challengeSpent = {};
                room.game.challengeEndsAt = null;
                clearChallengeTimer(room);

                resolveReveal({ room, roomCode, io, broadcastRoom });
                return;
            }

            room.game.phase = "CHALLENGING";
            room.game.challenges = [];
            room.game.challengeSpent = {};
            room.game.challengeEndsAt = Date.now() + 15000;

            clearChallengeTimer(room);
            room.game.challengeTimer = setTimeout(() => {
                if (room.game.phase !== "CHALLENGING") return;
                resolveReveal({ room, roomCode, io, broadcastRoom });
            }, 15000);

            broadcastRoom(roomCode);
        },
    };
}

function challenge({ room, socketId, placementIndex, broadcastRoom }) {
    if (!room.game.started) return { ok: false, error: "Game not started" };

    if (room.game.singleplayer) return { ok: false, error: "No challenges in singleplayer" };

    if (room.game.phase !== "CHALLENGING") return { ok: false, error: "Not in challenge phase" };

    const active = getActivePlayer(room);
    if (!active) return { ok: false, error: "No active player" };
    if (socketId === active.socketId) return { ok: false, error: "Active player cannot challenge" };
    if (!room.game.activeGuess) return { ok: false, error: "No active guess to challenge" };

    const challenger = room.players.find((p) => p.socketId === socketId);
    if (!challenger) return { ok: false, error: "Player not found" };

    const activeTimeline = active.timeline || [];
    const n = activeTimeline.length;

    let idx = Number(placementIndex);
    if (!Number.isFinite(idx)) idx = n;
    idx = Math.max(0, Math.min(n, idx));

    const activeIdx = Number(room.game.activeGuess.placementIndex);
    if (idx === activeIdx) {
        return { ok: false, error: "You can't challenge the spot the active player chose." };
    }

    const key = String(challenger.name || "").toLowerCase();
    const list = room.game.challenges || [];

    const existingIndex = list.findIndex((c) => String(c.name || "").toLowerCase() === key);
    const existing = existingIndex >= 0 ? list[existingIndex] : null;

    const spotTakenByOther = list.some(
        (c) => Number(c.placementIndex) === idx && String(c.name || "").toLowerCase() !== key
    );
    if (spotTakenByOther) {
        return { ok: false, error: "That spot is already challenged by someone else." };
    }

    if (!room.game.challengeSpent) room.game.challengeSpent = {};
    if (!room.game.challengeSpent[key]) {
        const t = Number(challenger.tokens ?? 0);
        if (t < 1) return { ok: false, error: "Need 1 token to challenge" };
        challenger.tokens = t - 1;
        room.game.challengeSpent[key] = true;
    }

    const entry = { name: challenger.name, placementIndex: idx, at: Date.now() };

    if (existing) list[existingIndex] = entry;
    else list.push(entry);

    room.game.challenges = list;

    broadcastRoom(room.roomCode);
    return { ok: true };
}

module.exports = {
    getActivePlayer,

    // New correct rule
    correctInsertionRange,

    // Compatibility alias (cheap + safe)
    correctInsertionIndex: (timeline, card) => correctInsertionRange(timeline, card).max,

    insertIntoTimelineSorted,
    drawNextCard,
    advanceTurn,
    clearChallengeTimer,
    resolveReveal,

    startGame,
    playTurn,
    swapTurn,
    buyCard,
    submitGuess,
    challenge,
};
