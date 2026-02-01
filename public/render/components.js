// public/render/components.js
// Small reusable UI components.

export function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

const CARD_BACKGROUNDS = [
    "/assets/cards/cardOrange.png",
    "/assets/cards/cardPurple.png",
    "/assets/cards/cardGreen.png",
    "/assets/cards/cardYellow.png",
    "/assets/cards/cardRed.png",
    "/assets/cards/cardPink.png",
];

function hashStringToIndex(str, mod) {
    const s = String(str ?? "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h >>>= 0;
    return mod ? (h % mod) : h;
}

function pickCardBackground(song) {
    const key =
        song?.id ??
        song?.songId ??
        `${song?.title ?? ""}|${(song?.artists || []).join(",")}|${song?.year ?? ""}`;

    const idx = hashStringToIndex(key, CARD_BACKGROUNDS.length);
    return CARD_BACKGROUNDS[idx];
}

export function renderSongCard(song) {
    const card = el("div", "songCard");

    // FORCE PNG background inline so it can’t be overridden by old CSS
    const bg = pickCardBackground(song);
    card.style.backgroundImage = `url("${bg}")`;
    card.style.backgroundSize = "cover";
    card.style.backgroundPosition = "center";
    card.style.backgroundRepeat = "no-repeat";

    // text
    card.appendChild(el("div", "songArtist", (song.artists || []).join(", ")));
    card.appendChild(el("div", "songYear", String(song.year ?? "")));
    card.appendChild(el("div", "songTitle", String(song.title ?? "")));

    return card;
}

export function updateRangeFill(rangeEl) {
    const v = Number(rangeEl.value);
    const pct = Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
    rangeEl.style.background = `linear-gradient(to right, #2563eb 0%, #2563eb ${pct}%, #d1d5db ${pct}%, #d1d5db 100%)`;
}

export function renderVolumeSlider({ getVolume, setVolume, updateRangeFill }) {
    const wrap = el("div", "volumeWrap");
    const label = el("div", "volumeLabel", `Volume: ${Math.round(getVolume())}`);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(getVolume());
    slider.className = "volumeSlider";
    updateRangeFill(slider);

    slider.addEventListener("input", () => {
        setVolume(Number(slider.value));
        label.textContent = `Volume: ${Math.round(getVolume())}`;
        updateRangeFill(slider);
    });

    wrap.appendChild(label);
    wrap.appendChild(slider);
    return wrap;
}
