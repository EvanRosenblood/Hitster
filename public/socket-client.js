// public/socket-client.js
// Owns: socket wiring + emit wrappers. No DOM. No rendering.

export function createSocketClient(handlers = {}) {
    const socket = io();

    // inbound events
    socket.on("connect", () => handlers.onConnect?.());
    socket.on("disconnect", () => handlers.onDisconnect?.());

    socket.on("state:update", (state) => handlers.onStateUpdate?.(state));

    socket.on("audio:play", ({ youtubeId, startAt }) => {
        handlers.onAudioPlay?.({ youtubeId, startAt });
    });

    socket.on("audio:stop", () => handlers.onAudioStop?.());

    // emit wrappers (ack-safe)
    function emitAck(event, payload) {
        return new Promise((resolve) => {
            try {
                socket.emit(event, payload, (resp) => resolve(resp || { ok: false }));
            } catch {
                resolve({ ok: false });
            }
        });
    }

    return {
        raw: socket,

        // lobby
        createRoom: (name) => emitAck("room:create", { name }),
        joinRoom: (roomCode, name) => emitAck("room:join", { roomCode, name }),
        startGame: () => emitAck("game:start"),

        // NEW: singleplayer
        startSingleplayer: (name) => emitAck("single:start", { name }),

        // turn actions
        play: () => emitAck("turn:play"),
        swap: () => emitAck("turn:swap"),
        buyCard: () => emitAck("turn:buyCard"),
        submitGuess: ({ placementIndex, titleGuess, artistGuess }) =>
            emitAck("turn:submitGuess", { placementIndex, titleGuess, artistGuess }),
        challenge: ({ placementIndex }) =>
            emitAck("turn:challenge", { placementIndex: Number(placementIndex) }),
    };
}
