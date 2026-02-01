// public/render/challenge.js
// Challenge UI helpers: token board + drop zones between timeline cards.

import {
    myTokenCount,
    myExistingChallengeIndex,
    getChallengeMap,
} from "../app-state.js";

import { el, renderSongCard } from "./components.js";

export function buildPlacementSelect(timeline) {
    const n = timeline.length;
    const select = document.createElement("select");

    const firstYear = n ? timeline[0].year : "—";
    const lastYear = n ? timeline[n - 1].year : "—";

    select.appendChild(new Option(`Before ${firstYear}`, "0"));

    for (let i = 0; i < n - 1; i++) {
        const a = timeline[i];
        const b = timeline[i + 1];
        select.appendChild(new Option(`Between ${a.year} and ${b.year}`, String(i + 1)));
    }

    select.appendChild(new Option(`After ${lastYear}`, String(n)));
    return select;
}

// Re-exported for other UIs (active guess placement, etc.)
export function slotLabelForIndex(timeline, placementIndex) {
    return slotLabel(timeline, placementIndex);
}

/**
 * Renders *your* timeline with drop zones used to choose where your active guess goes.
 * This is for the ACTIVE PLAYER during the PLAYING phase.
 *
 * It accepts either:
 *  - click on a slot, or
 *  - drag the Play card (cardPlay.png) onto a slot.
 */
export function renderMyTimelineWithGuessDropZones({
    myTimelineEl,
    myTimeline,
    selectedIndex,
    onSelect,
    setError,
}) {
    myTimelineEl.innerHTML = "";

    const n = myTimeline.length;

    const zones = [];
    const setSelected = (idx) => {
        const i = Number(idx);
        for (const z of zones) z.classList.remove("selected");
        const hit = zones.find((z) => Number(z.dataset.index) === i);
        if (hit) hit.classList.add("selected");
        onSelect?.(i);
    };

    const makeGuessZone = (placementIndex) => {
        const dz = el("div", "dropZone guessZone");
        dz.dataset.index = String(placementIndex);

        dz.appendChild(el("div", "dropLabel", slotLabel(myTimeline, placementIndex)));

        if (Number(selectedIndex) === Number(placementIndex)) dz.classList.add("selected");

        dz.addEventListener("dragover", (ev) => {
            ev.preventDefault(); // REQUIRED or drop will never fire
            dz.classList.add("over");
            try {
                ev.dataTransfer.dropEffect = "move";
            } catch { }
        });

        dz.addEventListener("dragleave", () => dz.classList.remove("over"));

        dz.addEventListener("drop", (ev) => {
            ev.preventDefault();
            dz.classList.remove("over");

            let payload = "";
            try {
                payload = ev.dataTransfer?.getData("text/plain") || "";
            } catch { }
            if (payload !== "play-card") return;

            setError?.("");
            setSelected(placementIndex);

            // MOVE the play card into this slot so it stays
            const playCard = document.querySelector(".playCard.playCardDraggable");
            if (playCard) {
                dz.appendChild(playCard);        // snap card into slot
                dz.classList.add("occupied");    // ✅ hide label while card is here
            }
        });

        zones.push(dz);
        return dz;
    };

    myTimelineEl.appendChild(makeGuessZone(0));
    for (let i = 0; i < n; i++) {
        myTimelineEl.appendChild(renderSongCard(myTimeline[i]));
        myTimelineEl.appendChild(makeGuessZone(i + 1));
    }
}

function slotLabel(timeline, placementIndex) {
    const n = timeline.length;
    const idx = Number(placementIndex);

    if (idx <= 0) {
        const y = n ? timeline[0].year : "—";
        return `Before ${y}`;
    }
    if (idx >= n) {
        const y = n ? timeline[n - 1].year : "—";
        return `After ${y}`;
    }

    const left = timeline[idx - 1]?.year ?? "—";
    const right = timeline[idx]?.year ?? "—";
    return `Between ${left} and ${right}`;
}

function renderTokenStrip({ state, myName, tokenImgSrc, setError }) {
    const wrap = el("div", "tokenArea");

    const n = myTokenCount(state, myName);
    wrap.appendChild(el("div", "tokenAreaLabel", `Your tokens`));

    const strip = el("div", "tokenStrip");

    for (let i = 0; i < n; i++) {
        const t = el("div", "token", "");
        t.draggable = true;
        t.setAttribute("aria-label", "challenge token");

        // Use an <img> so the drag image is clean/consistent
        const img = document.createElement("img");
        img.src = tokenImgSrc;
        img.alt = "";
        img.draggable = false;
        img.className = "tokenImg";
        t.appendChild(img);

        t.addEventListener("dragstart", (ev) => {
            setError?.("");
            t.classList.add("dragging");
            try {
                ev.dataTransfer.setData("text/plain", "challenge-token");
                ev.dataTransfer.effectAllowed = "move";
            } catch { }
        });

        t.addEventListener("dragend", () => {
            t.classList.remove("dragging");
        });

        strip.appendChild(t);
    }

    if (n === 0) strip.appendChild(el("div", "tokenEmpty", "No tokens left"));

    wrap.appendChild(strip);
    wrap.appendChild(el("div", "tokenHint", "Drag 1 token onto the active player's timeline slot to challenge."));

    return wrap;
}

// Token board meant to sit under the Players list (left side)
export function buildTokenBoard({ state, myName, tokenImgSrc, setError }) {
    const board = el("div", "tokenBoard");
    board.appendChild(el("div", "tokenBoardTitle", "Challenge"));
    board.appendChild(el("div", "tokenBoardSub", "Drag a token onto a slot."));
    board.appendChild(renderTokenStrip({ state, myName, tokenImgSrc, setError }));
    return board;
}

/**
 * Renders the active player's timeline WITH drop zones (before, between, after).
 * Once a slot has ANY challenge in it, it's locked for everyone (including the challenger).
 */
export function renderActiveTimelineWithDropZones({
    state,
    myName,
    activeTimelineEl,
    activeTimeline,
    onChallenge,
    setError,
}) {
    activeTimelineEl.innerHTML = "";

    const n = activeTimeline.length;
    const challengeMap = getChallengeMap(state);

    const makeDropZone = (placementIndex) => {
        const dz = el("div", "dropZone");
        dz.dataset.index = String(placementIndex);

        const names = challengeMap.get(Number(placementIndex)) || [];
        const slotFilled = names.length > 0;

        // Disable if filled or if it's the active player's chosen spot
        const isActiveSpot = Number(state?.game?.activeGuessIndex) === Number(placementIndex);
        const disabled = slotFilled || isActiveSpot;

        if (disabled) dz.classList.add("disabled");
        if (slotFilled) dz.classList.add("filled");

        // label + occupant
        const head = el("div", "dropRow");
        head.appendChild(el("div", "dropLabel", slotLabel(activeTimeline, placementIndex)));
        dz.appendChild(head);

        const activeName = state?.game?.activePlayer || "Active player";

        if (isActiveSpot) {
            dz.appendChild(el("div", "dropTaken", `${activeName} guessed here`));
        } else if (slotFilled) {
            dz.appendChild(el("div", "dropTaken", `Challenged by ${names[0]}`));
        } else {
            dz.appendChild(el("div", "dropHint", "Drop token here"));
        }

        dz.addEventListener("dragover", (ev) => {
            if (disabled) return;
            ev.preventDefault();
            dz.classList.add("over");
            try {
                ev.dataTransfer.dropEffect = "move";
            } catch { }
        });

        dz.addEventListener("dragenter", (ev) => {
            ev.preventDefault();
            dz.classList.add("over");
        });

        dz.addEventListener("dragleave", (ev) => {
            // Only trigger when leaving the whole zone (not moving between children)
            if (ev.relatedTarget && dz.contains(ev.relatedTarget)) return;

            dz.classList.remove("over");

            // ✅ If the play card is no longer inside this zone, show the label again
            const playCard = document.querySelector(".playCard.playCardDraggable");
            if (!playCard || !dz.contains(playCard)) {
                dz.classList.remove("occupied");
            }
        });

        dz.addEventListener("drop", async (ev) => {
            if (disabled) return;
            ev.preventDefault();
            dz.classList.remove("over");

            if (myTokenCount(state, myName) <= 0) return setError?.("No tokens left.");
            const resp = await onChallenge(Number(placementIndex));
            if (!resp?.ok) return; // error already handled by caller
        });

        return dz;
    };

    activeTimelineEl.appendChild(makeDropZone(0));
    for (let i = 0; i < n; i++) {
        activeTimelineEl.appendChild(renderSongCard(activeTimeline[i]));
        activeTimelineEl.appendChild(makeDropZone(i + 1));
    }
}

/**
 * Challenge panel in the main turn area (text only).
 * Tokens now live under the Players list (left side).
 */
export function buildChallengePanel({ state, myName }) {
    const wrap = el("div");

    const header = el("div", "playHint");
    header.innerHTML = `Challenge phase: <b><span id="challengeSeconds">15</span>s</b> left. Drag a token from the left panel onto a slot.`;
    wrap.appendChild(header);

    const mine = myExistingChallengeIndex(state, myName);
    if (mine !== null) {
        wrap.appendChild(el("div", "playHint", `You already placed a challenge token this round.`));
    }

    const ch = state?.game?.challenges || [];
    wrap.appendChild(
        el(
            "div",
            "playHint",
            ch.length
                ? "Challenges: " + ch.map((c) => `${c.name} → #${c.placementIndex}`).join(" | ")
                : "No challenges yet."
        )
    );

    return wrap;
}

export function buildWaitingChallengePanel({ state }) {
    const wrap = el("div");

    const header = el("div", "playHint");
    header.innerHTML = `Waiting for challenges… <b><span id="challengeSeconds">15</span>s</b> left.`;
    wrap.appendChild(header);

    const activeIdx = state?.game?.activeGuessIndex;
    wrap.appendChild(el("div", "playHint", `You locked placement index: ${activeIdx ?? "—"}`));

    const ch = state?.game?.challenges || [];
    wrap.appendChild(
        el(
            "div",
            "playHint",
            ch.length
                ? "Challenges: " + ch.map((c) => `${c.name} → #${c.placementIndex}`).join(" | ")
                : "No challenges yet."
        )
    );

    return wrap;
}
