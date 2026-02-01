// public/render/game.js
// Game rendering (both active + non-active views). No global DOM queries.

import {
    amActivePlayer,
    findPlayerByName,
    myTokenCount,
} from "../app-state.js";

import { el, renderSongCard, renderVolumeSlider, updateRangeFill } from "./components.js";
import {
    slotLabelForIndex,
    renderMyTimelineWithGuessDropZones,
    renderActiveTimelineWithDropZones,
    buildTokenBoard,
    buildChallengePanel,
    buildWaitingChallengePanel,
} from "./challenge.js";

export function createGameRenderer({
    api,
    getVolume,
    setVolume,
    tokenImgSrc,
    setError,
    getMyName,
}) {
    let lastCardNonceRendered = null;
    let activeGuessPlacementIndex = 0;

    async function onChallenge(placementIndex) {
        const resp = await api.challenge({ placementIndex: Number(placementIndex) });
        if (!resp?.ok) setError(resp?.error || "Challenge failed");
        else setError("");
        return resp;
    }

    function renderPlayUIOnly({ state }) {
        const wrap = el("div");
        const playRow = el("div", "row");

        const playCard = el("div", "playCard");

        const img = document.createElement("img");
        img.src = "/assets/cards/cardPlay.png";
        img.alt = "Play";
        img.className = "playCardImg";
        img.draggable = false;

        playCard.appendChild(img);

        playCard.addEventListener("click", async () => {
            const resp = await api.play();
            if (!resp?.ok) setError(resp?.error || "Could not play");
        });

        const buyBtn = el("button");
        buyBtn.textContent = "Buy card (3 tokens)";
        buyBtn.addEventListener("click", async () => {
            const resp = await api.buyCard();
            if (!resp?.ok) setError(resp?.error || "Buy failed");
        });

        const myTokens = myTokenCount(state, getMyName());
        if (myTokens < 3) {
            buyBtn.disabled = true;
            buyBtn.title = "Need 3 tokens";
        }

        playRow.appendChild(playCard);
        playRow.appendChild(buyBtn);

        wrap.appendChild(playRow);
        wrap.appendChild(el("div", "playHint", "Click ▶ to play. Lock guess → challenge → reveal."));
        return wrap;
    }

    function renderGuessForm({ state, myTimeline }) {
        const wrap = el("div");

        const nonce = state?.game?.cardNonce ?? 0;
        const shouldReset = nonce !== lastCardNonceRendered;
        lastCardNonceRendered = nonce;

        if (shouldReset) activeGuessPlacementIndex = 0;

        const dragRow = el("div", "row");
        const playCard = el("div", "playCard playCardDraggable");
        const img = document.createElement("img");
        img.src = "/assets/cards/cardPlay.png";
        img.alt = "Drag to choose placement";
        img.className = "playCardImg";
        img.draggable = false;
        playCard.appendChild(img);
        playCard.draggable = true;

        playCard.addEventListener("dragstart", (ev) => {
            setError?.("");
            playCard.classList.add("dragging");

            try {
                ev.dataTransfer.setData("text/plain", "play-card");
                ev.dataTransfer.effectAllowed = "move";
            } catch { }
        });

        playCard.addEventListener("dragend", () => {
            playCard.classList.remove("dragging");

            // ✅ if it ended inside a zone (drop success), hide label again
            const zone = playCard.closest(".guessZone");
            if (zone) zone.classList.add("occupied");
        });

        dragRow.appendChild(playCard);

        const titleInput = document.createElement("input");
        titleInput.placeholder = "Guess song title";
        titleInput.maxLength = 80;

        const artistInput = document.createElement("input");
        artistInput.placeholder = "Guess artist (one is enough)";
        artistInput.maxLength = 80;

        if (shouldReset) {
            titleInput.value = "";
            artistInput.value = "";
        }

        const row = el("div", "row");

        const skipBtn = el("button");
        skipBtn.textContent = "Skip song (cost 1 token)";
        skipBtn.addEventListener("click", async () => {
            const resp = await api.swap();
            if (!resp?.ok) setError(resp?.error || "Skip failed");
        });

        const submitBtn = el("button", "primary");
        submitBtn.textContent = "Lock guess (start challenge)";
        submitBtn.addEventListener("click", async () => {
            const resp = await api.submitGuess({
                placementIndex: Number(activeGuessPlacementIndex),
                titleGuess: titleInput.value,
                artistGuess: artistInput.value,
            });
            if (!resp?.ok) setError(resp?.error || "Submit failed");
        });

        row.appendChild(skipBtn);
        row.appendChild(submitBtn);

        wrap.appendChild(dragRow);
        wrap.appendChild(titleInput);
        wrap.appendChild(artistInput);
        wrap.appendChild(row);

        return wrap;
    }

    function renderReveal({ state, turnAreaEl }) {
        const last = state.game?.lastReveal;

        if (last?.song) {
            const songLine = `${last.song.title} — ${(last.song.artists || []).join(", ")} (${last.song.year})`;
            const winnerLine = last.winner ? `Winner: ${last.winner} (${last.winnerType})` : "Winner: nobody (discarded)";
            const activeLine =
                `Active placement: ${last.activePlacementCorrect ? "✅" : "❌"}   ` +
                `Title: ${last.titleOk ? "✅" : "❌"}   Artist: ${last.artistOk ? "✅" : "❌"}   ` +
                `Token: ${last.tokenAwarded ? "+1 🪙" : "+0"}`;

            let challengeLine = "Challenges: none";
            if (Array.isArray(last.challengeResults) && last.challengeResults.length) {
                challengeLine =
                    "Challenges: " +
                    last.challengeResults
                        .map((c) => `${c.name} ${c.correct ? "✅ challenged correctly" : "❌ lost challenge"}`)
                        .join(" | ");
            }

            turnAreaEl.appendChild(
                el("div", "playHint", `Reveal: ${songLine} | ${winnerLine} | ${activeLine} | ${challengeLine}`)
            );
            return;
        }

        if (last?.note) {
            turnAreaEl.appendChild(el("div", "playHint", last.note));
        }
    }

    function renderGame({ state, dom }) {
        const myName = getMyName();
        const phase = state.game?.phase;
        const activeName = state.game?.activePlayer || "—";

        dom.activeNameEl.textContent = activeName;

        // Left player list + my volume slider
        dom.gamePlayersEl.innerHTML = "";
        for (const p of state.players || []) {
            const isActive = p.name === activeName;
            const isMe = p.name.toLowerCase() === myName.toLowerCase();

            const row = el("div", "playerRow" + (isActive ? " active" : ""));
            row.appendChild(el("div", "", p.name));
            row.appendChild(el("div", "", `🪙 ${Number(p.tokens ?? 0)}   🃏 ${(p.timeline || []).length}`));
            dom.gamePlayersEl.appendChild(row);

            if (isMe) {
                dom.gamePlayersEl.appendChild(
                    renderVolumeSlider({ getVolume, setVolume, updateRangeFill })
                );
            }
        }

        // Token board always visible under Players list
        dom.gamePlayersEl.appendChild(
            buildTokenBoard({
                state,
                myName,
                tokenImgSrc,
                setError,
            })
        );

        // My timeline
        const mePlayer = findPlayerByName(state, myName);
        const myTimeline = mePlayer?.timeline || [];

        if (amActivePlayer(state, myName) && phase === "PLAYING") {
            renderMyTimelineWithGuessDropZones({
                myTimelineEl: dom.myTimelineEl,
                myTimeline,
                selectedIndex: activeGuessPlacementIndex,
                onSelect: (idx) => {
                    activeGuessPlacementIndex = Number(idx);
                    setError?.("");
                },
                setError,
            });
        } else {
            dom.myTimelineEl.innerHTML = "";
            for (const song of myTimeline) dom.myTimelineEl.appendChild(renderSongCard(song));
        }

        // Active player's timeline section (hidden when I'm active)
        if (amActivePlayer(state, myName)) {
            dom.activeSectionEl.classList.add("hidden");
        } else {
            dom.activeSectionEl.classList.remove("hidden");
            const activePlayer = findPlayerByName(state, activeName);
            const activeTimeline = activePlayer?.timeline || [];

            if (phase === "CHALLENGING") {
                renderActiveTimelineWithDropZones({
                    state,
                    myName,
                    activeTimelineEl: dom.activeTimelineEl,
                    activeTimeline,
                    onChallenge,
                    setError,
                });
            } else {
                dom.activeTimelineEl.innerHTML = "";
                for (const song of activeTimeline) dom.activeTimelineEl.appendChild(renderSongCard(song));
            }
        }

        // Turn area
        dom.turnAreaEl.innerHTML = "";
        renderReveal({ state, turnAreaEl: dom.turnAreaEl });

        if (amActivePlayer(state, myName)) {
            if (phase === "WAIT_PLAY") dom.turnAreaEl.appendChild(renderPlayUIOnly({ state }));
            else if (phase === "PLAYING") dom.turnAreaEl.appendChild(renderGuessForm({ state, myTimeline }));
            else if (phase === "CHALLENGING") dom.turnAreaEl.appendChild(buildWaitingChallengePanel({ state }));
        } else {
            if (phase === "CHALLENGING") {
                dom.turnAreaEl.appendChild(
                    buildChallengePanel({
                        state,
                        myName,
                    })
                );
            } else {
                dom.turnAreaEl.appendChild(el("div", "", `Waiting for ${activeName}…`));
            }
        }
    }

    return { renderGame };
}
