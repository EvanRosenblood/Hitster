// public/render/game.js
// Game rendering (both active + non-active views). No global DOM queries.
// This is intended to replace the big renderGame() chunk in main.js next.

import {
    amActivePlayer,
    findPlayerByName,
    myTokenCount,
} from "../app-state.js";

import { el, renderSongCard, renderVolumeSlider, updateRangeFill } from "./components.js";
import {
    buildPlacementSelect,
    renderActiveTimelineWithDropZones,
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

    async function onChallenge(placementIndex) {
        const resp = await api.challenge({ placementIndex: Number(placementIndex) });
        if (!resp?.ok) setError(resp?.error || "Challenge failed");
        else setError("");
    }

    function renderPlayUIOnly({ state }) {
        const wrap = el("div");
        const playRow = el("div", "row");

        const playCard = el("div", "playCard");
        playCard.appendChild(el("div", "playSymbol", "▶"));
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

        if (state?.game?.singleplayer) {
            wrap.appendChild(el("div", "playHint", "Click ▶ to play. Choose placement + guess title/artist → confirm choice → reveal."));
        } else {
            wrap.appendChild(el("div", "playHint", "Click ▶ to play. Lock guess → challenge → reveal."));
        }

        return wrap;
    }

    function renderGuessForm({ state, myTimeline }) {
        const wrap = el("div");

        const nonce = state?.game?.cardNonce ?? 0;
        const shouldReset = nonce !== lastCardNonceRendered;
        lastCardNonceRendered = nonce;

        if (state?.game?.singleplayer) {
            wrap.appendChild(
                el(
                    "div",
                    "playHint",
                    "While the song plays: choose placement + guess title/artist. Confirm choice reveals instantly."
                )
            );
        } else {
            wrap.appendChild(
                el(
                    "div",
                    "playHint",
                    "While the song plays: choose placement + guess title/artist. Lock guess starts challenge phase."
                )
            );
        }

        const select = buildPlacementSelect(myTimeline);

        const titleInput = document.createElement("input");
        titleInput.placeholder = "Guess song title";
        titleInput.maxLength = 80;

        const artistInput = document.createElement("input");
        artistInput.placeholder = "Guess artist (one is enough)";
        artistInput.maxLength = 80;

        if (shouldReset) {
            titleInput.value = "";
            artistInput.value = "";
            select.value = "0";
        }

        const row = el("div", "row");

        const skipBtn = el("button");
        skipBtn.textContent = "Skip song (cost 1 token)";
        skipBtn.addEventListener("click", async () => {
            const resp = await api.swap();
            if (!resp?.ok) setError(resp?.error || "Skip failed");
        });

        const submitBtn = el("button", "primary");
        submitBtn.textContent = state?.game?.singleplayer
            ? "Confirm choice"
            : "Lock guess (start challenge)";

        submitBtn.addEventListener("click", async () => {
            const resp = await api.submitGuess({
                placementIndex: Number(select.value),
                titleGuess: titleInput.value,
                artistGuess: artistInput.value,
            });
            if (!resp?.ok) setError(resp?.error || "Submit failed");
        });

        row.appendChild(skipBtn);
        row.appendChild(submitBtn);

        wrap.appendChild(select);
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

            // In singleplayer, don't even mention challenges
            const extra = state?.game?.singleplayer ? "" : ` | ${challengeLine}`;

            turnAreaEl.appendChild(
                el("div", "playHint", `Reveal: ${songLine} | ${winnerLine} | ${activeLine}${extra}`)
            );
            return;
        }

        if (last?.note) {
            turnAreaEl.appendChild(el("div", "playHint", last.note));
        }
    }

    /**
     * Main game render call
     */
    function renderGame({
        state,
        dom, // { gamePlayersEl, activeNameEl, myTimelineEl, activeTimelineEl, activeSectionEl, turnAreaEl }
    }) {
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

        // My timeline
        dom.myTimelineEl.innerHTML = "";
        const mePlayer = findPlayerByName(state, myName);
        const myTimeline = mePlayer?.timeline || [];
        for (const song of myTimeline) dom.myTimelineEl.appendChild(renderSongCard(song));

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
                        tokenImgSrc,
                        setError,
                    })
                );
            } else {
                dom.turnAreaEl.appendChild(el("div", "", `Waiting for ${activeName}…`));
            }
        }
    }

    return { renderGame };
}
