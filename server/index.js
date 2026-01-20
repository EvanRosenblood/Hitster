// server/index.js
// Socket wiring only; rules live in game-engine.js; room state in game-state.js.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const {
    createRoom,
    getRoom,
    deleteRoom,
    addPlayer,
    removePlayer,
    publicState,
} = require("./game-state");

const {
    clearChallengeTimer,
    startGame,
    playTurn,
    swapTurn,
    buyCard,
    submitGuess,
    challenge,
} = require("./game-engine");

const app = express();
app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

app.get("/health", (req, res) => res.json({ ok: true }));

// Load songs
const songsPath = path.join(__dirname, "songs.json");
let SONGS = [];
try {
    const raw = fs.readFileSync(songsPath, "utf-8");
    SONGS = JSON.parse(raw);
    if (!Array.isArray(SONGS)) SONGS = [];
} catch {
    SONGS = [];
}

if (SONGS.length === 0) {
    console.warn("⚠️ No songs loaded. Put songs.json in server/ and restart.");
} else {
    console.log(`✅ Loaded ${SONGS.length} songs from server/songs.json`);
}

function makeRoomCode() {
    return Math.random().toString(36).slice(2, 6).toUpperCase();
}

// For singleplayer rooms (still just a room under the hood)
function makeSingleCode() {
    return "SP" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

function broadcastRoom(roomCode) {
    const room = getRoom(roomCode);
    if (!room) return;
    io.to(roomCode).emit("state:update", publicState(room));
}

// helper: safely leave/remove from old room if starting something new
function leaveCurrentRoom(socket) {
    const oldCode = socket.data.roomCode;
    if (!oldCode) return;

    const oldRoom = getRoom(oldCode);
    // leave socket.io room either way
    socket.leave(oldCode);
    socket.data.roomCode = null;

    if (!oldRoom) return;

    removePlayer(oldRoom, socket.id);

    if (oldRoom.players.length === 0) {
        clearChallengeTimer(oldRoom);
        deleteRoom(oldCode);
        return;
    }

    broadcastRoom(oldCode);
}

io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    socket.on("room:create", ({ name }, cb) => {
        try {
            const safeName = String(name || "").trim().slice(0, 20);
            if (!safeName) return cb?.({ ok: false, error: "Name required" });

            leaveCurrentRoom(socket);

            let roomCode = makeRoomCode();
            while (getRoom(roomCode)) roomCode = makeRoomCode();

            createRoom({ roomCode, hostSocketId: socket.id, hostName: safeName });

            socket.join(roomCode);
            socket.data.roomCode = roomCode;

            broadcastRoom(roomCode);
            cb?.({ ok: true, roomCode });
        } catch {
            cb?.({ ok: false, error: "Failed to create room" });
        }
    });

    socket.on("room:join", ({ roomCode, name }, cb) => {
        try {
            const code = String(roomCode || "").trim().toUpperCase();
            const safeName = String(name || "").trim().slice(0, 20);

            if (!code) return cb?.({ ok: false, error: "Room code required" });
            if (!safeName) return cb?.({ ok: false, error: "Name required" });

            const room = getRoom(code);
            if (!room) return cb?.({ ok: false, error: "Room not found" });
            if (room.players.length >= 8) return cb?.({ ok: false, error: "Room full (max 8)" });

            if (room.players.some((p) => p.name.toLowerCase() === safeName.toLowerCase())) {
                return cb?.({ ok: false, error: "Name already taken" });
            }

            // don't allow joining singleplayer rooms
            if (room.game?.singleplayer) {
                return cb?.({ ok: false, error: "That room is singleplayer-only." });
            }

            leaveCurrentRoom(socket);

            addPlayer(room, { socketId: socket.id, name: safeName });

            socket.join(code);
            socket.data.roomCode = code;

            broadcastRoom(code);
            cb?.({ ok: true, roomCode: code });
        } catch {
            cb?.({ ok: false, error: "Failed to join room" });
        }
    });

    // NEW: singleplayer
    socket.on("single:start", ({ name }, cb) => {
        try {
            const safeName = String(name || "").trim().slice(0, 20);
            if (!safeName) return cb?.({ ok: false, error: "Name required" });

            leaveCurrentRoom(socket);

            let roomCode = makeSingleCode();
            while (getRoom(roomCode)) roomCode = makeSingleCode();

            const room = createRoom({
                roomCode,
                hostSocketId: socket.id,
                hostName: safeName,
                singleplayer: true,
            });

            socket.join(roomCode);
            socket.data.roomCode = roomCode;

            // auto-start immediately
            const r = startGame({ room, SONGS, broadcastRoom, roomCode });
            if (!r.ok) return cb?.(r);

            cb?.({ ok: true, roomCode });
        } catch {
            cb?.({ ok: false, error: "Singleplayer failed" });
        }
    });

    socket.on("game:start", (cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const room = getRoom(roomCode);
            if (!room) return cb?.({ ok: false, error: "Not in a room" });
            if (room.hostSocketId !== socket.id) return cb?.({ ok: false, error: "Only host can start" });

            const r = startGame({ room, SONGS, broadcastRoom, roomCode });
            if (!r.ok) return cb?.(r);

            cb?.({ ok: true });
        } catch {
            cb?.({ ok: false, error: "Failed to start game" });
        }
    });

    socket.on("turn:play", async (cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const room = getRoom(roomCode);
            if (!room) return cb?.({ ok: false, error: "Not in a room" });

            const r = await playTurn({ room, roomCode, socketId: socket.id, io, broadcastRoom });
            cb?.(r.ok ? { ok: true } : r);
        } catch {
            cb?.({ ok: false, error: "Failed to play song" });
        }
    });

    socket.on("turn:swap", async (cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const room = getRoom(roomCode);
            if (!room) return cb?.({ ok: false, error: "Not in a room" });

            const r = await swapTurn({ room, roomCode, socketId: socket.id, io, broadcastRoom });
            cb?.(r.ok ? { ok: true } : r);
        } catch {
            cb?.({ ok: false, error: "Skip failed" });
        }
    });

    socket.on("turn:buyCard", (cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const room = getRoom(roomCode);
            if (!room) return cb?.({ ok: false, error: "Not in a room" });

            const r = buyCard({ room, roomCode, socketId: socket.id, broadcastRoom });
            cb?.(r.ok ? { ok: true } : r);
        } catch {
            cb?.({ ok: false, error: "Buy failed" });
        }
    });

    socket.on("turn:submitGuess", ({ placementIndex, titleGuess, artistGuess }, cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const room = getRoom(roomCode);
            if (!room) return cb?.({ ok: false, error: "Not in a room" });

            const pre = submitGuess({ room, roomCode, socketId: socket.id, io, broadcastRoom });
            if (!pre.ok) return cb?.(pre);

            pre.doSubmit({ placementIndex, titleGuess, artistGuess });
            cb?.({ ok: true });
        } catch {
            cb?.({ ok: false, error: "Submit failed" });
        }
    });

    socket.on("turn:challenge", ({ placementIndex }, cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const room = getRoom(roomCode);
            if (!room) return cb?.({ ok: false, error: "Not in a room" });

            const r = challenge({ room, socketId: socket.id, placementIndex, broadcastRoom });
            cb?.(r.ok ? { ok: true } : r);
        } catch {
            cb?.({ ok: false, error: "Challenge failed" });
        }
    });

    socket.on("disconnect", () => {
        const roomCode = socket.data.roomCode;
        if (!roomCode) return;

        const room = getRoom(roomCode);
        if (!room) return;

        removePlayer(room, socket.id);

        if (room.players.length === 0) {
            clearChallengeTimer(room);
            deleteRoom(roomCode);
            return;
        }

        broadcastRoom(roomCode);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
