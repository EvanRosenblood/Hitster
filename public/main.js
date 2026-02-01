// public/main.js
// Orchestration only: wires socket + audio + render modules.
// Rendering logic lives in /render/*

import { createSocketClient } from "./socket-client.js";
import {
    initYouTubeAudio,
    play as audioPlay,
    stop as audioStop,
    getVolume,
    setVolume,
} from "./youtube-audio.js";

import { secondsLeft } from "./app-state.js";
import { renderLobby } from "./render/home.js";
import { createGameRenderer } from "./render/game.js";

/* ---------- DOM ---------- */
const homeUI = document.getElementById("homeUI");
const gameUI = document.getElementById("gameUI");

const nameEl = document.getElementById("name");
const roomCodeEl = document.getElementById("roomCode");

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const startGameBtn = document.getElementById("startGameBtn");

// NEW
const singleBtn = document.getElementById("singleBtn");

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");

const domHome = {
    roomLabel: document.getElementById("roomLabel"),
    hostLabel: document.getElementById("hostLabel"),
    playersEl: document.getElementById("players"),
    roomHintEl: document.getElementById("roomHint"),
    hostControls: document.getElementById("hostControls"),
};

const domGame = {
    gamePlayersEl: document.getElementById("gamePlayers"),
    activeNameEl: document.getElementById("activeName"),
    myTimelineEl: document.getElementById("myTimeline"),
    activeTimelineEl: document.getElementById("activeTimeline"),
    activeSectionEl: document.getElementById("activeSection"),
    turnAreaEl: document.getElementById("turnArea"),
};

const TOKEN_IMG_SRC = "/assets/token.png";

/* ---------- State ---------- */
let state = null;

/* ---------- UI helpers ---------- */
function myName() {
    return String(nameEl.value || "").trim();
}
function setError(msg) {
    errorEl.textContent = msg || "";
}
function showHome() {
    homeUI.classList.remove("hidden");
    gameUI.classList.add("hidden");
}
function showGame() {
    homeUI.classList.add("hidden");
    gameUI.classList.remove("hidden");
}

/* ---------- Init systems ---------- */
initYouTubeAudio({ playerElementId: "player" });

const api = createSocketClient({
    onConnect: () => {
        statusEl.textContent = "Connected ✅";
        setError("");
    },
    onDisconnect: () => {
        statusEl.textContent = "Not connected";
    },
    onStateUpdate: (s) => {
        state = s;
        render();
    },
    onAudioPlay: ({ youtubeId, startAt }) => audioPlay({ youtubeId, startAt }),
    onAudioStop: () => audioStop(),
});

const gameRenderer = createGameRenderer({
    api,
    getVolume,
    setVolume,
    tokenImgSrc: TOKEN_IMG_SRC,
    setError,
    getMyName: myName,
});

/* ---------- Lobby actions ---------- */
createBtn.addEventListener("click", async () => {
    const name = myName();
    if (!name) return setError("Enter your name first.");
    setError("");

    const resp = await api.createRoom(name);
    if (!resp?.ok) return setError(resp?.error || "Create failed");

    roomCodeEl.value = resp.roomCode || "";
});

joinBtn.addEventListener("click", async () => {
    const name = myName();
    const code = String(roomCodeEl.value || "").trim().toUpperCase();

    if (!name) return setError("Enter your name first.");
    if (!code) return setError("Enter a room code.");
    setError("");

    const resp = await api.joinRoom(code, name);
    if (!resp?.ok) return setError(resp?.error || "Join failed");
});

startGameBtn.addEventListener("click", async () => {
    setError("");
    const resp = await api.startGame();
    if (!resp?.ok) setError(resp?.error || "Failed to start game");
});

// NEW: Singleplayer start
singleBtn?.addEventListener("click", async () => {
    const name = myName();
    if (!name) return setError("Enter your name first.");
    setError("");

    const resp = await api.startSingleplayer(name);
    if (!resp?.ok) return setError(resp?.error || "Singleplayer failed");

    // optional: clear room code box
    roomCodeEl.value = "";
});

/* ---------- Render routing ---------- */
function render() {
    const started = !!state?.game?.started;

    if (!started) {
        showHome();
        renderLobby({ state, myName: myName(), dom: domHome });
        return;
    }

    showGame();
    gameRenderer.renderGame({ state, dom: domGame });
}

/* ---------- Countdown updater (NO re-render) ---------- */
setInterval(() => {
    if (!state?.game?.started) return;
    if (state?.game?.phase !== "CHALLENGING") return;

    const elSec = document.getElementById("challengeSeconds");
    if (!elSec) return;

    elSec.textContent = String(secondsLeft(state));
}, 200);
