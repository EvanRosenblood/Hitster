// public/render/components.js
// Small reusable UI components.

export function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

export function renderSongCard(song) {
    const card = el("div", "songCard");
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
