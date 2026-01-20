// public/render/challenge.js
// Challenge UI + drop zones. No global DOM queries. Designed to be called from render/game.js.

import {
    myTokenCount,
    myExistingChallengeIndex,
    getChallengeMap,
    isSlotDisabledForMe,
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

function renderTokenStrip({ state, myName, tokenImgSrc, setError }) {
    const wrap = el("div", "tokenArea");

    const n = myTokenCount(state, myName);
    wrap.appendChild(el("div", "tokenAreaLabel", `Your tokens: ${n}`));

    const strip = el("div", "tokenStrip");

    for (let i = 0; i < n; i++) {
        const t = el("div", "token", "");
        t.draggable = true;
        t.setAttribute("aria-label", "token");
        t.style.backgroundImage = `url(${tokenImgSrc})`;

        t.addEventListener("dragstart", (ev) => {
            setError?.("");
            try {
                ev.dataTransfer.setData("text/plain", "token");
                ev.dataTransfer.effectAllowed = "move";
            } catch { }
            t.classList.add("dragging");
        });

        t.addEventListener("dragend", () => {
            t.classList.remove("dragging");
            document.querySelectorAll(".dropZone.over").forEach((z) => z.classList.remove("over"));
        });

        strip.appendChild(t);
    }

    if (n === 0) strip.appendChild(el("div", "tokenEmpty", "No tokens left"));

    wrap.appendChild(strip);
    wrap.appendChild(
        el("div", "playHint", "Drag a token onto the active player's timeline to challenge that spot.")
    );

    return wrap;
}

/**
 * Renders the active player's timeline WITH drop zones (before, between, after).
 * @param {object} params
 * @param {object} params.state
 * @param {string} params.myName
 * @param {HTMLElement} params.activeTimelineEl
 * @param {Array} params.activeTimeline
 * @param {Function} params.onChallenge   async (placementIndex:number)=>void
 * @param {Function} params.setError
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

        const disabled = isSlotDisabledForMe(state, myName, placementIndex);
        if (disabled) dz.classList.add("disabled");

        const names = challengeMap.get(Number(placementIndex)) || [];
        if (names.length) {
            const chips = el("div", "dropChips");
            for (const nm of names.slice(0, 3)) chips.appendChild(el("div", "chip", nm));
            if (names.length > 3) chips.appendChild(el("div", "chip", `+${names.length - 3}`));
            dz.appendChild(chips);
        } else {
            dz.appendChild(el("div", "dropHint", `Drop to challenge #${placementIndex}`));
        }

        dz.addEventListener("dragover", (ev) => {
            if (disabled) return;
            ev.preventDefault();
            try {
                ev.dataTransfer.dropEffect = "move";
            } catch { }
            dz.classList.add("over");
        });

        dz.addEventListener("dragleave", () => dz.classList.remove("over"));

        dz.addEventListener("drop", async (ev) => {
            if (disabled) return;
            ev.preventDefault();
            dz.classList.remove("over");

            if (myTokenCount(state, myName) <= 0) return setError?.("No tokens left.");
            await onChallenge(Number(placementIndex));
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
 * Builds the challenge panel DOM node.
 */
export function buildChallengePanel({
    state,
    myName,
    tokenImgSrc,
    setError,
}) {
    const wrap = el("div");

    const header = el("div", "playHint");
    header.innerHTML = `Challenge phase: <b><span id="challengeSeconds">15</span>s</b> left. Drag a token onto a slot in ${state.game.activePlayer}'s timeline. (Costs 1 token)`;
    wrap.appendChild(header);

    wrap.appendChild(renderTokenStrip({ state, myName, tokenImgSrc, setError }));

    const myExisting = myExistingChallengeIndex(state, myName);
    if (myExisting !== null) {
        wrap.appendChild(el("div", "playHint", `You challenged slot #${myExisting}. Drag again to change your challenge.`));
    }

    const ch = state?.game?.challenges || [];
    const list = el("div", "playHint");
    list.textContent = ch.length
        ? "Challenges: " + ch.map((c) => `${c.name} → #${c.placementIndex}`).join(" | ")
        : "No challenges yet.";
    wrap.appendChild(list);

    return wrap;
}

/**
 * Builds the active-player waiting panel DOM node.
 */
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
