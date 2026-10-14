/* =====================================================================
   lost-section.com  |  site.js
   Wspólny skrypt wszystkich podstron:
     1. KONFIGURACJA (motto, licznik, galeria, start utworu)
     2. Silnik dźwięku (działa niezależnie od tego, czy na stronie jest player)
     3. Wygląd playera (podłącza się do silnika)
     4. Galeria (okno-playlista pod playerem)
     5. Górny pasek informacyjny
     6. Pozostałe moduły stron
     7. Nawigacja bez przeładowania strony (dzięki niej muzyka gra dalej)
   ===================================================================== */

/* ---------- 1. KONFIGURACJA ---------- */

// MOTTO na górnym pasku. Każde motto to lista tłumaczeń (np. PL, EN, JP), które jeżdżą w pętli.
// Jeśli dodasz kilka mott, strona pokazuje jedno na dobę (kolejne dnia następnego, po ostatnim wraca do pierwszego).
// Żeby dodać nowe motto, odkomentuj lub skopiuj przykładowy blok poniżej i wpisz swoje teksty.
const TOPBAR_MOTTOS = [
    [
        "Drzwi wyjściowe zawężają się z czasem",
        "The exit door narrows with time.",
        "出口の扉は、時とともに狭まっていく。"
    ]
    // ,[
    //     "Twoje kolejne motto po polsku",
    //     "Your next motto in English",
    //     "日本語のモットー"
    // ]
];
const TOPBAR_MOTTO_SEPARATOR = "      ◆      ";
const TOPBAR_MOTTO_SPEED = 45; // prędkość jazdy (piksele na sekundę)

// Licznik wejść (counter12). Ładowany dopiero wtedy, gdy górny pasek jest widoczny.
const COUNTER_IMG = "https://www.counter12.com/img-z06AAw9dA8Cb8BW9-36.gif";
const COUNTER_AD  = "https://www.counter12.com/ad.js?id=z06AAw9dA8Cb8BW9";

// Od której sekundy startuje utwór (po STOP i przy pierwszym PLAY)
const TRACK_START = 5;

// GALERIA: zdjęcia z folderu poniżej są wykrywane automatycznie (dowolne nazwy i dowolna liczba).
// Do wykrycia używamy listy plików z GitHuba. Jeśli repozytorium zmieni nazwę albo właściciela,
// popraw dane poniżej (albo wpisz null, wtedy działają tylko zdjęcia o nazwach 1.jpg, 2.jpg, 3.jpg...).
const GALLERY_FOLDER = 'ls-gallery';
const GALLERY_GITHUB = { owner: 'overslid', repo: 'lost-section', branch: 'main' };
const GALLERY_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];   // używane tylko przy zdjęciach 1.jpg, 2.jpg...
const GALLERY_MAX = 120;                                             // limit zdjęć w trybie 1.jpg, 2.jpg...
const GALLERY_AUTO_MS = 4500;                                        // co ile przeskakuje tryb AUTO

function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return (mins < 10 ? "0" : "") + mins + ":" + (secs < 10 ? "0" : "") + secs;
}

const isMobileLayout = () => window.matchMedia('(max-width: 768px)').matches;

// Sprzątanie po komponentach strony (player, galeria) przy podmianie treści
let pageCleanups = [];
function unmountPage() {
    pageCleanups.forEach(fn => { try { fn(); } catch (e) {} });
    pageCleanups = [];
}

/* =====================================================================
   2. SILNIK DŹWIĘKU
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

/* --- Silnik: jeden na całą stronę, nie znika przy zmianie podstrony --- */
const SILENT_WAV = 'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAGAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

const Engine = {
    ready: false,
    state: 'idle',            // idle | loading | playing | paused
    targetVolume: 0.15,
    resumePending: false,     // true po PAUSE: PLAY wznawia od miejsca zatrzymania (po STOP / na starcie: od TRACK_START)
    fadeInterval: null,
    listeners: [],
    audioEl: null,
    audio: null,
    usesBuffer: false,
    isIOS: false,
    audioCtx: null,           // tylko awaryjnie na iOS (gdy bufor zawiedzie)
    gainNode: null,
    silentEl: null,

    init() {
        if (this.ready) return;
        this.audioEl = document.getElementById('bgAudio');
        if (!this.audioEl) return;
        this.ready = true;
        this.isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        this.usesBuffer = !!(window.AudioContext || window.webkitAudioContext);
        this.audio = this.usesBuffer ? new BufferPlayer(this.audioEl.getAttribute('src')) : this.audioEl;
        this.audio.currentTime = TRACK_START;
        if (!this.usesBuffer) this.audio.volume = 0;
        this.audioEl.addEventListener('error', () => {
            console.warn('Błąd elementu audio, kod:', this.audioEl.error && this.audioEl.error.code);
        });
        // prefetch utworu na desktopie po załadowaniu strony
        window.addEventListener('load', () => {
            if (!isMobileLayout()) {
                setTimeout(() => { if (this.audio.prefetch) this.audio.prefetch(); }, 800);
            }
        });
    },

    on(fn) {
        this.listeners.push(fn);
        return () => { this.listeners = this.listeners.filter(f => f !== fn); };
    },
    emit(type, data) {
        this.listeners.slice().forEach(f => { try { f(type, data); } catch (e) {} });
    },
    setState(s) {
        this.state = s;
        this.emit('state', s);
    },

    /* iOS: dźwięk ma grać mimo bocznego przełącznika wyciszenia.
       Web Audio jest domyślnie wyciszane przełącznikiem, a zwykły <audio> nie. Ustawiamy sesję audio
       na "playback" (iOS 16.4+) i dodatkowo odtwarzamy w tle cichy, zapętlony plik (starsze iOS). */
    startSilentKeeper() {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
        try {
            if (!this.silentEl) {
                this.silentEl = new Audio(SILENT_WAV);
                this.silentEl.loop = true;
                this.silentEl.setAttribute('playsinline', '');
            }
            const pr = this.silentEl.play();
            if (pr && pr.catch) pr.catch(() => {});
        } catch (e) {}
    },
    stopSilentKeeper() {
        try { if (this.silentEl) this.silentEl.pause(); } catch (e) {}
    },

    ensureAudioGraph() {
        // Obejście przez Web Audio jest potrzebne tylko na iOS (tam audio.volume nie działa),
        // a i tam tylko awaryjnie. Na desktopie i Androidzie gra zwykłe <audio> z audio.volume.
        if (!this.isIOS || this.usesBuffer || this.audioCtx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AC();
            const source = this.audioCtx.createMediaElementSource(this.audioEl);
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = 0;
            source.connect(this.gainNode);
            this.gainNode.connect(this.audioCtx.destination);
            this.audioEl.volume = 1;
        } catch (e) {
            this.audioCtx = null;
            this.gainNode = null;
        }
    },

    applyVolume(v) {
        if (this.usesBuffer) {
            this.audio.setGain(v);
        } else if (this.gainNode) {
            this.gainNode.gain.value = v;
        } else {
            this.audio.volume = v;
        }
    },

    // zmiana głośności przez użytkownika
    setVolume(v) {
        this.targetVolume = Math.min(Math.max(v, 0), 1);
        clearInterval(this.fadeInterval); // użytkownik przejmuje kontrolę nad głośnością
        this.applyVolume(this.targetVolume);
        this.emit('volume', this.targetVolume);
    },

    play() {
        const audio = this.audio;
        if (audio.loading || !audio.paused) return;
        this.ensureAudioGraph();
        if (!this.resumePending) audio.currentTime = TRACK_START;
        this.resumePending = false;
        this.applyVolume(0);
        if (this.isIOS) this.startSilentKeeper(); // musi być w obsłudze kliknięcia
        if (this.usesBuffer || audio.readyState < 3) this.setState('loading');

        audio.play().then(() => {
            this.setState('playing');

            // Płynne podgłaśnianie (fade-in) do ustawionej głośności
            clearInterval(this.fadeInterval);
            let currentVol = 0;
            this.fadeInterval = setInterval(() => {
                currentVol += this.targetVolume / 20;
                if (currentVol >= this.targetVolume) {
                    this.applyVolume(this.targetVolume);
                    clearInterval(this.fadeInterval);
                } else {
                    this.applyVolume(currentVol);
                }
            }, 50);
        }).catch((err) => {
            console.warn('Odtwarzanie nie wystartowało:', err);
            this.stopSilentKeeper();
            if (this.usesBuffer) {
                // silnik buforowy zawiódł (pobieranie/dekodowanie) -> wracamy do zwykłego <audio>,
                // które zadziała od następnego kliknięcia
                this.usesBuffer = false;
                this.audio = this.audioEl;
                this.resumePending = false;
                this.audio.currentTime = TRACK_START;
                this.audio.volume = 0;
            }
            this.setState('idle');
            this.emit('error');
        });
    },

    pause() {
        const audio = this.audio;
        if (audio.paused || audio.loading) return;
        clearInterval(this.fadeInterval);
        this.stopSilentKeeper();
        audio.pause();
        this.resumePending = true;
        this.setState('paused');
    },

    // przycisk PAUSE działa jak przełącznik (jak w Winampie)
    togglePause() {
        if (!this.audio.paused) this.pause();
        else if (this.resumePending) this.play();
    },

    stop() {
        const audio = this.audio;
        if (audio.loading) return;
        clearInterval(this.fadeInterval);
        this.stopSilentKeeper();
        audio.pause();
        this.resumePending = false;
        audio.currentTime = TRACK_START;
        this.applyVolume(this.targetVolume);
        this.setState('idle');
    },

    seek(seconds) {
        if (this.audio.duration && isFinite(this.audio.duration)) this.audio.currentTime = seconds;
    },

    isPaused() { return this.audio.paused; },
    getTime() { return this.audio.currentTime; },
    getDuration() { return this.audio.duration; },
    getMeta() { return (this.usesBuffer && this.audio.meta) ? this.audio.meta : null; },
    getAnalyser() { return this.usesBuffer ? this.audio.analyser : null; }
};

/* =====================================================================
   3. WYGLĄD PLAYERA (winampowy panel; podłącza się do silnika)
   ===================================================================== */

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

/* --- Ikony przycisków (SVG) --- */
const ICONS = {
    play:  '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1 L9 5 L2 9 Z"/></svg>',
    pause: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="1" width="2.2" height="8"/><rect x="5.8" y="1" width="2.2" height="8"/></svg>',
    stop:  '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7"/></svg>',
    load:  '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="4" width="2" height="2"/><rect x="4" y="4" width="2" height="2"/><rect x="7.5" y="4" width="2" height="2"/></svg>',
    prev:  '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M8 1 L2 5 L8 9 Z"/></svg>',
    next:  '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1 L8 5 L2 9 Z"/></svg>'
};

const SEG = 4; // segment suwaka: 3px + 1px przerwy
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

function setSegFill(fillEl, barEl, ratio) {
    const segCount = Math.max(1, Math.round((barEl.clientWidth + 1) / SEG));
    const filled = Math.round(clamp01(ratio) * segCount);
    fillEl.style.width = filled ? (filled * SEG - 1) + 'px' : '0px';
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

function mountPlayer() {
    const root = document.getElementById('lsPlayer');
    if (!root || !Engine.ready) return;

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
    function renderState() {
        const state = Engine.state;
        root.classList.remove('is-idle', 'is-loading', 'is-playing', 'is-paused');
        root.classList.add('is-' + state);
        playBtn.classList.toggle('on', state === 'playing' || state === 'loading');
        pauseBtn.classList.toggle('on', state === 'paused');
        stateIcon.innerHTML = state === 'playing' ? ICONS.play
                            : state === 'paused' ? ICONS.pause
                            : state === 'loading' ? ICONS.load
                            : ICONS.stop;
    }

    const originalTitle = titleEl.textContent;
    let errTimer = null;
    function flashError() {
        titleEl.textContent = 'PLAYBACK ERROR - CLICK PLAY TO TRY AGAIN';
        clearTimeout(errTimer);
        errTimer = setTimeout(() => { titleEl.textContent = originalTitle; }, 2600);
    }

    function updateMeta() {
        const meta = Engine.getMeta();
        if (meta) {
            kbpsEl.textContent = meta.kbps;
            khzEl.textContent = meta.khz;
            chEl.textContent = meta.channels === 1 ? 'MONO' : 'STEREO';
        }
        const dur = Engine.getDuration();
        if (dur && isFinite(dur)) totalEl.textContent = 'TOT ' + formatTime(dur);
    }

    /* ----- suwaki ----- */
    let seekDragging = false;
    function renderVolume() {
        setSegFill(volumeFill, volumeBar, Engine.targetVolume);
        volumeBar.setAttribute('aria-valuenow', Math.round(Engine.targetVolume * 100));
        volNum.textContent = String(Math.round(Engine.targetVolume * 100)).padStart(2, '0');
    }
    function progressRatio() {
        const dur = Engine.getDuration();
        return dur ? Engine.getTime() / dur : 0;
    }
    function renderProgress(ratio) {
        setSegFill(progressFill, progressContainer, ratio);
        progressContainer.setAttribute('aria-valuenow', Math.round(clamp01(ratio) * 100));
    }

    /* ----- sterowanie ----- */
    playBtn.addEventListener('click', () => Engine.play());
    pauseBtn.addEventListener('click', () => Engine.togglePause());
    stopBtn.addEventListener('click', () => {
        Engine.stop();
        renderProgress(0);
        renderTime(TRACK_START);
    });

    // Przewijanie: w trakcie przeciągania tylko podgląd, przeskok po puszczeniu palca.
    // Na telefonie przewijanie jest wyłączone.
    bindSegDrag(progressContainer, function(ratio, final, isStart) {
        if (isMobileLayout()) return;
        seekDragging = !final;
        renderProgress(ratio);
        const dur = Engine.getDuration();
        if ((final || isStart) && dur && isFinite(dur)) {
            Engine.seek(ratio * dur);
            renderTime(ratio * dur);
        }
    });

    // Głośność (zaokrąglona do pełnych segmentów: to co widać = to co słychać; skrajnie w lewo = mute)
    bindSegDrag(volumeBar, function(ratio) {
        const segCount = Math.max(1, Math.round((volumeBar.clientWidth + 1) / SEG));
        Engine.setVolume(Math.round(ratio * segCount) / segCount);
    });

    // Obsługa klawiatury (strzałki)
    volumeBar.addEventListener('keydown', function(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        Engine.setVolume(Engine.targetVolume + (e.key === 'ArrowRight' ? 0.05 : -0.05));
        e.preventDefault();
    });
    progressContainer.addEventListener('keydown', function(e) {
        const dur = Engine.getDuration();
        if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !dur || isMobileLayout()) return;
        Engine.seek(Math.min(Math.max(Engine.getTime() + (e.key === 'ArrowRight' ? 5 : -5), 0), dur));
        e.preventDefault();
    });

    /* ----- reakcja na zdarzenia silnika ----- */
    const off = Engine.on(function(type) {
        if (type === 'state') { renderState(); updateMeta(); }
        else if (type === 'volume') renderVolume();
        else if (type === 'error') flashError();
    });

    /* ----- własny zegar: czas, pasek postępu, parametry utworu ----- */
    const tickId = setInterval(function() {
        const dur = Engine.getDuration();
        if (!Engine.isPaused() && dur && isFinite(dur)) {
            if (!seekDragging) {
                renderProgress(progressRatio());
                renderTime(Engine.getTime());
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
    let cw = 0, ch = 0, drawnBlank = false, rafId = 0;

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
        rafId = requestAnimationFrame(spectrumFrame);
        if (document.hidden || !cw) return;
        const playing = !Engine.isPaused();
        const analyser = Engine.getAnalyser();

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
    rafId = requestAnimationFrame(spectrumFrame);

    const onResize = function() {
        renderVolume();
        renderProgress(seekDragging ? 0 : progressRatio());
        sizeCanvas();
    };
    window.addEventListener('resize', onResize);

    /* ----- stan początkowy: dopasowanie do tego, co aktualnie robi silnik ----- */
    renderState();
    renderVolume();
    updateMeta();
    renderTime(Engine.state === 'idle' ? TRACK_START : Engine.getTime());
    renderProgress(Engine.state === 'idle' ? 0 : progressRatio());

    pageCleanups.push(function() {
        off();
        clearInterval(tickId);
        cancelAnimationFrame(rafId);
        clearTimeout(errTimer);
        window.removeEventListener('resize', onResize);
    });
}

/* =====================================================================
   4. GALERIA (okno-playlista zadokowane pod playerem)
   Zdjęcia wystarczy wrzucić do folderu ls-gallery w repozytorium: dowolne nazwy, dowolna liczba.
   ===================================================================== */

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
let galleryListPromise = null; // lista zdjęć jest pobierana raz na wizytę

// 1) lista plików z GitHuba (dowolne nazwy)
function fetchGalleryFromGitHub() {
    const g = GALLERY_GITHUB;
    if (!g) return Promise.reject(new Error('brak konfiguracji'));
    const url = 'https://api.github.com/repos/' + g.owner + '/' + g.repo + '/contents/' + GALLERY_FOLDER + '?ref=' + g.branch;
    return fetch(url)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(arr => {
            if (!Array.isArray(arr)) throw new Error('nieoczekiwana odpowiedź');
            return arr
                .filter(f => f.type === 'file' && IMAGE_EXT_RE.test(f.name))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
                .map(f => ({ name: f.name, path: GALLERY_FOLDER + '/' + encodeURIComponent(f.name) }));
        });
}

// 2) zapasowo: zdjęcia o nazwach 1.jpg, 2.jpg, 3.jpg... (kolejne numery, dowolne z rozszerzeń z konfiguracji)
function probeGalleryNumbered() {
    function probe(n) {
        return new Promise(resolve => {
            let i = 0;
            (function next() {
                if (i >= GALLERY_EXTENSIONS.length) return resolve(null);
                const file = n + '.' + GALLERY_EXTENSIONS[i++];
                const img = new Image();
                img.onload = () => resolve({ name: file, path: GALLERY_FOLDER + '/' + file });
                img.onerror = next;
                img.src = GALLERY_FOLDER + '/' + file;
            })();
        });
    }
    const CHUNK = 12;
    const found = [];
    return (async function loop(start) {
        if (start > GALLERY_MAX) return found;
        const nums = [];
        for (let n = start; n < start + CHUNK && n <= GALLERY_MAX; n++) nums.push(n);
        const hits = (await Promise.all(nums.map(probe))).filter(Boolean);
        if (hits.length === 0) return found; // cały pakiet pusty = koniec zdjęć
        found.push(...hits);
        return loop(start + CHUNK);
    })(1);
}

function getGalleryList() {
    if (!galleryListPromise) {
        galleryListPromise = fetchGalleryFromGitHub()
            .catch(() => null)
            .then(list => (list && list.length) ? list : probeGalleryNumbered())
            .then(list => {
                if (!list.length) galleryListPromise = null; // pusta lista: następnym razem spróbuj jeszcze raz
                return list;
            });
    }
    return galleryListPromise;
}

function mountGallery() {
    const root = document.getElementById('lsGallery');
    if (!root) return;

    const screen = document.getElementById('lgScreen');
    const track = document.getElementById('lgTrack');
    const emptyEl = document.getElementById('lgEmpty');
    const prevBtn = document.getElementById('lgPrev');
    const nextBtn = document.getElementById('lgNext');
    const autoBtn = document.getElementById('lgAuto');
    const digitsEl = document.getElementById('lgDigits');
    const totalEl = document.getElementById('lgTotal');
    const fileEl = document.getElementById('lgFile');
    const playlist = document.getElementById('lgPlaylist');

    prevBtn.innerHTML = ICONS.prev;
    nextBtn.innerHTML = ICONS.next;

    const d1 = createDigitSVG(), d2 = createDigitSVG();
    digitsEl.appendChild(d1);
    digitsEl.appendChild(d2);

    let items = [];     // { name, path, w, h, el, thumb }
    let cur = 0;
    let autoTimer = null;
    let alive = true;
    let startX = null, suppressClick = false;

    function pad2(n) { return String(n % 100).padStart(2, '0'); }

    function renderInfo() {
        const n = items.length;
        const s = pad2(n ? cur + 1 : 0);
        setDigit(d1, +s[0]);
        setDigit(d2, +s[1]);
        totalEl.textContent = '/ ' + pad2(n);
        const it = items[cur];
        if (!it) { fileEl.textContent = '---'; return; }
        fileEl.textContent = it.name.toUpperCase() + (it.w ? '   ' + it.w + '×' + it.h + ' PX' : '');
    }

    function layout() {
        const N = items.length;
        items.forEach((it, i) => {
            let d = ((i - cur) % N + N) % N;
            if (d > N / 2) d -= N;
            const a = Math.abs(d);
            const dd = Math.max(-2, Math.min(2, d));
            it.el.style.setProperty('--d', dd);
            it.el.style.setProperty('--s', a === 0 ? 1 : a === 1 ? 0.72 : 0.5);
            it.el.style.opacity = a === 0 ? 1 : a === 1 ? 0.6 : 0;
            it.el.style.zIndex = String(10 - a);
            it.el.style.pointerEvents = a <= 1 ? 'auto' : 'none';
            it.el.classList.toggle('is-active', a === 0);
            it.el.classList.toggle('is-side', a === 1);
            it.thumb.classList.toggle('on', i === cur);
        });
        // miniatura aktywnego zdjęcia ma być widoczna na liście
        const t = items[cur] && items[cur].thumb;
        if (t) {
            playlist.scrollTo({ left: t.offsetLeft - playlist.clientWidth / 2 + t.clientWidth / 2, behavior: 'smooth' });
        }
        renderInfo();
    }

    function go(index) {
        if (!items.length) return;
        cur = ((index % items.length) + items.length) % items.length;
        layout();
    }

    function setAuto(on) {
        clearInterval(autoTimer);
        autoTimer = null;
        autoBtn.classList.toggle('on', on);
        root.classList.toggle('is-auto', on);
        if (on) autoTimer = setInterval(() => { if (!document.hidden) go(cur + 1); }, GALLERY_AUTO_MS);
    }

    function build(list) {
        track.innerHTML = '';
        playlist.innerHTML = '';
        items = list.map((f, i) => {
            const el = document.createElement('div');
            el.className = 'lg-item';
            const img = document.createElement('img');
            img.alt = f.name;
            img.decoding = 'async';
            img.src = f.path;
            el.appendChild(img);
            track.appendChild(el);

            const thumb = document.createElement('button');
            thumb.type = 'button';
            thumb.className = 'lg-thumb';
            thumb.setAttribute('aria-label', 'Photo ' + (i + 1));
            const timg = document.createElement('img');
            timg.alt = '';
            timg.src = f.path;
            const num = document.createElement('span');
            num.className = 'lg-num';
            num.textContent = i + 1;
            thumb.appendChild(timg);
            thumb.appendChild(num);
            playlist.appendChild(thumb);

            const it = { name: f.name, path: f.path, w: 0, h: 0, el, thumb };
            img.addEventListener('load', () => {
                it.w = img.naturalWidth; it.h = img.naturalHeight;
                if (items[cur] === it) renderInfo();
            });
            el.addEventListener('click', () => {
                if (suppressClick) return;
                const idx = items.indexOf(it);
                if (idx === cur) openLightbox(it.path);
                else go(idx);
            });
            thumb.addEventListener('click', () => go(items.indexOf(it)));
            return it;
        });
        cur = 0;
        emptyEl.style.display = items.length ? 'none' : 'flex';
        root.classList.toggle('is-single', items.length <= 1);
        layout();
    }

    /* ----- sterowanie ----- */
    prevBtn.addEventListener('click', () => go(cur - 1));
    nextBtn.addEventListener('click', () => go(cur + 1));
    autoBtn.addEventListener('click', () => setAuto(!autoTimer));

    screen.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowLeft') { go(cur - 1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { go(cur + 1); e.preventDefault(); }
        else if (e.key === 'Enter' && items[cur]) { openLightbox(items[cur].path); e.preventDefault(); }
    });

    // przesuwanie palcem / myszką
    screen.addEventListener('pointerdown', function(e) { startX = e.clientX; suppressClick = false; });
    screen.addEventListener('pointerup', function(e) {
        if (startX === null) return;
        const dx = e.clientX - startX;
        startX = null;
        if (Math.abs(dx) > 40) {
            suppressClick = true;
            go(cur + (dx < 0 ? 1 : -1));
            setTimeout(() => { suppressClick = false; }, 50);
        }
    });
    screen.addEventListener('pointercancel', function() { startX = null; });

    /* ----- wczytanie listy zdjęć ----- */
    emptyEl.textContent = 'LOADING PHOTOS...';
    emptyEl.style.display = 'flex';
    getGalleryList().then(list => {
        if (!alive) return; // strona została już podmieniona
        if (!list.length) {
            emptyEl.textContent = 'NO PHOTOS FOUND  //  UPLOAD FILES TO /' + GALLERY_FOLDER;
            renderInfo();
            return;
        }
        build(list);
    });
    renderInfo();

    pageCleanups.push(function() {
        alive = false;
        clearInterval(autoTimer);
    });
}

/* --- Powiększenie zdjęcia (lightbox) --- */
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

/* =====================================================================
   5. GÓRNY PASEK (LOST-SECTION | godzina | księżyc | licznik | motto)
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

// Które motto pokazać dzisiaj (jedno na dobę; przy jednym mottcie zawsze to samo)
function todaysMotto() {
    const day = Math.floor(Date.now() / 86400000);
    return TOPBAR_MOTTOS[day % TOPBAR_MOTTOS.length] || [];
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

    /* motto (jeżdżący tekst w zamkniętym boxie) */
    const mottoInner = document.getElementById('tbMottoInner');
    function buildMotto() {
        const row = document.getElementById('tbRow');
        const motto = document.getElementById('tbMotto');
        const text = todaysMotto().join(TOPBAR_MOTTO_SEPARATOR) + TOPBAR_MOTTO_SEPARATOR;
        mottoInner.textContent = text;
        // Tekst ma być widoczny od razu po wejściu na stronę (ujemne opóźnienie animacji
        // "przewija" ją do momentu, w którym początek tekstu jest przy lewej krawędzi).
        const cw = motto.clientWidth || 300;
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

    /* ukrycie boxa licznika, gdy licznik nie załaduje się (np. adblock) */
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
   6. POZOSTAŁE MODUŁY STRON
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
    mountPlayer();
    mountGallery();
    loadAndRandomizeBlinkies();
}

/* =====================================================================
   7. NAWIGACJA BEZ PRZEŁADOWANIA (muzyka gra dalej)
   Kliknięcia w linki do własnych podstron pobierają nową stronę w tle i podmieniają
   tylko blok #pageContent. Silnik dźwięku, górny pasek i nawigacja zostają nietknięte.
   Gdy cokolwiek pójdzie nie tak, następuje zwykłe przejście na nową stronę.
   ===================================================================== */
let navigating = false;

function swapPage(doc, url, push) {
    const next = doc.getElementById('pageContent');
    const cur = document.getElementById('pageContent');
    if (!next || !cur) return false;

    unmountPage(); // zatrzymaj zegary playera i galerii z poprzedniej strony
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
    Engine.init();
    initNavPlaceholders();
    initTopbar();
    initOrganicButtonParallax();
    initPage();
    initRouter();
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeLightbox();
    });
});
