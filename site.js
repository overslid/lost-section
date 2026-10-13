/* =====================================================================
   lost-section.com  |  site.js
   Wspólny skrypt wszystkich podstron:
     1. KONFIGURACJA (motto na pasku, licznik, start utworu)
     2. Player muzyczny (silnik Web Audio + interfejs w stylu Winampa)
     3. Górny pasek informacyjny (godzina, księżyc, licznik, motto)
     4. Moduły stron (galeria, blinkies, plansza IN PROGRESS)
     5. Nawigacja bez przeładowania strony (dzięki niej muzyka gra dalej)
   ===================================================================== */

/* ---------- 1. KONFIGURACJA ---------- */

// Motto na górnym pasku. Wszystkie wpisy jeżdżą w pętli, jeden za drugim.
// Możesz je swobodnie zmieniać, usuwać i dopisywać kolejne.
const TOPBAR_MOTTOS = [
    "Drzwi wyjściowe zawężają się z czasem",
    "The exit door narrows with time.",
    "出口の扉は、時とともに狭まっていく。"
];
const TOPBAR_MOTTO_SEPARATOR = "      ◆      ";
const TOPBAR_MOTTO_SPEED = 45; // prędkość jazdy (piksele na sekundę)

// Licznik wejść (counter12). Ładowany dopiero wtedy, gdy górny pasek jest widoczny.
const COUNTER_IMG = "https://www.counter12.com/img-z06AAw9dA8Cb8BW9-36.gif";
const COUNTER_AD  = "https://www.counter12.com/ad.js?id=z06AAw9dA8Cb8BW9";

// Od której sekundy startuje utwór (po STOP i przy pierwszym PLAY)
const TRACK_START = 5;

/* ---------- Stan globalny modułów stron ---------- */
let galleryImagesLoaded = [];
let currentIndex = 0;

function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return (mins < 10 ? "0" : "") + mins + ":" + (secs < 10 ? "0" : "") + secs;
}

const isMobileLayout = () => window.matchMedia('(max-width: 768px)').matches;

/* =====================================================================
   2. PLAYER
   ===================================================================== */

/* --- Odtwarzanie przez Web Audio (bufor) ---
   Utwór jest pobierany i dekodowany do bufora, a czas liczymy sami. Dzięki temu głośność,
   start od 5. sekundy, wznawianie po pauzie i przewijanie działają tak samo wszędzie
   (na iOS element <audio> podpięty pod Web Audio gubi czas i ignoruje przewijanie).
   Gdyby bufor zawiódł, kod wraca do zwykłego elementu <audio>. Interfejs jest taki sam.
   Dodatkowo daje analizator widma dla wizualizera. */
class BufferPlayer {
    constructor(url) {
        this.url = url;
        this.ctx = null;
        this.gain = null;
        this.analyser = null;
        this.buffer = null;
        this.source = null;
        this.offset = 0;
        this.startedAt = 0;
        this.paused = true;
        this.loading = false;
        this.duration = NaN;
        this.meta = null; // { kbps, khz, channels } po wczytaniu
        this._vol = 0;
        this._loadPromise = null;
        this._bytesPromise = null;
        this._bytesLength = 0;
    }
    _ensureCtx() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this._vol;
        this.gain.connect(this.ctx.destination);
        // analizator "podsłuchuje" dźwięk przed regulacją głośności (widmo nie zależy od suwaka)
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.7;
    }
    _fetchBytes() {
        if (!this._bytesPromise) {
            this._bytesPromise = fetch(this.url).then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.arrayBuffer();
            });
        }
        return this._bytesPromise;
    }
    // pobranie pliku z wyprzedzeniem (bez dekodowania), żeby pierwszy PLAY był szybszy
    prefetch() {
        this._fetchBytes().catch(() => { this._bytesPromise = null; });
    }
    _load() {
        if (this.buffer) return Promise.resolve();
        if (!this._loadPromise) {
            this._loadPromise = this._fetchBytes()
                .then(ab => {
                    this._bytesLength = ab.byteLength; // przed dekodowaniem (dekodowanie opróżnia bufor)
                    return new Promise((resolve, reject) => {
                        const p = this.ctx.decodeAudioData(ab, resolve, reject);
                        if (p && p.catch) p.catch(reject);
                    });
                })
                .then(buf => {
                    this.buffer = buf;
                    this.duration = buf.duration;
                    this.meta = {
                        kbps: Math.round(this._bytesLength * 8 / buf.duration / 1000),
                        khz: Math.round(buf.sampleRate / 1000),
                        channels: buf.numberOfChannels
                    };
                })
                .catch(err => { this._loadPromise = null; this._bytesPromise = null; throw err; });
        }
        return this._loadPromise;
    }
    get currentTime() {
        if (this.paused || !this.buffer) return this.offset;
        return (this.offset + (this.ctx.currentTime - this.startedAt)) % this.buffer.duration;
    }
    set currentTime(t) {
        this.offset = Math.max(0, t);
        if (!this.paused && this.buffer) this._startSource();
    }
    setGain(v) {
        this._vol = v;
        if (this.gain) this.gain.gain.value = v;
    }
    _stopSource() {
        if (!this.source) return;
        try { this.source.stop(); } catch (e) {}
        try { this.source.disconnect(); } catch (e) {}
        this.source = null;
    }
    _startSource() {
        this._stopSource();
        const s = this.ctx.createBufferSource();
        s.buffer = this.buffer;
        s.loop = true;
        s.connect(this.gain);
        s.connect(this.analyser);
        this.offset = this.offset % this.buffer.duration;
        s.start(0, this.offset);
        this.startedAt = this.ctx.currentTime;
        this.source = s;
    }
    play() {
        this._ensureCtx();
        // resume i "odblokowanie" muszą nastąpić synchronicznie w obsłudze kliknięcia (wymóg iOS)
        const resumeP = this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve();
        const resumed = Promise.race([resumeP, new Promise(r => setTimeout(r, 1500))]);
        try {
            const silent = this.ctx.createBuffer(1, 1, 22050);
            const src = this.ctx.createBufferSource();
            src.buffer = silent;
            src.connect(this.ctx.destination);
            src.start(0);
        } catch (e) {}
        this.loading = true;
        return Promise.all([resumed, this._load()]).then(() => {
            this.loading = false;
            this.gain.gain.value = this._vol;
            this.paused = false;
            this._startSource();
        }).catch(err => {
            this.loading = false;
            throw err;
        });
    }
    pause() {
        if (this.paused) return;
        this.offset = this.currentTime;
        this._stopSource();
        this.paused = true;
    }
    addEventListener() {} // brak zdarzeń timeupdate - interfejs korzysta z własnego zegara
}

/* --- Wyświetlacz 7-segmentowy (SVG) --- */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SEVEN_SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

function segPolygon(cx, cy, len, t, horizontal) {
    const h = len / 2, q = t / 2;
    const pts = horizontal
        ? [[cx - h, cy], [cx - h + q, cy - q], [cx + h - q, cy - q], [cx + h, cy], [cx + h - q, cy + q], [cx - h + q, cy + q]]
        : [[cx, cy - h], [cx + q, cy - h + q], [cx + q, cy + h - q], [cx, cy + h], [cx - q, cy + h - q], [cx - q, cy - h + q]];
    return pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
}

function createDigitSVG() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 14 24');
    svg.setAttribute('class', 'lp-digit');
    svg.setAttribute('aria-hidden', 'true');
    const t = 2.4;
    const defs = {
        a: [7, 1.5, 9.6, true],  g: [7, 12, 9.6, true],  d: [7, 22.5, 9.6, true],
        f: [1.6, 6.8, 9, false], b: [12.4, 6.8, 9, false],
        e: [1.6, 17.2, 9, false], c: [12.4, 17.2, 9, false]
    };
    Object.keys(defs).forEach(name => {
        const d = defs[name];
        const poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', segPolygon(d[0], d[1], d[2], t, d[3]));
        poly.setAttribute('data-seg', name);
        svg.appendChild(poly);
    });
    return svg;
}

function createColonSVG() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 4 24');
    svg.setAttribute('class', 'lp-colon');
    svg.setAttribute('aria-hidden', 'true');
    [8, 16].forEach(y => {
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', '0.8'); r.setAttribute('y', String(y - 1.2));
        r.setAttribute('width', '2.4'); r.setAttribute('height', '2.4');
        svg.appendChild(r);
    });
    return svg;
}

function setDigit(svg, value) {
    const on = SEVEN_SEG[value] || '';
    svg.querySelectorAll('polygon').forEach(p => {
        p.classList.toggle('on', on.indexOf(p.getAttribute('data-seg')) !== -1);
    });
}

/* --- Ikony przycisków i stanu (SVG) --- */
const ICONS = {
    play:  '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1 L9 5 L2 9 Z"/></svg>',
    pause: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="1" width="2.2" height="8"/><rect x="5.8" y="1" width="2.2" height="8"/></svg>',
    stop:  '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7"/></svg>',
    load:  '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="4" width="2" height="2"/><rect x="4" y="4" width="2" height="2"/><rect x="7.5" y="4" width="2" height="2"/></svg>'
};

function initPlayer() {
    const root = document.getElementById('lsPlayer');
    const audioEl = document.getElementById('bgAudio');
    if (!root || !audioEl) return;

    const playBtn = document.getElementById('lpPlay');
    const pauseBtn = document.getElementById('lpPause');
    const stopBtn = document.getElementById('lpStop');
    const stateIcon = document.getElementById('lpState');
    const digitsEl = document.getElementById('lpDigits');
    const totalEl = document.getElementById('lpTotal');
    const titleEl = document.getElementById('lpTitleText');
    const kbpsEl = document.getElementById('lpKbps');
    const khzEl = document.getElementById('lpKhz');
    const chEl = document.getElementById('lpCh');
    const progressFill = document.getElementById('progressBar');
    const progressContainer = document.getElementById('progressContainer');
    const volumeBar = document.getElementById('volumeBar');
    const volumeFill = document.getElementById('volumeFill');
    const volNum = document.getElementById('lpVolNum');
    const canvas = document.getElementById('lpSpectrum');

    playBtn.innerHTML = ICONS.play;
    pauseBtn.innerHTML = ICONS.pause;
    stopBtn.innerHTML = ICONS.stop;

    /* ----- wybór silnika ----- */
    const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let usesBuffer = !!(window.AudioContext || window.webkitAudioContext);
    let audio = usesBuffer ? new BufferPlayer(audioEl.getAttribute('src')) : audioEl;

    /* ----- iOS: dźwięk ma grać mimo bocznego przełącznika wyciszenia -----
       Web Audio jest domyślnie wyciszane przełącznikiem, a zwykły <audio> nie. Ustawiamy sesję audio
       na "playback" (iOS 16.4+) i dodatkowo odtwarzamy w tle cichy, zapętlony plik (starsze iOS). */
    const SILENT_WAV = 'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAGAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
    let silentEl = null;
    function startSilentKeeper() {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
        try {
            if (!silentEl) {
                silentEl = new Audio(SILENT_WAV);
                silentEl.loop = true;
                silentEl.setAttribute('playsinline', '');
            }
            const pr = silentEl.play();
            if (pr && pr.catch) pr.catch(() => {});
        } catch (e) {}
    }
    function stopSilentKeeper() {
        try { if (silentEl) silentEl.pause(); } catch (e) {}
    }

    /* ----- głośność ----- */
    let targetVolume = 0.15;
    let audioCtx = null;   // tylko awaryjnie na iOS (gdy bufor zawiedzie)
    let gainNode = null;

    function ensureAudioGraph() {
        // Obejście przez Web Audio jest potrzebne tylko na iOS (tam audio.volume nie działa),
        // a i tam tylko awaryjnie. Na desktopie i Androidzie gra zwykłe <audio> z audio.volume.
        if (!isIOS || usesBuffer || audioCtx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC();
            const source = audioCtx.createMediaElementSource(audioEl);
            gainNode = audioCtx.createGain();
            gainNode.gain.value = 0;
            source.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            audioEl.volume = 1;
        } catch (e) {
            audioCtx = null;
            gainNode = null;
        }
    }

    function setVolume(v) {
        if (usesBuffer) {
            audio.setGain(v);
        } else if (gainNode) {
            gainNode.gain.value = v;
        } else {
            audio.volume = v;
        }
    }

    /* ----- segmentowe suwaki ----- */
    const SEG = 4; // 3px segment + 1px przerwy
    const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

    function setSegFill(fillEl, barEl, ratio) {
        const segCount = Math.max(1, Math.round((barEl.clientWidth + 1) / SEG));
        const filled = Math.round(clamp01(ratio) * segCount);
        fillEl.style.width = filled ? (filled * SEG - 1) + 'px' : '0px';
    }
    function renderVolume() {
        setSegFill(volumeFill, volumeBar, targetVolume);
        volumeBar.setAttribute('aria-valuenow', Math.round(targetVolume * 100));
        volNum.textContent = String(Math.round(targetVolume * 100)).padStart(2, '0');
    }
    function currentProgressRatio() {
        return audio.duration ? audio.currentTime / audio.duration : 0;
    }
    function renderProgress(ratio) {
        setSegFill(progressFill, progressContainer, ratio);
        progressContainer.setAttribute('aria-valuenow', Math.round(clamp01(ratio) * 100));
    }

    // Przeciąganie myszką/palcem po suwaku (pointer events)
    // onChange(ratio, final, isStart): isStart = pierwszy dotyk, final = koniec gestu
    function bindSegDrag(el, onChange) {
        let active = false;
        let lastRatio = 0;
        const ratioOf = (e) => {
            const r = el.getBoundingClientRect();
            return clamp01((e.clientX - r.left) / r.width);
        };
        el.addEventListener('pointerdown', (e) => {
            active = true;
            try { el.setPointerCapture(e.pointerId); } catch (err) {}
            lastRatio = ratioOf(e);
            onChange(lastRatio, false, true);
        });
        el.addEventListener('pointermove', (e) => {
            if (!active) return;
            lastRatio = ratioOf(e);
            onChange(lastRatio, false, false);
        });
        const finish = (e) => {
            if (!active) return;
            active = false;
            if (e && typeof e.clientX === 'number' && e.type === 'pointerup') lastRatio = ratioOf(e);
            onChange(lastRatio, true, false); // także przy pointercancel (iOS) - ostatnia pozycja
        };
        el.addEventListener('pointerup', finish);
        el.addEventListener('pointercancel', finish);
    }

    /* ----- wyświetlacz czasu ----- */
    const dEls = [createDigitSVG(), createDigitSVG(), createColonSVG(), createDigitSVG(), createDigitSVG()];
    dEls.forEach(el => digitsEl.appendChild(el));
    let lastDigits = '';
    function renderTime(sec) {
        const s = Math.max(0, Math.floor(sec || 0));
        const mm = Math.floor(s / 60) % 100;
        const ss = s % 60;
        const str = String(mm).padStart(2, '0') + String(ss).padStart(2, '0');
        if (str === lastDigits) return;
        lastDigits = str;
        setDigit(dEls[0], +str[0]);
        setDigit(dEls[1], +str[1]);
        setDigit(dEls[3], +str[2]);
        setDigit(dEls[4], +str[3]);
    }

    /* ----- stan interfejsu ----- */
    function setState(state) {
        root.classList.remove('is-idle', 'is-loading', 'is-playing', 'is-paused');
        root.classList.add('is-' + state);
        playBtn.classList.toggle('on', state === 'playing' || state === 'loading');
        pauseBtn.classList.toggle('on', state === 'paused');
        stopBtn.classList.toggle('on', false);
        stateIcon.innerHTML = state === 'playing' ? ICONS.play
                            : state === 'paused' ? ICONS.pause
                            : state === 'loading' ? ICONS.load
                            : ICONS.stop;
    }

    const originalTitle = titleEl.textContent;
    function flashError() {
        titleEl.textContent = 'PLAYBACK ERROR - CLICK PLAY TO TRY AGAIN';
        setTimeout(() => { titleEl.textContent = originalTitle; }, 2600);
    }

    function updateMeta() {
        if (usesBuffer && audio.meta) {
            kbpsEl.textContent = audio.meta.kbps;
            khzEl.textContent = audio.meta.khz;
            chEl.textContent = audio.meta.channels === 1 ? 'MONO' : 'STEREO';
        }
        if (audio.duration && isFinite(audio.duration)) {
            totalEl.textContent = 'TOT ' + formatTime(audio.duration);
        }
    }

    /* ----- sterowanie ----- */
    let fadeInterval = null;
    let resumePending = false; // true po PAUSE: PLAY wznawia od miejsca zatrzymania (po STOP / na starcie: od 5 s)
    let seekDragging = false;

    audio.currentTime = TRACK_START;
    if (!usesBuffer) audio.volume = 0;
    renderTime(TRACK_START);
    setState('idle');

    function startPlayback() {
        if (audio.loading || !audio.paused) return;
        ensureAudioGraph();
        if (!resumePending) audio.currentTime = TRACK_START;
        resumePending = false;
        setVolume(0);
        if (isIOS) startSilentKeeper(); // musi być w obsłudze kliknięcia
        if (usesBuffer || audio.readyState < 3) setState('loading');

        audio.play().then(() => {
            setState('playing');
            updateMeta();

            // Płynne podgłaśnianie (fade-in) do ustawionej głośności
            clearInterval(fadeInterval);
            let currentVol = 0;
            fadeInterval = setInterval(() => {
                currentVol += targetVolume / 20;
                if (currentVol >= targetVolume) {
                    setVolume(targetVolume);
                    clearInterval(fadeInterval);
                } else {
                    setVolume(currentVol);
                }
            }, 50);
        }).catch((err) => {
            console.warn('Odtwarzanie nie wystartowało:', err);
            stopSilentKeeper();
            if (usesBuffer) {
                // silnik buforowy zawiódł (pobieranie/dekodowanie) -> wracamy do zwykłego <audio>,
                // które zadziała od następnego kliknięcia
                usesBuffer = false;
                audio = audioEl;
                resumePending = false;
                audio.currentTime = TRACK_START;
                audio.volume = 0;
            }
            setState('idle');
            flashError();
        });
    }

    function pausePlayback() {
        if (audio.paused || audio.loading) return;
        clearInterval(fadeInterval);
        stopSilentKeeper();
        audio.pause();
        resumePending = true;
        setState('paused');
    }

    playBtn.addEventListener('click', startPlayback);
    pauseBtn.addEventListener('click', function() {
        if (!audio.paused) pausePlayback();
        else if (resumePending) startPlayback(); // PAUSE działa jak przełącznik (jak w Winampie)
    });
    stopBtn.addEventListener('click', function() {
        if (audio.loading) return;
        clearInterval(fadeInterval);
        stopSilentKeeper();
        audio.pause();
        resumePending = false;
        audio.currentTime = TRACK_START;
        setVolume(targetVolume);
        setState('idle');
        renderProgress(0);
        renderTime(TRACK_START);
    });

    // Przewijanie: w trakcie przeciągania tylko podgląd, przeskok po puszczeniu palca.
    // Na telefonie przewijanie jest wyłączone.
    bindSegDrag(progressContainer, function(ratio, final, isStart) {
        if (isMobileLayout()) return;
        seekDragging = !final;
        renderProgress(ratio);
        if ((final || isStart) && audio.duration && isFinite(audio.duration)) {
            audio.currentTime = ratio * audio.duration;
            renderTime(ratio * audio.duration);
        }
    });

    // Głośność
    bindSegDrag(volumeBar, function(ratio) {
        // zaokrąglenie do pełnych segmentów: to co widać = to co słychać (skrajnie w lewo = mute)
        const segCount = Math.max(1, Math.round((volumeBar.clientWidth + 1) / SEG));
        targetVolume = Math.round(ratio * segCount) / segCount;
        clearInterval(fadeInterval); // użytkownik przejmuje kontrolę nad głośnością
        setVolume(targetVolume);
        renderVolume();
    });

    // Obsługa klawiatury (strzałki)
    volumeBar.addEventListener('keydown', function(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        targetVolume = clamp01(targetVolume + (e.key === 'ArrowRight' ? 0.05 : -0.05));
        clearInterval(fadeInterval);
        setVolume(targetVolume);
        renderVolume();
        e.preventDefault();
    });
    progressContainer.addEventListener('keydown', function(e) {
        if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !audio.duration || isMobileLayout()) return;
        audio.currentTime = Math.min(Math.max(audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5), 0), audio.duration);
        e.preventDefault();
    });

    audioEl.addEventListener('error', function() {
        console.warn('Błąd elementu audio, kod:', audioEl.error && audioEl.error.code);
    });

    /* ----- własny zegar: czas, pasek postępu, parametry utworu ----- */
    setInterval(function() {
        if (!audio.paused && audio.duration && isFinite(audio.duration)) {
            if (!seekDragging) {
                renderProgress(currentProgressRatio());
                renderTime(audio.currentTime);
            }
            updateMeta();
        }
    }, 150);

    /* ----- wizualizer widma (canvas) ----- */
    const g = canvas.getContext('2d');
    const BARS = 20;
    const levels = new Array(BARS).fill(0);
    const peaks = new Array(BARS).fill(0);
    const peakHold = new Array(BARS).fill(0);
    let freqData = null;
    let cw = 0, ch = 0, drawnBlank = false;

    function sizeCanvas() {
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const dpr = Math.max(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        cw = r.width; ch = r.height;
        drawnBlank = false;
    }
    sizeCanvas();

    function spectrumFrame() {
        requestAnimationFrame(spectrumFrame);
        if (document.hidden || !cw) return;
        const playing = !audio.paused;
        const analyser = usesBuffer ? audio.analyser : null;

        // docelowe poziomy słupków
        const target = new Array(BARS).fill(0);
        if (playing && analyser) {
            if (!freqData) freqData = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(freqData);
            const usable = Math.floor(freqData.length * 0.62); // bez najwyższych, pustych częstotliwości
            for (let i = 0; i < BARS; i++) {
                const a = Math.floor(Math.pow(i / BARS, 1.7) * usable);
                const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / BARS, 1.7) * usable));
                let sum = 0;
                for (let k = a; k < b; k++) sum += freqData[k];
                target[i] = Math.min(1, (sum / (b - a)) / 255 * 1.15);
            }
        } else if (playing) {
            for (let i = 0; i < BARS; i++) target[i] = Math.random() * (1 - i / (BARS * 1.4));
        }

        let any = false;
        for (let i = 0; i < BARS; i++) {
            levels[i] = target[i] > levels[i] ? target[i] : Math.max(target[i], levels[i] - 0.06);
            if (levels[i] >= peaks[i]) { peaks[i] = levels[i]; peakHold[i] = 14; }
            else if (peakHold[i] > 0) peakHold[i]--;
            else peaks[i] = Math.max(0, peaks[i] - 0.025);
            if (levels[i] > 0.001 || peaks[i] > 0.001) any = true;
        }
        if (!any && drawnBlank) return;
        drawnBlank = !any;

        g.clearRect(0, 0, cw, ch);
        const gap = 1.5;
        const bw = (cw - gap * (BARS - 1)) / BARS;
        const segH = 3, segGap = 1;
        const rows = Math.floor((ch + segGap) / (segH + segGap));
        for (let i = 0; i < BARS; i++) {
            const x = i * (bw + gap);
            const lit = Math.round(levels[i] * rows);
            for (let r = 0; r < rows; r++) {
                const y = ch - (r + 1) * segH - r * segGap;
                g.fillStyle = r < lit ? (r / rows > 0.7 ? '#6fae8a' : '#4d8f6a') : 'rgba(38,73,53,0.28)';
                g.fillRect(x, y, bw, segH);
            }
            const pr = Math.min(rows - 1, Math.round(peaks[i] * rows));
            if (peaks[i] > 0.02 && pr >= lit) {
                g.fillStyle = '#ffffff';
                g.fillRect(x, ch - (pr + 1) * segH - pr * segGap, bw, segH);
            }
        }
    }
    requestAnimationFrame(spectrumFrame);

    /* ----- start: prefetch utworu na desktopie po załadowaniu strony ----- */
    window.addEventListener('load', function() {
        if (!isMobileLayout()) {
            setTimeout(function() { if (audio.prefetch) audio.prefetch(); }, 800);
        }
    });

    renderVolume();
    renderProgress(0);
    window.addEventListener('resize', function() {
        renderVolume();
        renderProgress(seekDragging ? 0 : currentProgressRatio());
        sizeCanvas();
    });
}

/* =====================================================================
   3. GÓRNY PASEK (godzina w Warszawie, księżyc, licznik, motto)
   ===================================================================== */

const MOON_NAMES = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous',
                    'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];

// Faza księżyca liczona wzorem (miesiąc synodyczny), bez zewnętrznych zapytań. Zwraca 0..1
function moonPhase(date) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const SYNODIC = 29.530588853;
    const p = ((jd - 2451550.1) / SYNODIC) % 1;
    return p < 0 ? p + 1 : p;
}

function moonSVG(p, size) {
    const r = 10, c = 12;
    const waxing = p < 0.5;
    const k = Math.cos(p * 2 * Math.PI);          // 1 = nów, -1 = pełnia
    const rx = Math.abs(k) * r;
    const limbSweep = waxing ? 1 : 0;
    const termSweep = (waxing === (k > 0)) ? 0 : 1;
    const lit = 'M ' + c + ' ' + (c - r) + ' A ' + r + ' ' + r + ' 0 0 ' + limbSweep + ' ' + c + ' ' + (c + r) +
                ' A ' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + termSweep + ' ' + c + ' ' + (c - r) + ' Z';
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true">' +
           '<circle cx="12" cy="12" r="10" fill="#031203" stroke="#0a7d0a" stroke-width="1.6"/>' +
           '<path d="' + lit + '" fill="#00ff00"/></svg>';
}

function initTopbar() {
    const bar = document.getElementById('topbar');
    if (!bar) return;

    /* godzina w Warszawie */
    const hhEl = document.getElementById('tbHH');
    const mmEl = document.getElementById('tbMM');
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    function updateClock() {
        const parts = fmt.formatToParts(new Date());
        const get = (t) => (parts.find(p => p.type === t) || {}).value || '--';
        hhEl.textContent = get('hour');
        mmEl.textContent = get('minute');
    }
    updateClock();
    setInterval(updateClock, 1000);

    /* faza księżyca */
    const moonIcon = document.getElementById('tbMoonIcon');
    const moonText = document.getElementById('tbMoonText');
    function updateMoon() {
        const p = moonPhase(new Date());
        moonText.textContent = MOON_NAMES[Math.floor(p * 8 + 0.5) % 8];
        moonIcon.innerHTML = moonSVG(p, isMobileLayout() ? 9 : 12);
    }
    updateMoon();
    setInterval(updateMoon, 30 * 60 * 1000);

    /* motto (jeżdżący tekst) */
    const mottoInner = document.getElementById('tbMottoInner');
    function buildMotto() {
        const text = TOPBAR_MOTTOS.join(TOPBAR_MOTTO_SEPARATOR) + TOPBAR_MOTTO_SEPARATOR;
        mottoInner.textContent = text;
        const row = document.getElementById('tbRow');
        const motto = document.getElementById('tbMotto');
        // Tekst ma być widoczny od razu po wejściu na stronę (ujemne opóźnienie animacji
        // "przewija" ją do momentu, w którym początek tekstu jest przy lewej krawędzi).
        const cw = motto.clientWidth || 600;
        const dur = Math.max(10, mottoInner.scrollWidth / TOPBAR_MOTTO_SPEED);
        bar.style.setProperty('--tb-dur', dur.toFixed(1) + 's');
        bar.style.setProperty('--tb-delay', (-(cw * 0.97) / TOPBAR_MOTTO_SPEED).toFixed(1) + 's');
        const mSpeed = TOPBAR_MOTTO_SPEED * 0.8; // na telefonie trochę wolniej
        const pw = row.parentElement.clientWidth || 380;
        const mobDur = Math.max(15, row.scrollWidth / mSpeed);
        bar.style.setProperty('--tb-dur-m', mobDur.toFixed(1) + 's');
        bar.style.setProperty('--tb-delay-m', (-((pw - 8) / mSpeed)).toFixed(1) + 's');
        bar.classList.add('tb-ready'); // parametry gotowe: można uruchomić animację
    }
    buildMotto();
    window.addEventListener('resize', function() { updateMoon(); buildMotto(); });

    /* ukrycie segmentu licznika, gdy licznik nie załaduje się (np. adblock) */
    const img = document.getElementById('tbCounterImg');
    if (img) {
        img.addEventListener('error', function() {
            const seg = document.getElementById('tbVisits');
            if (seg) seg.style.display = 'none';
        });
    }
}

// Licznik (obrazek + skrypt counter12) ładujemy raz, dopiero gdy pasek jest widoczny
let counterLoaded = false;
function ensureCounterLoaded() {
    if (counterLoaded) return;
    const img = document.getElementById('tbCounterImg');
    if (!img) return;
    counterLoaded = true;
    img.src = COUNTER_IMG;
    const s = document.createElement('script');
    s.src = COUNTER_AD;
    s.async = true;
    document.body.appendChild(s);
}

function applyPageSettings() {
    const content = document.getElementById('pageContent');
    const show = !content || content.getAttribute('data-topbar') !== 'off';
    document.body.setAttribute('data-topbar', show ? 'on' : 'off');
    if (show) {
        ensureCounterLoaded();
        // po pokazaniu paska przeliczamy szerokość tekstu motta
        window.dispatchEvent(new Event('resize'));
    }
}

/* =====================================================================
   4. MODUŁY STRON
   ===================================================================== */

/* --- zastępcze guziki nawigacji, dopóki nie wrzucisz właściwych plików .png --- */
function placeholderSrc(label) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="116" height="50" viewBox="0 0 116 50">' +
        '<rect x="1" y="1" width="114" height="48" rx="3" fill="#0d1a13" stroke="#264935" stroke-width="2" stroke-dasharray="4 3"/>' +
        '<text x="58" y="30" text-anchor="middle" font-family="monospace" font-size="13" fill="#264935">' + label + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function initNavPlaceholders() {
    document.querySelectorAll('#navBar a img').forEach(function(img) {
        const label = (img.getAttribute('alt') || '').toUpperCase();
        const apply = function() {
            if (img.getAttribute('data-ph')) return;
            img.setAttribute('data-ph', '1');
            img.src = placeholderSrc(label);
        };
        if (img.complete && img.naturalWidth === 0) apply();
        else img.addEventListener('error', apply, { once: true });
    });
}

/* --- pływające guziki nawigacji (efekt przy ruchu myszką) --- */
function initOrganicButtonParallax() {
    const navBar = document.getElementById('navBar');
    if (!navBar) return;
    const buttons = navBar.querySelectorAll('a');
    if (buttons.length === 0) return;

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;

    window.addEventListener('mousemove', function(e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    const buttonConfigs = [
        { rangeX: 7, rangeY: 5, offset: 0 },
        { rangeX: 5, rangeY: 8, offset: 2 },
        { rangeX: 8, rangeY: 6, offset: 4 },
        { rangeX: 6, rangeY: 7, offset: 6 },
        { rangeX: 7, rangeY: 5, offset: 8 }
    ];

    function animateButtons() {
        if (window.innerWidth > 768) {
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;
            const normX = (mouseX - centerX) / centerX;
            const normY = (mouseY - centerY) / centerY;

            buttons.forEach((btn, index) => {
                const cfg = buttonConfigs[index] || buttonConfigs[0];
                const time = Date.now() * 0.001;
                const floatX = Math.sin(time * 1.5 + cfg.offset) * 2;
                const floatY = Math.cos(time * 1.2 + cfg.offset) * 2.5;

                const moveX = (normX * cfg.rangeX) + floatX;
                const moveY = (normY * cfg.rangeY) + floatY;

                btn.style.transform = `translate(${moveX}px, ${moveY}px)`;
            });
        } else {
            buttons.forEach(btn => {
                btn.style.transform = '';
            });
        }
        requestAnimationFrame(animateButtons);
    }
    requestAnimationFrame(animateButtons);
}

/* --- plansza IN PROGRESS: nazwa sekcji z atrybutu data-section albo z nazwy pliku --- */
function initSectionLabel() {
    const box = document.getElementById('inProgress');
    const label = document.getElementById('ipSection');
    if (!box || !label) return;
    let name = (box.getAttribute('data-section') || '').trim();
    if (!name) {
        const last = location.pathname.split('/').filter(Boolean).pop() || '';
        name = last.replace(/\.[a-z0-9]+$/i, '');
    }
    name = (name || 'PAGE').replace(/[-_]+/g, ' ').toUpperCase();
    label.textContent = name;
    document.title = 'lost-section.com | ' + name;
}

/* --- galeria --- */
function initGallery() {
    const track = document.getElementById('carouselTrack');
    if (!track) return;
    galleryImagesLoaded = [];
    currentIndex = 0;
    const maxToCheck = 15;

    function renderGallery() {
        if (!document.body.contains(track)) return; // strona została już podmieniona
        track.innerHTML = '';
        galleryImagesLoaded.forEach((item, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'carousel-item';
            if (idx === currentIndex) itemDiv.classList.add('active');
            itemDiv.innerHTML = `<img src="${item.path}" alt="Galeria" onclick="openLightbox('${item.path}')">`;
            track.appendChild(itemDiv);
        });
        updateGalleryActiveState();
    }

    for (let i = 1; i <= maxToCheck; i++) {
        const imgPath = `ls-gallery/${i}.jpg`;
        const img = new Image();
        img.onload = function() {
            galleryImagesLoaded.push({ index: i, path: imgPath });
            galleryImagesLoaded.sort((a, b) => a.index - b.index);
            renderGallery();
        };
        img.onerror = function() {};
        img.src = imgPath;
    }
}

function updateGalleryActiveState() {
    const track = document.getElementById('carouselTrack');
    if (!track) return;
    const items = track.querySelectorAll('.carousel-item');
    if (items.length === 0) return;

    items.forEach((item) => { item.className = 'carousel-item'; });

    if (items[currentIndex]) {
        items[currentIndex].classList.add('active');

        const prevIndex = (currentIndex - 1 + galleryImagesLoaded.length) % galleryImagesLoaded.length;
        if (items[prevIndex]) items[prevIndex].classList.add('prev-item');

        const nextIndex = (currentIndex + 1) % galleryImagesLoaded.length;
        if (items[nextIndex]) items[nextIndex].classList.add('next-item');
    }
}

function scrollGallery(direction) {
    if (galleryImagesLoaded.length === 0) return;
    currentIndex = (currentIndex + direction + galleryImagesLoaded.length) % galleryImagesLoaded.length;
    updateGalleryActiveState();
}

function openLightbox(src) {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = src;
    lightbox.style.display = 'flex';
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    if (lightbox) lightbox.style.display = 'none';
}

/* --- blinkies --- */
function loadAndRandomizeBlinkies() {
    const blinkiesContainer = document.getElementById('microBannersSection');
    if (!blinkiesContainer) return;

    const baseNames = [];
    for (let n = 1; n <= 50; n++) {
        baseNames.push(`ls-blinkies/banner${n}`);
    }

    const extensions = ['.gif', '.png', '.jpg'];
    const isMobile = window.innerWidth <= 768;
    const limitCount = isMobile ? 10 : 15;

    let shuffledBases = [...baseNames];
    for (let j = shuffledBases.length - 1; j > 0; j--) {
        const r = Math.floor(Math.random() * (j + 1));
        [shuffledBases[j], shuffledBases[r]] = [shuffledBases[r], shuffledBases[j]];
    }

    blinkiesContainer.innerHTML = '';
    let loadedCount = 0;
    let indexToTry = 0;

    function tryFetchNext() {
        if (!document.body.contains(blinkiesContainer)) return; // strona została już podmieniona
        if (loadedCount >= limitCount || indexToTry >= shuffledBases.length) return;

        const currentBasePath = shuffledBases[indexToTry];
        indexToTry++;

        let extIndex = 0;

        function testExtension() {
            if (extIndex >= extensions.length) {
                tryFetchNext();
                return;
            }

            const testPath = currentBasePath + extensions[extIndex];
            extIndex++;

            const testImg = new Image();
            testImg.src = testPath;

            testImg.onload = function() {
                if (!document.body.contains(blinkiesContainer)) return;
                const bannerDiv = document.createElement('div');
                bannerDiv.className = 'micro-banner-item';
                bannerDiv.innerHTML = `<img src="${testPath}" alt="">`;
                blinkiesContainer.appendChild(bannerDiv);

                loadedCount++;
                tryFetchNext();
            };

            testImg.onerror = function() {
                testExtension();
            };
        }
        testExtension();
    }
    tryFetchNext();
}

// Inicjalizacja treści konkretnej strony (wywoływana po wczytaniu i po każdej podmianie treści)
function initPage() {
    applyPageSettings();
    initSectionLabel();
    initGallery();
    loadAndRandomizeBlinkies();
}

/* =====================================================================
   5. NAWIGACJA BEZ PRZEŁADOWANIA (muzyka gra dalej)
   Kliknięcia w linki do własnych podstron pobierają nową stronę w tle i podmieniają
   tylko blok #pageContent. Player, górny pasek i nawigacja zostają nietknięte.
   Gdy cokolwiek pójdzie nie tak, następuje zwykłe przejście na nową stronę.
   ===================================================================== */
let navigating = false;

function swapPage(doc, url, push) {
    const next = doc.getElementById('pageContent');
    const cur = document.getElementById('pageContent');
    if (!next || !cur) return false;

    cur.innerHTML = next.innerHTML;
    cur.setAttribute('data-topbar', next.getAttribute('data-topbar') || 'on');
    if (doc.title) document.title = doc.title;
    if (push) history.pushState({ pjax: true }, '', url);

    cur.classList.remove('pc-enter');
    void cur.offsetWidth; // restart animacji
    cur.classList.add('pc-enter');

    window.scrollTo(0, 0);
    initPage();
    return true;
}

function navigateTo(url, push) {
    if (navigating) return;
    navigating = true;
    fetch(url, { credentials: 'same-origin' })
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
        })
        .then(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            if (!swapPage(doc, url, push)) throw new Error('brak #pageContent');
            navigating = false;
        })
        .catch(() => {
            navigating = false;
            window.location.href = url; // awaryjnie: zwykłe przejście (muzyka zostanie przerwana)
        });
}

function initRouter() {
    if (location.protocol === 'file:') return; // lokalnie (bez serwera) nawigacja zostaje zwykła
    history.replaceState({ pjax: true }, '', location.href);

    document.addEventListener('click', function(e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        if (a.target && a.target !== '_self') return;
        if (a.hasAttribute('download')) return;
        const href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#' || /^(mailto|tel|javascript):/i.test(href)) return;

        let url;
        try { url = new URL(a.href, location.href); } catch (err) { return; }
        if (url.origin !== location.origin) return;
        const ext = (url.pathname.split('/').pop().match(/\.([a-z0-9]+)$/i) || [])[1];
        if (ext && !/^html?$/i.test(ext)) return; // pliki (pdf, zip, obrazki) otwieramy normalnie

        e.preventDefault();
        if (url.pathname === location.pathname && url.search === location.search) {
            window.scrollTo(0, 0); // ta sama strona: bez przeładowania (żeby nie przerywać muzyki)
            return;
        }
        navigateTo(url.href, true);
    });

    window.addEventListener('popstate', function() {
        navigateTo(location.href, false);
    });
}

/* =====================================================================
   START
   ===================================================================== */
document.addEventListener('DOMContentLoaded', function() {
    initNavPlaceholders();
    initPlayer();
    initTopbar();
    initOrganicButtonParallax();
    initPage();
    initRouter();
});
