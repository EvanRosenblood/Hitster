// public/youtube-audio.js
// Owns: YouTube IFrame player lifecycle + audio unlock + local volume persistence.

const VOL_KEY = "hitster_volume";

let ytReady = false;
let ytPlayer = null;
let audioUnlocked = false;

let pendingPlay = null; // { youtubeId, startAt }
let pendingCueId = null;

let currentVolume = Number(localStorage.getItem(VOL_KEY));
if (!Number.isFinite(currentVolume)) currentVolume = 60;

function clamp01to100(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 60;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function applyVolumeAndUnmute() {
    if (!ytReady || !ytPlayer) return;

    try {
        ytPlayer.setVolume(clamp01to100(currentVolume));
    } catch { }

    // Unmute only after a user gesture
    if (audioUnlocked) {
        try { ytPlayer.unMute?.(); } catch { }
    }
}

function tryPlayPending() {
    if (!pendingPlay) return;
    if (!ytReady || !ytPlayer) return;
    if (!audioUnlocked) return;

    const { youtubeId, startAt } = pendingPlay;
    const delay = Math.max(0, startAt - Date.now());

    try { ytPlayer.cueVideoById(youtubeId); } catch { }

    applyVolumeAndUnmute();

    setTimeout(() => {
        // Nudge right before play
        try { ytPlayer.unMute?.(); } catch { }
        try { ytPlayer.playVideo(); } catch { }
    }, delay);

    pendingPlay = null;
}

function unlockAudioOnce() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    applyVolumeAndUnmute();
    tryPlayPending();
}

document.addEventListener("pointerdown", unlockAudioOnce, { once: true });
document.addEventListener("keydown", unlockAudioOnce, { once: true });

export function initYouTubeAudio({ playerElementId = "player" } = {}) {
    function boot() {
        // If already created, don't recreate
        if (ytPlayer) return;

        // If YT isn't ready yet, bail (we'll be called again via callback)
        if (!window.YT || !window.YT.Player) return;

        ytPlayer = new window.YT.Player(playerElementId, {
            height: "1",
            width: "1",
            videoId: "",
            playerVars: {
                autoplay: 0,
                controls: 0,
                rel: 0,
                modestbranding: 1,
                fs: 0,
                iv_load_policy: 3,
                disablekb: 1,
                playsinline: 1,
            },
            events: {
                onReady: () => {
                    ytReady = true;
                    applyVolumeAndUnmute();

                    if (pendingCueId) {
                        try { ytPlayer.cueVideoById(pendingCueId); } catch { }
                    }

                    tryPlayPending();
                },
                onError: (e) => {
                    // 101 / 150 commonly mean "embedding not allowed"
                    console.warn("YouTube player error code:", e?.data);
                },
            },
        });
    }

    // Normal path: YouTube script will call this when ready
    window.onYouTubeIframeAPIReady = () => {
        boot();
    };

    // IMPORTANT: module scripts can run AFTER the API is already ready.
    // If YT is already available, boot immediately.
    boot();

    // Extra safety: if the script is in-flight, poll briefly until it appears.
    // (covers the case where onYouTubeIframeAPIReady was missed)
    if (!ytPlayer) {
        const started = Date.now();
        const t = setInterval(() => {
            if (ytPlayer) return clearInterval(t);
            boot();
            if (ytPlayer) return clearInterval(t);
            if (Date.now() - started > 4000) clearInterval(t);
        }, 50);
    }
}

export function play({ youtubeId, startAt }) {
    pendingCueId = youtubeId;

    if (ytReady && ytPlayer) {
        try { ytPlayer.cueVideoById(youtubeId); } catch { }
        applyVolumeAndUnmute();
    }

    pendingPlay = { youtubeId, startAt };
    tryPlayPending();
}

export function stop() {
    pendingPlay = null;
    pendingCueId = null;

    if (ytReady && ytPlayer) {
        try { ytPlayer.stopVideo(); } catch { }
    }
}

export function getVolume() {
    return currentVolume;
}

export function setVolume(v) {
    currentVolume = clamp01to100(v);
    localStorage.setItem(VOL_KEY, String(currentVolume));
    applyVolumeAndUnmute();
}
