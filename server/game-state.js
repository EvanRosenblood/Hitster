// server/game-state.js
// Owns rooms + publicState. No socket handlers.

const { getActivePlayer } = require("./game-engine");

// ---- Rooms (in-memory) ----
const rooms = {}; // keep as plain object to match existing usage patterns

function createRoom({ roomCode, hostSocketId, hostName, singleplayer = false }) {
    rooms[roomCode] = {
        roomCode,
        hostSocketId,
        players: [{ socketId: hostSocketId, name: hostName, tokens: 0, timeline: [] }],
        game: {
            started: false,
            deck: [],
            turnIndex: 0,
            currentCard: null,
            phase: "WAIT_PLAY", // WAIT_PLAY | PLAYING | CHALLENGING
            youtubeId: null,
            lastReveal: null,
            cardNonce: 0,
            activeGuess: null,
            challenges: [],
            challengeEndsAt: null,
            challengeTimer: null,
            challengeSpent: {}, // who already paid 1 token this round

            // NEW
            singleplayer: !!singleplayer,
        },
    };

    return rooms[roomCode];
}

function getRoom(roomCode) {
    return rooms[roomCode] || null;
}

function deleteRoom(roomCode) {
    delete rooms[roomCode];
}

function addPlayer(room, { socketId, name }) {
    room.players.push({ socketId, name, tokens: 0, timeline: [] });
}

function removePlayer(room, socketId) {
    room.players = room.players.filter((p) => p.socketId !== socketId);

    if (room.players.length === 0) return;

    if (room.hostSocketId === socketId) {
        room.hostSocketId = room.players[0].socketId;
        room.game.turnIndex = 0;
    } else {
        if (room.game.turnIndex >= room.players.length) room.game.turnIndex = 0;
    }
}

function publicState(room) {
    const active = getActivePlayer(room);

    return {
        roomCode: room.roomCode,
        host: room.players.find((p) => p.socketId === room.hostSocketId)?.name || null,
        game: {
            started: !!room.game.started,
            activePlayer: active ? active.name : null,
            phase: room.game.phase,
            hasCurrentCard: !!room.game.currentCard,
            lastReveal: room.game.lastReveal || null,
            cardNonce: room.game.cardNonce || 0,
            challengeEndsAt: room.game.challengeEndsAt || null,
            activeGuessIndex: room.game.activeGuess?.placementIndex ?? null,
            challenges: (room.game.challenges || []).map((c) => ({
                name: c.name,
                placementIndex: c.placementIndex,
                at: c.at,
            })),

            // NEW
            singleplayer: !!room.game.singleplayer,
        },
        players: room.players.map((p) => ({
            name: p.name,
            tokens: p.tokens ?? 0,
            timeline: p.timeline ?? [],
        })),
    };
}

module.exports = {
    rooms,
    createRoom,
    getRoom,
    deleteRoom,
    addPlayer,
    removePlayer,
    publicState,
};
