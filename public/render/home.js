// public/render/home.js
// Lobby/home rendering only. No socket emits here (render-only).

import { amHost } from "../app-state.js";
import { el } from "./components.js";

/**
 * @param {object} params
 * @param {object|null} params.state
 * @param {string} params.myName
 * @param {object} params.dom
 * @param {HTMLElement} params.dom.roomLabel
 * @param {HTMLElement} params.dom.hostLabel
 * @param {HTMLElement} params.dom.playersEl
 * @param {HTMLElement} params.dom.roomHintEl
 * @param {HTMLElement} params.dom.hostControls
 */
export function renderLobby({ state, myName, dom }) {
    const { roomLabel, hostLabel, playersEl, roomHintEl, hostControls } = dom;

    if (!state) {
        roomLabel.textContent = "—";
        hostLabel.textContent = "—";
        playersEl.innerHTML = "";
        roomHintEl.classList.remove("hidden");
        hostControls.classList.add("hidden");
        return;
    }

    roomLabel.textContent = state.roomCode || "—";
    hostLabel.textContent = state.host || "—";

    playersEl.innerHTML = "";
    for (const p of state.players || []) {
        playersEl.appendChild(el("li", "", p.name));
    }

    const inRoom = !!state.roomCode;
    roomHintEl.classList.toggle("hidden", inRoom);

    // Host controls visible only to host
    hostControls.classList.toggle("hidden", !(inRoom && amHost(state, myName)));
}
