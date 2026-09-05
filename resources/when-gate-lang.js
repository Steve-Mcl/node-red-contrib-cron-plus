/* Free-text temporal condition language for the cronplus-when-gate node.
   Pure logic/semantics - no AI. Runs in BOTH the Node-RED runtime (require)
   and the editor (loaded via $.getScript, attaches window.cronplusWhenGateLang)
   so the same parser backs runtime evaluation, editor validation and the
   live "parsed understanding" preview. Must therefore stay dependency-free -
   evaluation against actual sun/moon positions lives in lib/when-gate-eval.js.

   API:
     parse(text) => { ok, ast, description, unmatched, warnings, suggestion }
     describe(ast) => string
     requiresLocation(ast) => bool
   AST: { type: 'or', groups: [{ type: 'and', terms: [Term] }] }
   Term: { kind, negate, source, ...params } - see TERM_KINDS below. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory()
    } else {
        root.cronplusWhenGateLang = factory()
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict'

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

    // Term kinds that cannot be computed without a latitude/longitude
    const LOCATION_KINDS = ['solarState', 'sunDirection', 'sunAltitude', 'sunAzimuth', 'solarEvent', 'solarBetween', 'moonAltitude', 'moonAzimuth']

    // ------------------------------------------------------------------
    // Vocabulary (data driven - new phrases are one-line additions)
    // ------------------------------------------------------------------

    const DAY_WORDS = {
        sunday: 0,
        monday: 1,
        mon: 1,
        tuesday: 2,
        tue: 2,
        tues: 2,
        wednesday: 3,
        wed: 3,
        thursday: 4,
        thu: 4,
        thur: 4,
        thurs: 4,
        friday: 5,
        fri: 5,
        saturday: 6,
        sat: 6,
        sabbath: 6 // from Shabbat. Deliberately undocumented (the term is fluid across
        // traditions); anyone typing it sees the Saturday reading in the understanding line
    }

    const DAY_SETS = {
        weekend: [0, 6],
        weekday: [1, 2, 3, 4, 5],
        workday: [1, 2, 3, 4, 5]
    }

    const MONTH_WORDS = {
        january: 1,
        jan: 1,
        february: 2,
        feb: 2,
        march: 3,
        mar: 3,
        april: 4,
        apr: 4,
        may: 5,
        june: 6,
        jun: 6,
        july: 7,
        jul: 7,
        august: 8,
        aug: 8,
        september: 9,
        sep: 9,
        sept: 9,
        october: 10,
        oct: 10,
        november: 11,
        nov: 11,
        december: 12,
        dec: 12
    }

    const NAMED_DATES = {
        christmas: { month: 12, day: 25, name: 'christmas' },
        xmas: { month: 12, day: 25, name: 'christmas' },
        halloween: { month: 10, day: 31, name: 'halloween' }
    }

    // getSunTimes event keys (lib/when-gate-eval.js maps them onto suncalc v2)
    const SOLAR_EVENT_WORDS = {
        sunrise: 'sunrise',
        sunset: 'sunset',
        sundown: 'sunset'
    }

    // Multi-word phrases and single words that emit a whole term (or symbol).
    // Matched longest-first against the noise-stripped word stream, so
    // "golden hour" wins over "hour", "sun rising" wins over "sun".
    // sym types produced: TERM (a ready term), SOLAR_AMBIG (state or event by
    // context, e.g. dawn/dusk), EVENT (solar event name), and keyword symbols.
    const PHRASES = [
        // combinators / operators
        { words: ['but', 'not'], sym: { type: 'EXCEPT' } },
        { words: ['except'], sym: { type: 'EXCEPT' } },
        { words: ['unless'], sym: { type: 'EXCEPT' } },
        { words: ['not'], sym: { type: 'NOT' } },
        { words: ['and'], sym: { type: 'AND' } },
        { words: ['or'], sym: { type: 'OR' } },
        { words: ['between'], sym: { type: 'BETWEEN' } },
        { words: ['from'], sym: { type: 'BETWEEN' } },
        { words: ['to'], sym: { type: 'TO' } },
        { words: ['through'], sym: { type: 'TO' } },
        { words: ['thru'], sym: { type: 'TO' } },
        { words: ['until'], sym: { type: 'TO' } },
        { words: ['till'], sym: { type: 'TO' } },
        { words: ['til'], sym: { type: 'TO' } },
        { words: ['before'], sym: { type: 'BEFORE' } },
        { words: ['earlier', 'than'], sym: { type: 'BEFORE' } },
        { words: ['after'], sym: { type: 'AFTER' } },
        { words: ['later', 'than'], sym: { type: 'AFTER' } },
        { words: ['within'], sym: { type: 'WITHIN' } },
        { words: ['of'], sym: { type: 'OF' } },
        { words: ['more', 'than'], sym: { type: 'MORE' } },
        { words: ['greater', 'than'], sym: { type: 'MORE' } },
        { words: ['over'], sym: { type: 'MORE' } },
        { words: ['at', 'least'], sym: { type: 'MORE' } },
        { words: ['less', 'than'], sym: { type: 'LESS' } },
        { words: ['at', 'most'], sym: { type: 'LESS' } },
        { words: ['under'], sym: { type: 'LESS' } },
        { words: ['minutes'], sym: { type: 'UNIT', unit: 'minute', factor: 1 } },
        { words: ['minute'], sym: { type: 'UNIT', unit: 'minute', factor: 1 } },
        { words: ['mins'], sym: { type: 'UNIT', unit: 'minute', factor: 1 } },
        { words: ['min'], sym: { type: 'UNIT', unit: 'minute', factor: 1 } },
        { words: ['hours'], sym: { type: 'UNIT', unit: 'hour', factor: 60 } },
        { words: ['hour'], sym: { type: 'UNIT', unit: 'hour', factor: 60 } },
        { words: ['hrs'], sym: { type: 'UNIT', unit: 'hour', factor: 60 } },
        { words: ['hr'], sym: { type: 'UNIT', unit: 'hour', factor: 60 } },
        { words: ['illuminated'], sym: { type: 'ILLUM' } },
        { words: ['illumination'], sym: { type: 'ILLUM' } },
        { words: ['lit'], sym: { type: 'ILLUM' } },
        { words: ['month'], sym: { type: 'MONTH_GENERIC' } }, // "1st of the month"
        { words: ['week'], sym: { type: 'WEEK_GENERIC' } }, // "last day of the week"
        { words: ['year'], sym: { type: 'YEAR_GENERIC' } }, // "first monday of the year", "even years"
        { words: ['even'], sym: { type: 'PARITY', parity: 'even' } },
        { words: ['odd'], sym: { type: 'PARITY', parity: 'odd' } },

        // celestial altitude: "sun is between 10 and 12 degrees", "moon is high"
        { words: ['degrees'], sym: { type: 'DEG' } },
        { words: ['degree'], sym: { type: 'DEG' } },
        { words: ['deg'], sym: { type: 'DEG' } },
        { words: ['above'], sym: { type: 'ABOVE' } },
        { words: ['below'], sym: { type: 'BELOW' } },
        // celestial azimuth: "sun azimuth is between 134 and 138 degrees"
        { words: ['azimuth'], sym: { type: 'AZIMUTH' } },
        { words: ['sun', 'high'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'above', degrees: 45, label: 'high' } } },
        { words: ['sun', 'low'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'between', low: 0, high: 15, label: 'low' } } },
        { words: ['moon', 'high'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'above', degrees: 45, label: 'high' } } },
        { words: ['moon', 'low'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'between', low: 0, high: 15, label: 'low' } } },

        // minute-of-hour: "quarter past [five]", "half past", "10 past", "5 to"
        { words: ['quarter', 'past'], sym: { type: 'TERM', term: { kind: 'minuteOfHour', style: 'at', startMin: 15, rel: 'past' } } },
        { words: ['half', 'past'], sym: { type: 'TERM', term: { kind: 'minuteOfHour', style: 'at', startMin: 30, rel: 'past' } } },
        { words: ['quarter', 'to'], sym: { type: 'TERM', term: { kind: 'minuteOfHour', style: 'at', startMin: 45, rel: 'to' } } },
        { words: ['past'], sym: { type: 'PAST' } },
        // small-number words so "ten past" and "twenty five past" work; the
        // wordNum flag lets "five to nine" read as 08:55 while digit "9 to 5"
        // (which people mean as working hours) is rejected instead of misread
        { words: ['twenty', 'five'], sym: { type: 'NUM', value: 25, ordinal: false, wordNum: true } },
        { words: ['twenty'], sym: { type: 'NUM', value: 20, ordinal: false, wordNum: true } },
        { words: ['thirty'], sym: { type: 'NUM', value: 30, ordinal: false, wordNum: true } },
        { words: ['fifteen'], sym: { type: 'NUM', value: 15, ordinal: false, wordNum: true } },
        { words: ['twelve'], sym: { type: 'NUM', value: 12, ordinal: false, wordNum: true } },
        { words: ['eleven'], sym: { type: 'NUM', value: 11, ordinal: false, wordNum: true } },
        { words: ['ten'], sym: { type: 'NUM', value: 10, ordinal: false, wordNum: true } },
        { words: ['nine'], sym: { type: 'NUM', value: 9, ordinal: false, wordNum: true } },
        { words: ['eight'], sym: { type: 'NUM', value: 8, ordinal: false, wordNum: true } },
        { words: ['seven'], sym: { type: 'NUM', value: 7, ordinal: false, wordNum: true } },
        { words: ['six'], sym: { type: 'NUM', value: 6, ordinal: false, wordNum: true } },
        { words: ['five'], sym: { type: 'NUM', value: 5, ordinal: false, wordNum: true } },
        { words: ['four'], sym: { type: 'NUM', value: 4, ordinal: false, wordNum: true } },
        { words: ['three'], sym: { type: 'NUM', value: 3, ordinal: false, wordNum: true } },
        { words: ['two'], sym: { type: 'NUM', value: 2, ordinal: false, wordNum: true } },
        { words: ['one'], sym: { type: 'NUM', value: 1, ordinal: false, wordNum: true } },

        // ordinals ("first monday of the month", "last day of the month").
        // NOTE: the multi-word moon phrases ("first quarter moon") still win
        // because phrase matching is longest-first.
        { words: ['first'], sym: { type: 'ORD', nth: 1 } },
        { words: ['second'], sym: { type: 'ORD', nth: 2 } },
        { words: ['third'], sym: { type: 'ORD', nth: 3 } },
        { words: ['fourth'], sym: { type: 'ORD', nth: 4 } },
        { words: ['fifth'], sym: { type: 'ORD', nth: 5 } },
        { words: ['last'], sym: { type: 'ORD', nth: 'last' } },
        { words: ['final'], sym: { type: 'ORD', nth: 'last' } },

        // always
        { words: ['every', 'day'], sym: { type: 'TERM', term: { kind: 'always' } } },
        { words: ['always'], sym: { type: 'TERM', term: { kind: 'always' } } },
        { words: ['anytime'], sym: { type: 'TERM', term: { kind: 'always' } } },
        { words: ['any', 'time'], sym: { type: 'TERM', term: { kind: 'always' } } },

        // solar - daylight / darkness (sun altitude, polar safe)
        { words: ['sun', 'above', 'horizon'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'above', degrees: -0.833 } } },
        { words: ['sun', 'up'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'above', degrees: -0.833 } } },
        { words: ['sun', 'below', 'horizon'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'below', degrees: -0.833 } } },
        { words: ['sun', 'down'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'below', degrees: -0.833 } } },
        { words: ['daytime'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'above', degrees: -0.833 } } },
        { words: ['daylight'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'above', degrees: -0.833 } } },
        { words: ['day'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'above', degrees: -0.833 } } },
        { words: ['dark'], sym: { type: 'TERM', term: { kind: 'sunAltitude', op: 'below', degrees: -6 } } },
        { words: ['nighttime'], sym: { type: 'TERM', term: { kind: 'solarState', states: ['night'] } } },
        { words: ['night'], sym: { type: 'TERM', term: { kind: 'solarState', states: ['night'] } } },

        // solar - direction
        { words: ['sun', 'rising'], sym: { type: 'TERM', term: { kind: 'sunDirection', direction: 'rise' } } },
        { words: ['sun', 'climbing'], sym: { type: 'TERM', term: { kind: 'sunDirection', direction: 'rise' } } },
        { words: ['morning', 'sun'], sym: { type: 'TERM', term: { kind: 'sunDirection', direction: 'rise' } } },
        { words: ['sun', 'setting'], sym: { type: 'TERM', term: { kind: 'sunDirection', direction: 'fall' } } },
        { words: ['sun', 'falling'], sym: { type: 'TERM', term: { kind: 'sunDirection', direction: 'fall' } } },
        { words: ['afternoon', 'sun'], sym: { type: 'TERM', term: { kind: 'sunDirection', direction: 'fall' } } },

        // solar - twilight states; dawn/dusk are state OR event depending on context
        { words: ['civil', 'twilight'], sym: { type: 'TERM', term: { kind: 'solarState', states: ['civilTwilight'] } } },
        { words: ['nautical', 'twilight'], sym: { type: 'TERM', term: { kind: 'solarState', states: ['nauticalTwilight'] } } },
        { words: ['astronomical', 'twilight'], sym: { type: 'TERM', term: { kind: 'solarState', states: ['astronomicalTwilight'] } } },
        { words: ['astro', 'twilight'], sym: { type: 'TERM', term: { kind: 'solarState', states: ['astronomicalTwilight'] } } },
        { words: ['twilight'], sym: { type: 'TERM', term: { kind: 'solarState', states: ['twilight'] } } },
        { words: ['golden', 'hour'], sym: { type: 'TERM', term: { kind: 'solarState', states: ['goldenHour'] } } },
        { words: ['dawn'], sym: { type: 'SOLAR_AMBIG', state: { kind: 'solarState', states: ['twilight'], direction: 'rise' }, event: 'civilDawn' } },
        { words: ['sunup'], sym: { type: 'SOLAR_AMBIG', state: { kind: 'solarState', states: ['twilight'], direction: 'rise' }, event: 'sunrise' } },
        { words: ['dusk'], sym: { type: 'SOLAR_AMBIG', state: { kind: 'solarState', states: ['twilight'], direction: 'fall' }, event: 'civilDusk' } },
        { words: ['solar', 'noon'], sym: { type: 'EVENT', event: 'solarNoon' } },
        { words: ['noon'], sym: { type: 'TIMEWORD', minutes: 720 } },
        { words: ['midday'], sym: { type: 'TIMEWORD', minutes: 720 } },
        { words: ['midnight'], sym: { type: 'TIMEWORD', minutes: 0 } },

        // clock-based day parts
        { words: ['morning'], sym: { type: 'TERM', term: { kind: 'timeRange', style: 'before', startMin: 0, endMin: 720 } } },
        { words: ['afternoon'], sym: { type: 'TERM', term: { kind: 'timeRange', style: 'between', startMin: 720, endMin: 1080 } } },
        { words: ['evening'], sym: { type: 'TERM', term: { kind: 'solarEvent', event: 'sunset', op: 'after' } } },

        // moon
        { words: ['moon', 'visible'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'above', degrees: 0 } } },
        { words: ['moon', 'up'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'above', degrees: 0 } } },
        { words: ['moon', 'out'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'above', degrees: 0 } } },
        { words: ['moon', 'above', 'horizon'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'above', degrees: 0 } } },
        { words: ['moon', 'down'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'below', degrees: 0 } } },
        { words: ['moon', 'below', 'horizon'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'below', degrees: 0 } } },
        { words: ['no', 'moon'], sym: { type: 'TERM', term: { kind: 'moonAltitude', op: 'below', degrees: 0 } } },
        { words: ['full', 'moon'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'full' } } },
        { words: ['moon', 'full'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'full' } } },
        { words: ['blue', 'moon'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'blue' } } },
        { words: ['seasonal', 'blue', 'moon'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'seasonalBlue' } } },
        { words: ['new', 'moon'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'new' } } },
        { words: ['first', 'quarter', 'moon'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'firstQuarter' } } },
        { words: ['last', 'quarter', 'moon'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'lastQuarter' } } },
        { words: ['waxing', 'moon'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'waxing' } } },
        { words: ['moon', 'waxing'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'waxing' } } },
        { words: ['waxing'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'waxing' } } },
        { words: ['waning', 'moon'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'waning' } } },
        { words: ['moon', 'waning'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'waning' } } },
        { words: ['waning'], sym: { type: 'TERM', term: { kind: 'moonPhase', phase: 'waning' } } },
        { words: ['moon'], sym: { type: 'MOON_WORD' } },
        { words: ['sun'], sym: { type: 'SUN_WORD' } } // Sunday only in day-list/range context (see promoteSunWords)
    ]

    // Words carrying no meaning of their own. Stripped before phrase matching.
    // 'is' is included, so "moon is visible" matches the ['moon','visible'] phrase.
    // 'at' is included: "at 9am" parses as a bare time, "at night" as the night state.
    const NOISE_WORDS = ['only', 'just', 'when', 'whenever', 'if', 'the', 'on', 'in', 'is', 'it', 'its', 'was', 'are', 'be', 'during', 'a', 'an', 'at', 'whilst', 'while', 'time', 'times', 'every', 'each', 'them', 'those', 'their', 'altitude']

    // Single-word vocabulary for distance-1 fuzzy fallback (typo tolerance)
    const FUZZY_VOCAB = (function () {
        const words = {}
        Object.keys(DAY_WORDS).forEach(function (w) { if (w.length >= 4) words[w] = true })
        Object.keys(DAY_SETS).forEach(function (w) { words[w] = true })
        Object.keys(MONTH_WORDS).forEach(function (w) { if (w.length >= 4) words[w] = true })
        Object.keys(NAMED_DATES).forEach(function (w) { words[w] = true })
        Object.keys(SOLAR_EVENT_WORDS).forEach(function (w) { words[w] = true })
        PHRASES.forEach(function (p) { p.words.forEach(function (w) { if (w.length >= 4) { words[w] = true } }) })
        return Object.keys(words)
    })()

    // ------------------------------------------------------------------
    // Tokenizer
    // ------------------------------------------------------------------

    // token: { type: 'word'|'num'|'time'|'percent'|'comma'|'dash', ... , raw }
    function tokenize (text) {
        const tokens = []
        const src = String(text || '').toLowerCase().replace(/[’‘`']/g, '')
        // longest alternatives first: time with am/pm or colon, percent, ordinal/number, word
        const re = /(\d{1,2}):(\d{2})\s*(am|pm)?|(\d{1,2})(?:\.(\d{2}))?\s*(am|pm)|(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)(st|nd|rd|th)?|([a-z]+)|(,)|(-)|(\()|(\))/g
        let m
        while ((m = re.exec(src)) !== null) {
            const raw = m[0].trim()
            if (m[1] !== undefined) { // hh:mm [am|pm]
                tokens.push({ type: 'time', minutes: toMinutes(parseInt(m[1]), parseInt(m[2]), m[3]), raw })
            } else if (m[4] !== undefined) { // h[.mm] am|pm
                tokens.push({ type: 'time', minutes: toMinutes(parseInt(m[4]), m[5] ? parseInt(m[5]) : 0, m[6]), raw })
            } else if (m[7] !== undefined) { // nn%
                tokens.push({ type: 'percent', value: parseFloat(m[7]), raw })
            } else if (m[8] !== undefined) { // number (decimals allowed), maybe ordinal
                tokens.push({ type: 'num', value: parseFloat(m[8]), ordinal: !!m[9], raw })
            } else if (m[10] !== undefined) {
                tokens.push({ type: 'word', word: m[10], raw })
            } else if (m[11] !== undefined) {
                tokens.push({ type: 'comma', raw })
            } else if (m[12] !== undefined) {
                tokens.push({ type: 'dash', raw })
            } else if (m[13] !== undefined) {
                tokens.push({ type: 'lparen', raw })
            } else if (m[14] !== undefined) {
                tokens.push({ type: 'rparen', raw })
            }
        }
        return tokens
    }

    function toMinutes (h, min, ampm) {
        if (isNaN(h) || isNaN(min) || h > 23 || min > 59) { return null }
        if (ampm === 'am') {
            if (h === 12) { h = 0 }
        } else if (ampm === 'pm') {
            if (h !== 12) { h += 12 }
        }
        if (h > 23) { return null }
        return (h * 60) + min
    }

    // Damerau-Levenshtein distance capped at 1 (returns 0, 1 or 2 meaning ">1")
    function editDistanceLE1 (a, b) {
        if (a === b) { return 0 }
        const la = a.length
        const lb = b.length
        if (Math.abs(la - lb) > 1) { return 2 }
        // try: single substitution / insertion / deletion / adjacent transposition
        let i = 0
        while (i < Math.min(la, lb) && a[i] === b[i]) { i++ }
        if (la === lb) {
            if (a.slice(i + 1) === b.slice(i + 1)) { return 1 } // substitution
            if (i < la - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)) { return 1 } // transposition
            return 2
        }
        const shorter = la < lb ? a : b
        const longer = la < lb ? b : a
        if (shorter.slice(i) === longer.slice(i + 1)) { return 1 } // insertion/deletion
        return 2
    }

    function fuzzyLookup (word) {
        if (word.length < 4 || !/^[a-z]+$/.test(word)) { return null }
        for (let i = 0; i < FUZZY_VOCAB.length; i++) {
            if (editDistanceLE1(word, FUZZY_VOCAB[i]) <= 1) {
                return FUZZY_VOCAB[i]
            }
        }
        return null
    }

    // ------------------------------------------------------------------
    // Symbol pass: tokens -> symbols (phrase matching, longest first)
    // ------------------------------------------------------------------

    function stripPlural (word) {
        if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
            return word.slice(0, -1)
        }
        return word
    }

    function wordSymbol (word) {
        // single-word direct lookups (after phrase table missed)
        let w = word
        let day = DAY_WORDS[w]
        if (day === undefined) { day = DAY_WORDS[stripPlural(w)] }
        if (day !== undefined) {
            const sab = (w === 'sabbath' || stripPlural(w) === 'sabbath')
            return { type: 'DAY', day, sabbath: sab }
        }
        w = stripPlural(word)
        if (DAY_SETS[w]) { return { type: 'DAYSET', days: DAY_SETS[w].slice(), name: w } }
        if (word === 'business' || word === 'work') { return null } // handled via two-word check below
        if (MONTH_WORDS[word] !== undefined) { return { type: 'MONTH', month: MONTH_WORDS[word] } }
        if (NAMED_DATES[word]) { return { type: 'TERM', term: { kind: 'namedDate', month: NAMED_DATES[word].month, day: NAMED_DATES[word].day, name: NAMED_DATES[word].name } } }
        if (SOLAR_EVENT_WORDS[word]) { return { type: 'EVENT', event: SOLAR_EVENT_WORDS[word] } }
        return null
    }

    function matchSymbols (tokens, warnings) {
        const symbols = []
        const unmatched = []
        let i = 0
        // phrases sorted longest first so multi-word entries win
        const phrases = PHRASES.slice().sort(function (a, b) { return b.words.length - a.words.length })
        while (i < tokens.length) {
            const tok = tokens[i]
            if (tok.type === 'comma') { symbols.push({ type: 'COMMA', raw: tok.raw }); i++; continue }
            if (tok.type === 'dash') { symbols.push({ type: 'DASH', raw: tok.raw }); i++; continue }
            if (tok.type === 'lparen') { symbols.push({ type: 'LPAREN', raw: tok.raw }); i++; continue }
            if (tok.type === 'rparen') { symbols.push({ type: 'RPAREN', raw: tok.raw }); i++; continue }
            if (tok.type === 'time') {
                if (tok.minutes === null) { unmatched.push(tok.raw); i++; continue }
                symbols.push({ type: 'TIME', minutes: tok.minutes, raw: tok.raw })
                i++
                continue
            }
            if (tok.type === 'percent') { symbols.push({ type: 'PERCENT', value: tok.value, raw: tok.raw }); i++; continue }
            if (tok.type === 'num') { symbols.push({ type: 'NUM', value: tok.value, ordinal: tok.ordinal, raw: tok.raw }); i++; continue }
            // word: special two-word day sets first
            if ((tok.word === 'business' || tok.word === 'work') && tokens[i + 1] && tokens[i + 1].type === 'word' && stripPlural(tokens[i + 1].word) === 'day') {
                symbols.push({ type: 'DAYSET', days: [1, 2, 3, 4, 5], name: 'weekday', raw: tok.word + ' day' })
                i += 2
                continue
            }
            if (tok.word === 'new' && tokens[i + 1] && tokens[i + 1].type === 'word' && stripPlural(tokens[i + 1].word) === 'year') {
                // "new year", "new years day"
                let consumed = 2
                if (tokens[i + 2] && tokens[i + 2].type === 'word' && stripPlural(tokens[i + 2].word) === 'day') { consumed = 3 }
                symbols.push({ type: 'TERM', term: { kind: 'namedDate', month: 1, day: 1, name: 'new years day' }, raw: 'new years day' })
                i += consumed
                continue
            }
            // context-sensitive words - checked before the phrase table because
            // 'day'/'week'/'month' mean something else standalone
            const prevSym = symbols[symbols.length - 1]
            const bare = stripPlural(tok.word)
            // quantity units for date offsets: "4 days after christmas", "1 month
            // before xmas" - but not after ordinals ("1st day of the month")
            if (prevSym && prevSym.type === 'NUM' && !prevSym.ordinal && (bare === 'day' || bare === 'week' || bare === 'month')) {
                symbols.push({ type: 'UNIT', unit: bare, factor: bare === 'week' ? 7 : 1, raw: tok.raw })
                i++
                continue
            }
            // "last day of the week/month", "1st day of the month", "odd days":
            // 'day' straight after an ordinal or parity word is generic
            if (prevSym && (prevSym.type === 'ORD' || prevSym.type === 'PARITY' || (prevSym.type === 'NUM' && prevSym.ordinal)) && bare === 'day') {
                symbols.push({ type: 'DAY_GENERIC', raw: tok.raw })
                i++
                continue
            }
            if (bare === 'day') {
                let j = i + 1
                while (tokens[j] && tokens[j].type === 'word' && NOISE_WORDS.indexOf(tokens[j].word) >= 0) { j++ }
                const following = tokens[j]
                // "day before <date>" / "day after <date>" = "1 day before/after <date>"
                if (following && following.type === 'word' && (following.word === 'before' || following.word === 'after')) {
                    symbols.push({ type: 'NUM', value: 1, ordinal: false, synth: true, raw: tok.raw })
                    symbols.push({ type: 'UNIT', unit: 'day', factor: 1, raw: tok.raw })
                    i++
                    continue
                }
                // "day is odd" / "day is even": generic day-of-month, not daylight
                if (following && following.type === 'word' && (following.word === 'even' || following.word === 'odd')) {
                    symbols.push({ type: 'DAY_GENERIC', raw: tok.raw })
                    i++
                    continue
                }
            }
            // "<date> eve": christmas eve, new years eve, halloween eve
            if (bare === 'eve' && prevSym && prevSym.type === 'TERM' && prevSym.term.kind === 'namedDate') {
                prevSym.term.offsetDays = (prevSym.term.offsetDays || 0) - 1
                prevSym.term.name = (prevSym.term.name ? prevSym.term.name.replace(/ day$/, '') : '') + ' eve'
                prevSym.raw += ' eve'
                i++
                continue
            }
            // phrase table (longest first) runs BEFORE the noise filter so noise-listed
            // words can still start a phrase ("every day" -> always; "at least" -> MORE)
            const hit = matchPhraseAt(phrases, tokens, i)
            if (hit) {
                const sym = clone(hit.phrase.sym)
                sym.raw = hit.raw
                symbols.push(sym)
                i = hit.next
                continue
            }
            // noise
            if (NOISE_WORDS.indexOf(tok.word) >= 0) { i++; continue }
            // single-word vocab
            const single = wordSymbol(tok.word)
            if (single) {
                single.raw = tok.raw
                symbols.push(single)
                // "christmas day" / "halloween day": consume the trailing generic 'day'
                if (single.type === 'TERM' && single.term.kind === 'namedDate' &&
                    tokens[i + 1] && tokens[i + 1].type === 'word' && stripPlural(tokens[i + 1].word) === 'day') {
                    i++
                }
                i++
                continue
            }
            // fuzzy fallback (typos): retry the pipeline ONCE with the corrected word.
            // Guards against an infinite loop: a word that only exists inside a
            // multi-word phrase (e.g. 'first' from "first quarter moon") fuzzy-matches
            // itself yet still resolves to nothing, so an identity "correction" - or a
            // second correction of the same token - must fall through to unmatched.
            // try the raw word first: stripping a plural 's' from a word whose
            // correct form ends in s ("cristmas") pushes it out of fuzzy range
            const fixed = tok.fuzzed ? null : (fuzzyLookup(tok.word) || fuzzyLookup(stripPlural(tok.word)))
            if (fixed && fixed !== tok.word && fixed !== stripPlural(tok.word)) {
                warnings.push('assumed \'' + fixed + '\' for \'' + tok.word + '\'')
                tokens[i] = { type: 'word', word: fixed, raw: tok.raw, fuzzed: true }
                continue
            }
            unmatched.push(tok.raw)
            i++
        }
        return { symbols, unmatched }
    }

    function matchPhraseAt (phrases, tokens, start) {
        for (let p = 0; p < phrases.length; p++) {
            const phrase = phrases[p]
            let ti = start
            let ok = true
            const rawParts = []
            for (let w = 0; w < phrase.words.length; w++) {
                // skip noise words between phrase words ("sun is up" -> "sun up")
                if (w > 0) {
                    while (tokens[ti] && tokens[ti].type === 'word' && NOISE_WORDS.indexOf(tokens[ti].word) >= 0) { ti++ }
                }
                const tok = tokens[ti]
                if (!tok || tok.type !== 'word' || (tok.word !== phrase.words[w] && stripPlural(tok.word) !== phrase.words[w])) {
                    ok = false
                    break
                }
                rawParts.push(tok.raw)
                ti++
            }
            if (ok) {
                return { phrase, next: ti, raw: rawParts.join(' ') }
            }
        }
        return null
    }

    // bare "sun" is Sunday only when it sits in a day list or range; it stays
    // SUN_WORD before an altitude or azimuth comparison ("sun is between 10 and
    // 12 degrees", "sun azimuth is between 134 and 138")
    function promoteSunWords (symbols, unmatched) {
        for (let i = 0; i < symbols.length; i++) {
            if (symbols[i].type !== 'SUN_WORD') { continue }
            const prev = symbols[i - 1]
            const next = symbols[i + 1]
            const dayish = function (s) {
                return s && (s.type === 'DAY' || s.type === 'DAYSET' || s.type === 'DASH' || s.type === 'TO')
            }
            const listish = function (s, s2) {
                return s && (s.type === 'AND' || s.type === 'OR' || s.type === 'COMMA') && dayish(s2)
            }
            const altitudeish = function (s) {
                return s && ['BETWEEN', 'ABOVE', 'BELOW', 'MORE', 'LESS', 'AZIMUTH'].indexOf(s.type) >= 0
            }
            if (altitudeish(next)) { continue } // handled by parseCelestialAltitude/parseCelestialAzimuth
            if (dayish(prev) || dayish(next) || listish(prev, symbols[i - 2]) || listish(next, symbols[i + 2])) {
                symbols[i] = { type: 'DAY', day: 0, raw: symbols[i].raw }
            } else {
                unmatched.push(symbols[i].raw)
                symbols.splice(i, 1)
                i--
            }
        }
    }

    // ------------------------------------------------------------------
    // Grammar: symbols -> AST (recursive descent)
    // ------------------------------------------------------------------

    // The AST stays a flat OR-of-AND-groups; parentheses are honoured by
    // DISTRIBUTING at parse time: "(A or B) and C" -> or[[A,C],[B,C]].
    // Precedence without brackets: AND binds tighter than OR, so
    // "A or B and C" means A or (B and C) - the description makes this visible.
    function parseSymbols (symbols, unmatched, warnings) {
        const state = { symbols, pos: 0, unmatched, warnings }
        let groups = parseOrExpr(state, 0)
        // leftovers (a stray closing bracket, or content after one) - keep parsing
        while (state.pos < state.symbols.length) {
            const before = state.pos
            const sym = state.symbols[state.pos]
            if (sym.type === 'RPAREN') { state.pos++; continue }
            groups = groups.concat(parseOrExpr(state, 0))
            if (state.pos === before) { // safety: always progress
                unmatched.push(sym.raw || sym.type.toLowerCase())
                state.pos++
            }
        }
        // final merge pass: alternatives may come from separate parse resumptions
        // (e.g. after a stray bracket), so merge once more across the lot
        return { type: 'or', groups: mergeOrGroups(groups.filter(function (g) { return g.terms.length > 0 })) }
    }

    function parseOrExpr (state, depth) {
        const exceptGroups = []
        let groups = parseAndExpr(state, depth, exceptGroups)
        while (peek(state) && peek(state).type === 'OR') {
            state.pos++
            groups = groups.concat(parseAndExpr(state, depth, exceptGroups))
        }
        groups = groups.filter(function (g) { return g.terms.length > 0 })
        groups = groups.map(function (g) { return { type: 'and', terms: coalesceAnd(g.terms) } })
        groups = mergeOrGroups(groups)
        // "except X" applies to this whole scope (the innermost brackets, or the
        // full condition): AND NOT-X onto every alternative
        if (exceptGroups.length) {
            if (!groups.length) { groups = [{ type: 'and', terms: [{ kind: 'always', negate: false, source: '' }] }] }
            exceptGroups.forEach(function (ex) {
                groups = andCombine(groups, ex, state)
            })
        }
        return groups
    }

    function parseAndExpr (state, depth, exceptGroups) {
        let groups = null
        for (;;) {
            const sym = peek(state)
            if (!sym || sym.type === 'OR' || sym.type === 'RPAREN') { break }
            if (sym.type === 'AND' || sym.type === 'COMMA') { state.pos++; continue }
            let negate = false
            let distribute = false
            if (sym.type === 'NOT') {
                negate = true
                state.pos++
            } else if (sym.type === 'EXCEPT') {
                negate = true
                distribute = true
                state.pos++
            }
            const target = peek(state)
            if (!target) { break }
            let unitGroups
            if (target.type === 'LPAREN') {
                state.pos++
                unitGroups = parseOrExpr(state, depth + 1)
                if (peek(state) && peek(state).type === 'RPAREN') { state.pos++ } // tolerate a missing ')'
            } else {
                const startPos = state.pos
                const term = negate ? parseCoalescedTerm(state) : parseCondition(state)
                if (term) {
                    term.negate = !!term.negate
                    unitGroups = [{ type: 'and', terms: [term] }]
                } else {
                    if (state.pos === startPos) {
                        // nothing consumable - record and skip so the loop always progresses
                        if (['NOT', 'EXCEPT', 'OR', 'AND', 'COMMA', 'RPAREN'].indexOf(target.type) < 0) {
                            state.unmatched.push(target.raw || target.type.toLowerCase())
                        }
                        state.pos++
                    }
                    continue
                }
            }
            if (!unitGroups.length) { continue } // e.g. empty brackets
            if (negate) {
                unitGroups = negateGroups(unitGroups, state)
                if (distribute) {
                    // flag for description factoring ("... and day is not Tuesday")
                    unitGroups.forEach(function (g) { g.terms.forEach(function (t) { t.distributed = true }) })
                    exceptGroups.push(unitGroups)
                    continue
                }
            }
            groups = groups === null ? unitGroups : andCombine(groups, unitGroups, state)
        }
        return groups || []
    }

    // the term straight after "not"/"except": greedily folds a bare
    // "and"/"or"-joined run of same-kind mutually-exclusive terms into one
    // coalesced term before it gets negated - "except march and april" and
    // "not tuesday or wednesday" exclude every named alternative, mirroring
    // how the positive path already unions such lists (coalesceAnd). Stops
    // (without consuming) as soon as the run breaks, so an unrelated clause
    // like "except march and after 10pm" is left for the outer parser.
    function parseCoalescedTerm (state) {
        const term = parseCondition(state)
        if (!term || !coalescable(term)) { return term }
        const prop = MUTUALLY_EXCLUSIVE[term.kind]
        for (;;) {
            const joiner = peek(state)
            if (!joiner || (joiner.type !== 'AND' && joiner.type !== 'OR')) { break }
            const savedPos = state.pos
            state.pos++
            const next = parseCondition(state)
            if (next && next.kind === term.kind && coalescable(next)) {
                term[prop] = uniqSorted(term[prop].concat(next[prop]))
                term.source += ' ' + joiner.raw + ' ' + next.source
                continue
            }
            state.pos = savedPos // not a same-kind continuation - leave it for the outer parser
            break
        }
        return term
    }

    // cartesian AND of two OR-of-AND-group lists: every alternative on the left
    // combined with every alternative on the right. Terms are cloned so later
    // in-place coalescing of one row can never corrupt another.
    function andCombine (a, b, state) {
        const out = []
        a.forEach(function (g1) {
            b.forEach(function (g2) {
                out.push({ type: 'and', terms: clone(g1.terms).concat(clone(g2.terms)) })
            })
        })
        if (out.length > 64) { // far beyond any sane condition; guards pathological blow-up
            if (state && state.warnings) { state.warnings.push('condition too complex - some combinations were dropped') }
            return out.slice(0, 64)
        }
        return out
    }

    // De Morgan: NOT (OR of AND-groups) = AND over groups of (OR of negated
    // terms), re-expanded to OR-of-ANDs by cartesian combination.
    // e.g. not(sat or sun) -> [not-sat AND not-sun]
    function negateGroups (groups, state) {
        let result = [{ type: 'and', terms: [] }]
        groups.forEach(function (g) {
            const alternatives = g.terms.map(function (t) {
                const c = clone(t)
                c.negate = !c.negate
                delete c.distributed
                return { type: 'and', terms: [c] }
            })
            result = andCombine(result, alternatives, state)
        })
        return result
    }

    function peek (state, offset) {
        return state.symbols[state.pos + (offset || 0)]
    }

    function parseCondition (state) {
        const sym = peek(state)
        if (!sym) { return null }
        switch (sym.type) {
            case 'DAY':
            case 'DAYSET':
                return parseDayCond(state)
            case 'MONTH':
                return parseMonthCond(state)
            case 'ORD':
                return parseOrdinal(state)
            case 'NUM': {
                // "3rd tuesday of the month" - an ordinal number acts like an ordinal word
                if (sym.ordinal && Number.isInteger(sym.value) && sym.value >= 1 && sym.value <= 53 &&
                    peek(state, 1) && ['DAY', 'DAY_GENERIC', 'MONTH_GENERIC', 'WEEK_GENERIC', 'ORD'].indexOf(peek(state, 1).type) >= 0) {
                    state.symbols[state.pos] = { type: 'ORD', nth: sym.value, raw: sym.raw }
                    return parseOrdinal(state)
                }
                const offsetTerm = parseOffset(state)
                if (offsetTerm !== undefined) { return offsetTerm }
                const minuteTerm = parseMinuteOfHour(state)
                if (minuteTerm !== undefined) { return minuteTerm }
                if (!sym.ordinal && isYearNumber(sym.value)) { return parseYearCond(state) }
                return parseDayOfMonth(state)
            }
            case 'PARITY':
                return parseParity(state)
            case 'DAY_GENERIC':
            case 'MONTH_GENERIC':
            case 'YEAR_GENERIC': {
                // "day is odd", "month is even", "year is odd" (parity trails)
                if (peek(state, 1) && peek(state, 1).type === 'PARITY') {
                    const unit = sym.type === 'DAY_GENERIC' ? 'day' : (sym.type === 'MONTH_GENERIC' ? 'month' : 'year')
                    const paritySym = peek(state, 1)
                    state.pos += 2
                    return { kind: 'parity', unit, parity: paritySym.parity, source: sym.raw + ' is ' + paritySym.raw }
                }
                return null
            }
            case 'TERM': {
                state.pos++
                const term = clone(sym.term)
                term.source = sym.raw
                // "quarter past FIVE" / "half past 10pm" anchor to a clock time;
                // bare "quarter past [the hour]" means every hour
                if (term.kind === 'minuteOfHour') {
                    const anchor = consumeHourAnchor(state)
                    if (anchor) { return anchoredTime(term, anchor) }
                    consumeHourTail(state)
                }
                return term
            }
            case 'SOLAR_AMBIG': { // standalone dawn/dusk = the twilight state
                state.pos++
                const range = parseEventRangeTail(state, sym.event, sym.raw)
                if (range) { return range } // "dawn until noon"
                const term = clone(sym.state)
                term.source = sym.raw
                return term
            }
            case 'EVENT': {
                state.pos++
                const range = parseEventRangeTail(state, sym.event, sym.raw)
                if (range) { return range } // "sunrise until 6pm", "sunset to sunrise"
                // standalone "sunrise" = within 30 minutes of it
                return { kind: 'solarEvent', event: sym.event, op: 'within', withinMin: 30, source: sym.raw, assumed: true }
            }
            case 'BETWEEN':
                return parseBetween(state)
            case 'TO': // a LEADING range-word reads as "before": "until 6pm", "till sunset"
                state.symbols[state.pos] = { type: 'BEFORE', raw: sym.raw }
                return parseBeforeAfter(state)
            case 'BEFORE':
            case 'AFTER':
                return parseBeforeAfter(state)
            case 'WITHIN':
                return parseWithin(state)
            case 'TIME':
            case 'TIMEWORD': {
                state.pos++
                // "10pm to 6am" / "9am - 5pm" / "noon to 3pm": a bare time followed
                // by a range word is a range (no "between" needed)
                const joiner = peek(state)
                if (joiner && (joiner.type === 'TO' || joiner.type === 'DASH')) {
                    const endSym = peek(state, 1)
                    const endMin = clockMinutesFromSym(endSym)
                    if (endMin !== null) {
                        state.pos += 2
                        return { kind: 'timeRange', style: 'between', startMin: sym.minutes, endMin, source: sym.raw + ' to ' + endSym.raw }
                    }
                    const endEv = eventFromSym(endSym)
                    if (endEv) { // "10pm to sunrise": clock start, solar end
                        state.pos += 2
                        return { kind: 'solarBetween', fromTime: sym.minutes, to: endEv, source: sym.raw + ' to ' + endSym.raw }
                    }
                }
                // otherwise = that exact minute
                return { kind: 'timeRange', style: 'at', startMin: sym.minutes, endMin: sym.minutes, source: sym.raw }
            }
            case 'MOON_WORD':
                return parseMoonCondition(state)
            case 'SUN_WORD':
                if (peek(state, 1) && peek(state, 1).type === 'AZIMUTH') {
                    return parseCelestialAzimuth(state, 'sunAzimuth')
                }
                return parseCelestialAltitude(state, 'sunAltitude')
            default:
                return null
        }
    }

    // optional-minus degree value: consumes [DASH] NUM, returns the number or null
    function parseDegreeValue (state) {
        let sign = 1
        let consumed = 0
        if (peek(state) && peek(state).type === 'DASH') { sign = -1; consumed = 1 }
        const num = peek(state, consumed)
        if (!num || num.type !== 'NUM' || num.ordinal) { return null }
        state.pos += consumed + 1
        return sign * num.value
    }

    // "sun/moon [is] between 10 and 12 degrees" / "above 30 degrees" / "below -6 degrees".
    // The leading SUN_WORD/MOON_WORD symbol is at the current position.
    function parseCelestialAltitude (state, kind) {
        const word = peek(state)
        state.pos++
        const cmp = peek(state)
        const bodyText = kind === 'sunAltitude' ? 'sun' : 'moon'
        if (cmp && cmp.type === 'BETWEEN') {
            state.pos++
            const low = parseDegreeValue(state)
            if (peek(state) && (peek(state).type === 'AND' || peek(state).type === 'TO')) { state.pos++ }
            const high = parseDegreeValue(state)
            if (peek(state) && peek(state).type === 'DEG') { state.pos++ }
            if (low !== null && high !== null) {
                return { kind, op: 'between', low: Math.min(low, high), high: Math.max(low, high), source: bodyText + ' between ' + low + ' and ' + high + ' degrees' }
            }
            state.unmatched.push(word.raw + ' between')
            return null
        }
        if (cmp && ['ABOVE', 'MORE', 'BELOW', 'LESS'].indexOf(cmp.type) >= 0) {
            state.pos++
            const degrees = parseDegreeValue(state)
            if (peek(state) && peek(state).type === 'DEG') { state.pos++ }
            if (degrees !== null) {
                const op = (cmp.type === 'ABOVE' || cmp.type === 'MORE') ? 'above' : 'below'
                return { kind, op, degrees, source: bodyText + ' ' + op + ' ' + degrees + ' degrees' }
            }
            state.unmatched.push(word.raw + ' ' + cmp.raw)
            return null
        }
        state.unmatched.push(word.raw)
        return null
    }

    function normalizeDeg (d) {
        return ((d % 360) + 360) % 360
    }

    // "sun/moon azimuth [is] between 134 and 138 [degrees]". The leading
    // SUN_WORD/MOON_WORD and the AZIMUTH symbol are both at the current position.
    // Azimuth is a compass bearing (0-360, from North), so unlike altitude it
    // wraps: "between 350 and 10" spans north through 360/0 (see evalTerm). Only
    // "between" is supported - a bearing has no natural "above/below" the way
    // altitude has a horizon.
    function parseCelestialAzimuth (state, kind) {
        const word = peek(state)
        const azWord = peek(state, 1)
        state.pos += 2
        const bodyText = (kind === 'sunAzimuth' ? 'sun' : 'moon') + ' azimuth'
        const cmp = peek(state)
        if (cmp && cmp.type === 'BETWEEN') {
            state.pos++
            const low = parseDegreeValue(state)
            if (peek(state) && (peek(state).type === 'AND' || peek(state).type === 'TO')) { state.pos++ }
            const high = parseDegreeValue(state)
            if (peek(state) && peek(state).type === 'DEG') { state.pos++ }
            if (low !== null && high !== null) {
                return { kind, op: 'between', low: normalizeDeg(low), high: normalizeDeg(high), source: bodyText + ' between ' + low + ' and ' + high + ' degrees' }
            }
            state.unmatched.push(word.raw + ' ' + azWord.raw + ' between')
            return null
        }
        state.unmatched.push(word.raw + ' ' + azWord.raw)
        return null
    }

    function parseDayCond (state) {
        const first = peek(state)
        state.pos++
        let days = first.type === 'DAY' ? [first.day] : first.days.slice()
        let source = first.raw
        let sabbath = !!first.sabbath
        let setName = first.type === 'DAYSET' ? first.name : null
        // range: DAY (to|-) DAY
        const op = peek(state)
        if (first.type === 'DAY' && op && (op.type === 'TO' || op.type === 'DASH') && peek(state, 1) && peek(state, 1).type === 'DAY') {
            const last = peek(state, 1)
            state.pos += 2
            days = dayRange(first.day, last.day)
            source += ' to ' + last.raw
            setName = null
            sabbath = false
        }
        const term = { kind: 'day', days: uniqSorted(days), source }
        if (sabbath) { term.sabbath = true }
        if (setName) { term.setName = setName }
        return term
    }

    function dayRange (from, to) {
        const days = []
        let d = from
        for (;;) {
            days.push(d)
            if (d === to) { break }
            d = (d + 1) % 7
        }
        return days
    }

    function parseMonthCond (state) {
        const first = peek(state)
        state.pos++
        let months = [first.month]
        let source = first.raw
        const op = peek(state)
        if (op && (op.type === 'TO' || op.type === 'DASH') && peek(state, 1) && peek(state, 1).type === 'MONTH') {
            const last = peek(state, 1)
            state.pos += 2
            months = monthRange(first.month, last.month)
            source += ' to ' + last.raw
        }
        return { kind: 'month', months: uniqSorted(months), source }
    }

    function monthRange (from, to) {
        const months = []
        let m = from
        for (;;) {
            months.push(m)
            if (m === to) { break }
            m = (m % 12) + 1
        }
        return months
    }

    function parseDayOfMonth (state) {
        const num = peek(state)
        if (!num.ordinal) { return null } // bare non-ordinal numbers are not conditions
        if (!Number.isInteger(num.value) || num.value < 1 || num.value > 31) { return null }
        state.pos++
        let source = num.raw
        // optional "of the month"
        if (peek(state) && peek(state).type === 'OF' && peek(state, 1) && peek(state, 1).type === 'MONTH_GENERIC') {
            state.pos += 2
            source += ' of the month'
        } else if (peek(state) && peek(state).type === 'MONTH_GENERIC') {
            state.pos++
            source += ' of the month'
        }
        return { kind: 'dayOfMonth', days: [num.value], source }
    }

    function eventFromSym (sym) {
        if (!sym) { return null }
        if (sym.type === 'EVENT') { return sym.event }
        if (sym.type === 'SOLAR_AMBIG') { return sym.event }
        return null
    }

    function isYearNumber (value) {
        return Number.isInteger(value) && value >= 1970 && value <= 2100
    }

    // bare year(s): "2027", "in 2027", "2027 to 2029"
    function parseYearCond (state) {
        const first = peek(state)
        state.pos++
        let years = [first.value]
        let source = first.raw
        const op = peek(state)
        if (op && (op.type === 'TO' || op.type === 'DASH') && peek(state, 1) && peek(state, 1).type === 'NUM' && isYearNumber(peek(state, 1).value)) {
            const last = peek(state, 1)
            state.pos += 2
            years = []
            for (let y = Math.min(first.value, last.value); y <= Math.max(first.value, last.value); y++) { years.push(y) }
            source += ' to ' + last.raw
        }
        return { kind: 'year', years: uniqSorted(years), source }
    }

    // ordinal conditions: "first monday of the month", "third tuesday",
    // "last day of the month", "first/last day of the week", "first of the month",
    // "first monday of the year", "2nd tuesday of 2028", "first monday of january"
    function parseOrdinal (state) {
        let ord = peek(state)
        state.pos++
        // "2nd last X" / "second last X": a numeric ordinal followed by 'last'
        // counts from the end (fromEnd 1 = last, 2 = second last, ...)
        let fromEnd = ord.nth === 'last' ? 1 : 0
        if (Number.isInteger(ord.nth) && peek(state) && peek(state).type === 'ORD' && peek(state).nth === 'last') {
            fromEnd = ord.nth
            ord = { nth: 'last', raw: ord.raw + ' last' }
            state.pos++
        }
        let next = peek(state)
        // "last 2 days of feb", "first 3 days of march", "last 5 days of the
        // year", "last 2 weeks of the year", "first 3 months of the year"
        if ((ord.nth === 'last' || ord.nth === 1) && next && next.type === 'NUM' && !next.ordinal &&
            Number.isInteger(next.value) && next.value >= 1 &&
            peek(state, 1) && peek(state, 1).type === 'UNIT' &&
            ['day', 'week', 'month'].indexOf(peek(state, 1).unit) >= 0) {
            const count = next.value
            const countUnit = peek(state, 1).unit
            const isLast = ord.nth === 'last'
            state.pos += 2
            if (peek(state) && peek(state).type === 'OF') { state.pos++ }
            const scope = peek(state)
            let scopeKind = null // 'month' | 'year'
            let month
            let year
            let scopeRaw = ''
            if (scope && scope.type === 'MONTH_GENERIC') {
                state.pos++
                scopeKind = 'month'
                scopeRaw = 'the month'
            } else if (scope && scope.type === 'YEAR_GENERIC') {
                state.pos++
                scopeKind = 'year'
                scopeRaw = 'the year'
            } else if (scope && scope.type === 'MONTH') { // "last 2 days of feb [2027]"
                state.pos++
                scopeKind = 'month'
                month = scope.month
                scopeRaw = scope.raw
                if (peek(state) && peek(state).type === 'NUM' && !peek(state).ordinal && isYearNumber(peek(state).value)) {
                    year = peek(state).value
                    state.pos++
                }
            } else if (scope && scope.type === 'NUM' && !scope.ordinal && isYearNumber(scope.value)) { // "last 5 days of 2027"
                state.pos++
                scopeKind = 'year'
                year = scope.value
                scopeRaw = String(year)
            }
            const source = ord.raw + ' ' + count + ' ' + countUnit + 's of ' + scopeRaw
            // bare "last 2 days" reads as "the previous two days" - require a scope
            if (!scopeKind) {
                state.unmatched.push(ord.raw + ' ' + count + ' ' + countUnit + 's')
                return null
            }
            if (countUnit === 'month') { // "first/last N months of the year"
                if (scopeKind !== 'year' || count > 12) {
                    state.unmatched.push(source)
                    return null
                }
                const months = []
                for (let i = 0; i < count; i++) { months.push(isLast ? 12 - i : 1 + i) }
                const term = { kind: 'month', months: uniqSorted(months), source }
                if (year) { term.year = year }
                return term
            }
            const days = count * (countUnit === 'week' ? 7 : 1)
            if (days > (scopeKind === 'year' ? 366 : 31)) {
                state.unmatched.push(source)
                return null
            }
            const term = { kind: 'dayOfMonth', days: [], source }
            term[isLast ? 'lastCount' : 'firstCount'] = days
            if (scopeKind === 'year') { term.scope = 'year' }
            if (month) { term.month = month }
            if (year) { term.year = year }
            return term
        }
        // ORD month of (the year | 2027): "last month of the year" -> December,
        // "last month of 2027" -> December 2027
        if (next && next.type === 'MONTH_GENERIC') {
            state.pos++
            let sawScope = false
            let year
            if (peek(state) && peek(state).type === 'OF') { state.pos++ }
            if (peek(state) && peek(state).type === 'YEAR_GENERIC') {
                state.pos++
                sawScope = true
            } else if (peek(state) && peek(state).type === 'NUM' && !peek(state).ordinal && isYearNumber(peek(state).value)) {
                year = peek(state).value
                state.pos++
                sawScope = true
            }
            let month = null
            if (ord.nth === 'last') {
                month = 12 - (fromEnd - 1) // "2nd last month of the year" = November
                if (month < 1) { month = null }
            } else if (Number.isInteger(ord.nth) && ord.nth >= 1 && ord.nth <= 12) {
                month = ord.nth
            }
            // bare "last month" (no scope) reads as "the previous month" in
            // everyday English - too ambiguous, so require "of the year"/"of 2027"
            if (month === null || !sawScope) {
                state.unmatched.push(ord.raw + ' month')
                return null
            }
            const term = { kind: 'month', months: [month], source: ord.raw + ' month of ' + (year || 'the year') }
            if (year) { term.year = year }
            return term
        }
        // ORD week of (the month | the year | january | 2027): a 7-day slice.
        // Bare "last week" (= the previous week) is ambiguous, so a scope is required.
        if (next && next.type === 'WEEK_GENERIC') {
            state.pos++
            if (peek(state) && peek(state).type === 'OF') { state.pos++ }
            const scope = peek(state)
            const term = { kind: 'ordinalWeek', nth: ord.nth, scope: 'month', source: ord.raw + ' week' }
            let ok = false
            if (scope && scope.type === 'MONTH_GENERIC') {
                state.pos++
                term.source += ' of the month'
                ok = true
            } else if (scope && scope.type === 'YEAR_GENERIC') {
                state.pos++
                term.scope = 'year'
                term.source += ' of the year'
                ok = true
            } else if (scope && scope.type === 'MONTH') { // "first week of january [2027]"
                state.pos++
                term.month = scope.month
                term.source += ' of ' + scope.raw
                if (peek(state) && peek(state).type === 'NUM' && !peek(state).ordinal && isYearNumber(peek(state).value)) {
                    term.year = peek(state).value
                    state.pos++
                }
                ok = true
            } else if (scope && scope.type === 'NUM' && !scope.ordinal && isYearNumber(scope.value)) { // "last week of 2027"
                state.pos++
                term.scope = 'year'
                term.year = scope.value
                term.source += ' of ' + scope.raw
                ok = true
            }
            const maxNth = term.scope === 'year' ? 53 : 5
            if (!ok || (ord.nth !== 'last' && (!Number.isInteger(ord.nth) || ord.nth < 1 || ord.nth > maxNth))) {
                state.unmatched.push(ord.raw + ' week')
                return null
            }
            if (ord.nth === 'last' && fromEnd > 1) { term.fromEnd = fromEnd }
            return term
        }
        // ORD DAY [of] [the month|the year|january|2028] -> nth weekday of a scope
        if (next && next.type === 'DAY') {
            if (ord.nth !== 'last' && (!Number.isInteger(ord.nth) || ord.nth > 5)) {
                state.unmatched.push(ord.raw)
                return null
            }
            state.pos++
            const term = { kind: 'nthWeekday', nth: ord.nth, day: next.day, source: ord.raw + ' ' + next.raw }
            if (ord.nth === 'last' && fromEnd > 1) { term.fromEnd = fromEnd } // "2nd last friday"
            if (peek(state) && peek(state).type === 'OF') { state.pos++ }
            const scope = peek(state)
            if (scope && scope.type === 'MONTH_GENERIC') {
                state.pos++
                term.source += ' of the month'
            } else if (scope && scope.type === 'YEAR_GENERIC') {
                state.pos++
                term.scope = 'year'
                term.source += ' of the year'
            } else if (scope && scope.type === 'MONTH') { // "first monday of january [2027]"
                state.pos++
                term.month = scope.month
                term.source += ' of ' + scope.raw
                if (peek(state) && peek(state).type === 'NUM' && !peek(state).ordinal && isYearNumber(peek(state).value)) {
                    term.year = peek(state).value
                    term.source += ' ' + peek(state).raw
                    state.pos++
                }
            } else if (scope && scope.type === 'NUM' && !scope.ordinal && isYearNumber(scope.value)) { // "2nd tuesday of 2028"
                state.pos++
                term.scope = 'year'
                term.year = scope.value
                term.source += ' of ' + scope.raw
            }
            return term
        }
        // ORD [day] of the week|month|year
        let hadGenericDay = false
        if (next && next.type === 'DAY_GENERIC') { state.pos++; hadGenericDay = true; next = peek(state) }
        if (peek(state) && peek(state).type === 'OF') { state.pos++ }
        const scope = peek(state)
        if (scope && scope.type === 'WEEK_GENERIC') {
            state.pos++
            // ISO 8601 week: Monday is the first day, Sunday the last (documented in help)
            const isoDays = [1, 2, 3, 4, 5, 6, 0]
            const day = ord.nth === 'last' ? 0 : isoDays[ord.nth - 1]
            if (day === undefined) {
                state.unmatched.push(ord.raw + ' day of the week')
                return null
            }
            return { kind: 'day', days: [day], weekOrdinal: ord.nth, source: ord.raw + ' day of the week' }
        }
        if (scope && scope.type === 'MONTH_GENERIC') {
            state.pos++
            if (ord.nth === 'last') {
                const term = { kind: 'dayOfMonth', days: [], last: true, source: ord.raw + ' day of the month' }
                if (fromEnd > 1) { term.lastOffset = fromEnd - 1 } // "2nd last day of the month"
                return term
            }
            return { kind: 'dayOfMonth', days: [ord.nth], source: ord.raw + ' day of the month' }
        }
        // "last day of january [2027]", "3rd day of feb"
        if (scope && scope.type === 'MONTH' && hadGenericDay) {
            state.pos++
            const term = { kind: 'dayOfMonth', days: [], month: scope.month, source: ord.raw + ' day of ' + scope.raw }
            if (peek(state) && peek(state).type === 'NUM' && !peek(state).ordinal && isYearNumber(peek(state).value)) {
                term.year = peek(state).value
                state.pos++
            }
            if (ord.nth === 'last') {
                term.last = true
                if (fromEnd > 1) { term.lastOffset = fromEnd - 1 }
            } else if (Number.isInteger(ord.nth) && ord.nth >= 1 && ord.nth <= 31) {
                term.days = [ord.nth]
            } else {
                state.unmatched.push(term.source)
                return null
            }
            return term
        }
        if (scope && scope.type === 'YEAR_GENERIC') {
            state.pos++
            if (ord.nth === 'last') {
                const term = { kind: 'namedDate', month: 12, day: 31, name: 'last day of the year', source: ord.raw + ' day of the year' }
                if (fromEnd > 1) { term.offsetDays = -(fromEnd - 1) } // "2nd last day of the year" = 30 Dec
                return term
            }
            if (ord.nth === 1) {
                return { kind: 'namedDate', month: 1, day: 1, name: 'first day of the year', source: ord.raw + ' day of the year' }
            }
            state.unmatched.push(ord.raw + ' day of the year')
            return null
        }
        // "last day of 2027", "first day of 2027"
        if (scope && scope.type === 'NUM' && !scope.ordinal && isYearNumber(scope.value) && hadGenericDay) {
            state.pos++
            const year = scope.value
            if (ord.nth === 'last') {
                return { kind: 'namedDate', month: 12, day: 31, year, name: 'last day of ' + year, source: ord.raw + ' day of ' + year }
            }
            if (Number.isInteger(ord.nth) && ord.nth >= 1 && ord.nth <= 31) { // nth day of the year, resolved with the year known
                const date = new Date(Date.UTC(year, 0, ord.nth))
                return { kind: 'namedDate', month: date.getUTCMonth() + 1, day: date.getUTCDate(), year, source: ord.raw + ' day of ' + year }
            }
            state.unmatched.push(ord.raw + ' day of ' + year)
            return null
        }
        state.unmatched.push(ord.raw + (hadGenericDay ? ' day' : ''))
        return null
    }

    // minute-of-hour from a number: "10 past", "15 minutes past the hour",
    // "5 to [the hour]", "ten past ten" (anchored -> clock time). Returns
    // undefined when the symbols are not a minute-of-hour expression.
    function parseMinuteOfHour (state) {
        const num = peek(state)
        if (num.ordinal || num.value >= 60 || !Number.isInteger(num.value)) { return undefined }
        let idx = 1
        let hasMinuteUnit = false
        if (peek(state, 1) && peek(state, 1).type === 'UNIT' && peek(state, 1).unit === 'minute') {
            idx = 2
            hasMinuteUnit = true
        }
        const op = peek(state, idx)
        if (op && op.type === 'PAST') {
            state.pos += idx + 1
            const term = { kind: 'minuteOfHour', style: 'at', startMin: num.value, rel: 'past', source: num.raw + (hasMinuteUnit ? ' minutes' : '') + ' past' }
            const anchor = consumeHourAnchor(state)
            if (anchor) { return anchoredTime(term, anchor) }
            consumeHourTail(state) // "past the hour"
            return term
        }
        if (op && op.type === 'TO') {
            // only take "N to" as minutes-to-the-hour when what follows is an
            // hour ("5 to six"), "the hour", or nothing - never a date range
            const after = peek(state, idx + 1)
            const boundary = !after || ['AND', 'OR', 'COMMA', 'RPAREN', 'EXCEPT', 'NOT'].indexOf(after.type) >= 0
            const isHourUnit = after && after.type === 'UNIT' && after.unit === 'hour'
            const isAnchor = after && ((after.type === 'NUM' && !after.ordinal && after.value <= 23) ||
                after.type === 'TIMEWORD' || (after.type === 'TIME' && after.minutes % 60 === 0))
            // an hour anchor after digit-TO is ambiguous ("9 to 5" means working
            // hours to most people, not 04:51) - only word numbers ("five to
            // nine") or an explicit unit ("5 minutes to 9") take that reading
            const anchorAllowed = hasMinuteUnit || num.wordNum
            if (boundary || isHourUnit || (isAnchor && anchorAllowed)) {
                state.pos += idx + 1
                const term = { kind: 'minuteOfHour', style: 'at', startMin: 60 - num.value, rel: 'to', source: num.raw + (hasMinuteUnit ? ' minutes' : '') + ' to' }
                const anchor = consumeHourAnchor(state)
                if (anchor) { return anchoredTime(term, anchor) }
                if (isHourUnit) { state.pos++ } // "to the hour"
                return term
            }
        }
        return undefined
    }

    // parity leading: "odd days", "even months", "even years"
    function parseParity (state) {
        const paritySym = peek(state)
        state.pos++
        const scope = peek(state)
        const units = { DAY_GENERIC: 'day', MONTH_GENERIC: 'month', YEAR_GENERIC: 'year' }
        if (scope && units[scope.type]) {
            state.pos++
            return { kind: 'parity', unit: units[scope.type], parity: paritySym.parity, source: paritySym.raw + ' ' + scope.raw }
        }
        state.unmatched.push(paritySym.raw)
        return null
    }

    // quantity offsets: "4 days after christmas", "1 month before xmas",
    // "day before christmas" (synthesised as 1 day), "2 hours after sunset".
    // Returns undefined when the symbols are not an offset expression at all
    // (so plain ordinal day-of-month parsing can have a go), null on failure.
    function parseOffset (state) {
        const num = peek(state)
        const unit = peek(state, 1)
        if (!unit || unit.type !== 'UNIT') { return undefined }
        const op = peek(state, 2)
        if (!op || (op.type !== 'BEFORE' && op.type !== 'AFTER')) { return undefined }
        const dir = op.type === 'BEFORE' ? 'before' : 'after'
        const opIdx = state.pos + 2
        state.pos += 3
        const anchor = peek(state)
        const quantityRaw = (num.synth ? '' : num.raw + ' ') + unit.raw
        const sign = dir === 'before' ? -1 : 1
        const minuteUnit = unit.unit === 'minute' || unit.unit === 'hour'
        const dateUnit = unit.unit === 'day' || unit.unit === 'week' || unit.unit === 'month'
        // solar anchor: N minutes/hours before|after a solar event
        const ev = eventFromSym(anchor)
        if (ev && minuteUnit) {
            state.pos++
            return { kind: 'solarEvent', event: ev, op: dir, offsetMin: num.value * unit.factor, source: quantityRaw + ' ' + dir + ' ' + anchor.raw }
        }
        // clock anchor: "2 hours before noon" = before 10:00
        if (minuteUnit && anchor && (anchor.type === 'TIME' || anchor.type === 'TIMEWORD')) {
            state.pos++
            const bound = anchor.minutes + (sign * Math.round(num.value * unit.factor))
            const source = quantityRaw + ' ' + dir + ' ' + anchor.raw
            if (dir === 'before') {
                return { kind: 'timeRange', style: 'before', startMin: 0, endMin: bound <= 0 ? 1440 + bound : bound, source }
            }
            return { kind: 'timeRange', style: 'after', startMin: bound % 1440, endMin: 1440, source }
        }
        // date-ish anchors are full sub-conditions: "2 days before the last day of
        // the month", "day after blue moon", "2 days before friday", "before xmas"
        if (dateUnit && Number.isInteger(num.value)) {
            const savedPos = state.pos
            const anchorTerm = parseCondition(state)
            const offsetDays = num.value * unit.factor
            const source = quantityRaw + ' ' + dir + ' ' + (anchorTerm ? anchorTerm.source : '')
            if (anchorTerm && anchorTerm.kind === 'namedDate' && unit.unit === 'month') {
                anchorTerm.offsetMonths = (anchorTerm.offsetMonths || 0) + (sign * num.value)
                anchorTerm.source = source
                return anchorTerm
            }
            if (anchorTerm && unit.unit !== 'month') {
                if (anchorTerm.kind === 'namedDate') {
                    anchorTerm.offsetDays = (anchorTerm.offsetDays || 0) + (sign * offsetDays)
                    anchorTerm.source = source
                    return anchorTerm
                }
                if (anchorTerm.kind === 'moonPhase') { // "day before blue moon"
                    anchorTerm.offsetDays = (anchorTerm.offsetDays || 0) + (sign * offsetDays)
                    anchorTerm.source = source
                    return anchorTerm
                }
                if (anchorTerm.kind === 'day' && !anchorTerm.weekOrdinal && anchorTerm.days.length === 1) {
                    // "2 days before friday" = Wednesday
                    const day = ((anchorTerm.days[0] + (sign * offsetDays)) % 7 + 7) % 7
                    return { kind: 'day', days: [day], source }
                }
                if (anchorTerm.kind === 'dayOfMonth' && anchorTerm.last) {
                    if (dir === 'before') { // "2 days before the last day of the month"
                        anchorTerm.lastOffset = (anchorTerm.lastOffset || 0) + offsetDays
                        anchorTerm.source = source
                        return anchorTerm
                    }
                    // "N days after the last day of the month" = the Nth of the NEXT month
                    const term = { kind: 'dayOfMonth', days: [offsetDays - (anchorTerm.lastOffset || 0)], source }
                    if (anchorTerm.month) {
                        term.month = (anchorTerm.month % 12) + 1
                        if (anchorTerm.year) { term.year = anchorTerm.month === 12 ? anchorTerm.year + 1 : anchorTerm.year }
                    }
                    if (term.days[0] >= 1 && term.days[0] <= 28) { return term }
                }
                if (anchorTerm.kind === 'dayOfMonth' && !anchorTerm.last && anchorTerm.days.length === 1) {
                    // "2 days before the 15th of the month" = the 13th
                    const day = anchorTerm.days[0] + (sign * offsetDays)
                    if (day >= 1 && day <= 31) {
                        anchorTerm.days = [day]
                        anchorTerm.source = source
                        return anchorTerm
                    }
                }
            }
            state.pos = savedPos // anchor was not date-ish - give the symbols back
        }
        // no usable anchor ("day before noon"): ignore the quantity and parse the
        // plain before/after so the rest of the meaning survives
        state.unmatched.push(quantityRaw)
        state.pos = opIdx
        return parseBeforeAfter(state)
    }

    // "sunrise until 6pm" / "sunset to sunrise": a solar event followed by a
    // range word starts a window ending at a clock time or another event.
    // The event symbol itself is already consumed. Null when not a range.
    function parseEventRangeTail (state, eventName, raw) {
        const joiner = peek(state)
        if (!joiner || (joiner.type !== 'TO' && joiner.type !== 'DASH')) { return null }
        const endSym = peek(state, 1)
        const endMin = clockMinutesFromSym(endSym)
        if (endMin !== null) {
            state.pos += 2
            return { kind: 'solarBetween', from: eventName, toTime: endMin, source: raw + ' to ' + endSym.raw }
        }
        const endEv = eventFromSym(endSym)
        if (endEv) {
            state.pos += 2
            return { kind: 'solarBetween', from: eventName, to: endEv, source: raw + ' to ' + endSym.raw }
        }
        return null
    }

    // minutes-of-day from a time-ish symbol: a TIME/TIMEWORD, or a bare hour
    // number ("9am to 17" - matches what parseBetween accepts). Null otherwise.
    function clockMinutesFromSym (sym) {
        if (!sym) { return null }
        if (sym.type === 'TIME' || sym.type === 'TIMEWORD') { return sym.minutes }
        if (sym.type === 'NUM' && !sym.ordinal && Number.isInteger(sym.value) && sym.value <= 23) { return sym.value * 60 }
        return null
    }

    // consume an hour anchor after a minute-of-hour phrase ("quarter past FIVE",
    // "ten past 10pm") - returns minutes-of-day for the hour, or null
    function consumeHourAnchor (state) {
        const sym = peek(state)
        if (!sym) { return null }
        if (sym.type === 'NUM' && !sym.ordinal && Number.isInteger(sym.value) && sym.value <= 23) {
            state.pos++
            return { base: sym.value * 60, raw: sym.raw }
        }
        if (sym.type === 'TIMEWORD' || (sym.type === 'TIME' && sym.minutes % 60 === 0)) {
            state.pos++
            return { base: sym.minutes, raw: sym.raw }
        }
        return null
    }

    // consume the optional "past [the] hour" / "the hour" tail of minute conditions
    function consumeHourTail (state) {
        if (peek(state) && peek(state).type === 'PAST') { state.pos++ }
        if (peek(state) && peek(state).type === 'UNIT' && peek(state).unit === 'hour') { state.pos++ }
    }

    // anchor a minute-of-hour "past"/"to" onto a specific hour: quarter past five
    // = 05:15, quarter to five = 04:45 (startMin for 'to' is already 60-x)
    function anchoredTime (minuteTerm, anchor) {
        let base = anchor.base
        if (minuteTerm.rel === 'to') {
            base = (base + (23 * 60)) % 1440 // the hour BEFORE the named one
        }
        const min = (base + minuteTerm.startMin) % 1440
        return { kind: 'timeRange', style: 'at', startMin: min, endMin: min, source: minuteTerm.source + ' ' + anchor.raw }
    }

    function parseBetween (state) {
        const start = peek(state)
        state.pos++
        const a = peek(state)
        // minute-of-hour range: "between 15 minutes and 30 minutes past the hour",
        // "from 0 minutes to 10 minutes" (checked before the clock-time branch
        // because a bare small number there means an HOUR)
        if (a && a.type === 'NUM' && !a.ordinal && Number.isInteger(a.value) && a.value < 60 &&
            peek(state, 1) && peek(state, 1).type === 'UNIT' && peek(state, 1).unit === 'minute') {
            const startMin = a.value
            state.pos += 2
            const joiner = peek(state)
            if (joiner && (joiner.type === 'AND' || joiner.type === 'TO' || joiner.type === 'DASH')) { state.pos++ }
            const b = peek(state)
            if (b && b.type === 'NUM' && !b.ordinal && b.value <= 60) {
                state.pos++
                if (peek(state) && peek(state).type === 'UNIT' && peek(state).unit === 'minute') { state.pos++ }
                consumeHourTail(state)
                return { kind: 'minuteOfHour', style: 'between', startMin, endMin: b.value, source: start.raw + ' ' + a.raw + ' and ' + b.raw + ' minutes past the hour' }
            }
            state.unmatched.push(start.raw + ' ' + a.raw + ' minutes')
            return null
        }
        // time range: between TIME and TIME
        if (a && (a.type === 'TIME' || a.type === 'TIMEWORD' || (a.type === 'NUM' && !a.ordinal && a.value <= 23))) {
            const startMin = a.type === 'NUM' ? a.value * 60 : a.minutes
            state.pos++
            const joiner = peek(state)
            if (joiner && (joiner.type === 'AND' || joiner.type === 'TO' || joiner.type === 'DASH')) { state.pos++ }
            const b = peek(state)
            if (b && (b.type === 'TIME' || b.type === 'TIMEWORD' || (b.type === 'NUM' && !b.ordinal && b.value <= 23))) {
                const endMin = b.type === 'NUM' ? b.value * 60 : b.minutes
                state.pos++
                return { kind: 'timeRange', style: 'between', startMin, endMin, source: start.raw + ' ' + a.raw + ' and ' + b.raw }
            }
            const endEv = eventFromSym(b)
            if (endEv) { // "between 10pm and sunrise"
                state.pos++
                return { kind: 'solarBetween', fromTime: startMin, to: endEv, source: start.raw + ' ' + a.raw + ' and ' + b.raw }
            }
            // dangling "between 9am and ..." - give back what we can
            state.unmatched.push(start.raw + ' ' + a.raw)
            return null
        }
        // solar range: between EVENT and (EVENT | clock time)
        const evA = eventFromSym(a)
        if (evA) {
            state.pos++
            const joiner = peek(state)
            if (joiner && (joiner.type === 'AND' || joiner.type === 'TO' || joiner.type === 'DASH')) { state.pos++ }
            const b = peek(state)
            const evB = eventFromSym(b)
            if (evB) {
                state.pos++
                return { kind: 'solarBetween', from: evA, to: evB, source: start.raw + ' ' + a.raw + ' and ' + b.raw }
            }
            const endMin = clockMinutesFromSym(b)
            if (endMin !== null) { // "between sunset and 11pm"
                state.pos++
                return { kind: 'solarBetween', from: evA, toTime: endMin, source: start.raw + ' ' + a.raw + ' and ' + b.raw }
            }
            state.unmatched.push(start.raw + ' ' + a.raw)
            return null
        }
        state.unmatched.push(start.raw)
        return null
    }

    function parseBeforeAfter (state) {
        const opSym = peek(state)
        const op = opSym.type === 'BEFORE' ? 'before' : 'after'
        state.pos++
        const target = peek(state)
        if (target && (target.type === 'TIME' || target.type === 'TIMEWORD')) {
            state.pos++
            if (op === 'before') {
                // "before/until midnight" means the end of the day, not 00:00
                const endMin = target.minutes === 0 ? 1440 : target.minutes
                return { kind: 'timeRange', style: 'before', startMin: 0, endMin, source: opSym.raw + ' ' + target.raw }
            }
            return { kind: 'timeRange', style: 'after', startMin: target.minutes, endMin: 1440, source: opSym.raw + ' ' + target.raw }
        }
        const ev = eventFromSym(target)
        if (ev) {
            state.pos++
            return { kind: 'solarEvent', event: ev, op, source: opSym.raw + ' ' + target.raw }
        }
        // "after dark" is a phrase (dark = TERM); "before/after <term>" makes no sense otherwise
        if (target && target.type === 'TERM' && target.term.kind === 'sunAltitude' && target.term.op === 'below') {
            // e.g. "after dark" if the phrase table didn't already combine it
            state.pos++
            const term = clone(target.term)
            term.source = opSym.raw + ' ' + target.raw
            return term
        }
        // minute-of-hour and anchored-time sub-conditions: "before quarter to
        // [the hour]", "after 20 past", "before quarter past five" (= before 05:15)
        if (target && (target.type === 'NUM' || (target.type === 'TERM' && target.term.kind === 'minuteOfHour'))) {
            const savedPos = state.pos
            const sub = parseCondition(state)
            if (sub && sub.kind === 'minuteOfHour' && sub.style === 'at') {
                return { kind: 'minuteOfHour', style: op, startMin: sub.startMin, source: opSym.raw + ' ' + sub.source }
            }
            if (sub && sub.kind === 'timeRange' && sub.style === 'at') {
                if (op === 'before') {
                    return { kind: 'timeRange', style: 'before', startMin: 0, endMin: sub.startMin, source: opSym.raw + ' ' + sub.source }
                }
                return { kind: 'timeRange', style: 'after', startMin: sub.startMin, endMin: 1440, source: opSym.raw + ' ' + sub.source }
            }
            state.pos = savedPos // not a time-ish thing after all - leave it for the main loop
        }
        state.unmatched.push(opSym.raw)
        return null
    }

    function parseWithin (state) {
        const start = peek(state)
        state.pos++
        const num = peek(state)
        if (!num || num.type !== 'NUM') {
            state.unmatched.push(start.raw)
            return null
        }
        state.pos++
        let unitSym = null
        if (peek(state) && peek(state).type === 'UNIT') {
            unitSym = peek(state)
            state.pos++
        }
        if (peek(state) && peek(state).type === 'OF') { state.pos++ }
        const target = peek(state)
        const ev = eventFromSym(target)
        if (ev) {
            const factor = unitSym ? unitSym.factor : 1 // no unit -> minutes
            state.pos++
            return { kind: 'solarEvent', event: ev, op: 'within', withinMin: num.value * factor, source: start.raw + ' ' + num.raw + ' of ' + target.raw }
        }
        // "within 2 days of christmas"
        if (target && target.type === 'TERM' && target.term.kind === 'namedDate' &&
            unitSym && (unitSym.unit === 'day' || unitSym.unit === 'week')) {
            state.pos++
            const term = clone(target.term)
            term.withinDays = num.value * unitSym.factor
            term.source = start.raw + ' ' + num.raw + ' ' + unitSym.raw + ' of ' + target.raw
            return term
        }
        state.unmatched.push(start.raw + ' ' + num.raw)
        return null
    }

    function parseMoonCondition (state) {
        const start = peek(state)
        const cmp = peek(state, 1)
        // azimuth: "moon azimuth is between 60 and 90 degrees"
        if (cmp && cmp.type === 'AZIMUTH') {
            return parseCelestialAzimuth(state, 'moonAzimuth')
        }
        // illumination: "moon more than 50% illuminated"
        if (cmp && (cmp.type === 'MORE' || cmp.type === 'LESS')) {
            const pct = peek(state, 2)
            if (pct && pct.type === 'PERCENT') {
                state.pos += 3
                if (peek(state) && peek(state).type === 'ILLUM') { state.pos++ }
                return {
                    kind: 'moonIllumination',
                    op: cmp.type === 'MORE' ? 'gt' : 'lt',
                    fraction: pct.value / 100,
                    source: start.raw + ' ' + cmp.raw + ' ' + pct.raw
                }
            }
        }
        // bare percentage: "moon is 90% illuminated" reads as AT LEAST 90%
        // (exact equality on a continuous fraction would never match)
        if (cmp && cmp.type === 'PERCENT') {
            state.pos += 2
            if (peek(state) && peek(state).type === 'ILLUM') { state.pos++ }
            return {
                kind: 'moonIllumination',
                op: 'gte',
                fraction: cmp.value / 100,
                source: start.raw + ' ' + cmp.raw + ' illuminated'
            }
        }
        // altitude: "moon between 10 and 20 degrees", "moon above 30 degrees"
        if (cmp && ['BETWEEN', 'ABOVE', 'BELOW', 'MORE', 'LESS'].indexOf(cmp.type) >= 0) {
            return parseCelestialAltitude(state, 'moonAltitude')
        }
        // bare "moon" - be forgiving and treat it as "moon visible"
        state.pos++
        return { kind: 'moonAltitude', op: 'above', degrees: 0, source: start.raw, assumed: true }
    }

    // ------------------------------------------------------------------
    // Coalescing (natural-language set semantics)
    // ------------------------------------------------------------------

    const MUTUALLY_EXCLUSIVE = { day: 'days', month: 'months', dayOfMonth: 'days', year: 'years' }

    // flagged variants ("last day of the month", "last day of the week",
    // "last day of january 2027") carry meaning outside their set arrays and
    // must never set-union with plain terms
    function coalescable (term) {
        return MUTUALLY_EXCLUSIVE[term.kind] && !term.negate && !term.last && !term.weekOrdinal &&
            !term.month && !term.year && !term.firstCount && !term.lastCount && !term.scope
    }

    // Within an AND group, positive same-kind day/month terms union together:
    // "saturday and sunday" means day IN {sat, sun}, never day=sat AND day=sun.
    function coalesceAnd (terms) {
        const out = []
        terms.forEach(function (term) {
            const prop = MUTUALLY_EXCLUSIVE[term.kind]
            if (coalescable(term)) {
                const existing = out.find(function (t) { return t.kind === term.kind && coalescable(t) })
                if (existing) {
                    existing[prop] = uniqSorted(existing[prop].concat(term[prop]))
                    existing.source += ' and ' + term.source
                    if (term.sabbath) { existing.sabbath = true }
                    delete existing.setName
                    return
                }
            }
            out.push(term)
        })
        return out
    }

    // OR groups that are a single positive day/month term merge for a cleaner
    // description ("saturday or sunday" -> one day term). Same semantics.
    function mergeOrGroups (groups) {
        const out = []
        groups.forEach(function (g) {
            if (out.length && g.terms.length === 1) {
                const term = g.terms[0]
                const prop = MUTUALLY_EXCLUSIVE[term.kind]
                const lastGroup = out[out.length - 1]
                if (coalescable(term) && lastGroup.terms.length === 1) {
                    const prev = lastGroup.terms[0]
                    if (prev.kind === term.kind && coalescable(prev)) {
                        prev[prop] = uniqSorted(prev[prop].concat(term[prop]))
                        prev.source += ' or ' + term.source
                        if (term.sabbath) { prev.sabbath = true }
                        delete prev.setName
                        return
                    }
                }
            }
            out.push(g)
        })
        return out
    }

    // ------------------------------------------------------------------
    // Description
    // ------------------------------------------------------------------

    function listJoin (items, joiner) {
        if (items.length <= 1) { return items.join('') }
        return items.slice(0, -1).join(', ') + ' ' + joiner + ' ' + items[items.length - 1]
    }

    // days sorted ascending; if they form one consecutive run (mod 7 allowed)
    // return [start, end], else null
    function consecutiveRun (values, modulo) {
        if (values.length < 3) { return null }
        const set = {}
        values.forEach(function (v) { set[v] = true })
        const lo = modulo ? 0 : 1
        const hi = modulo ? modulo - 1 : 12
        // find a start value whose predecessor is absent
        for (let s = lo; s <= hi; s++) {
            if (!set[s]) { continue }
            const pred = modulo ? ((s + modulo - 1) % modulo) : (s === 1 ? 12 : s - 1)
            if (set[pred] && values.length < (modulo || 12)) { continue }
            // walk forward
            let count = 0
            let v = s
            while (set[v] && count < values.length) {
                count++
                if (count === values.length) {
                    return [s, v]
                }
                v = modulo ? ((v + 1) % modulo) : (v === 12 ? 1 : v + 1)
            }
            return null
        }
        return null
    }

    // order circular values for natural reading: start after the largest gap,
    // so {Sun, Sat} reads "Saturday or Sunday" (the weekend), not "Sunday or Saturday"
    function rotateForDisplay (values, modulo) {
        if (values.length < 2) { return values.slice() }
        const sorted = values.slice().sort(function (a, b) { return a - b })
        let biggestGap = -1
        let startIdx = 0
        for (let i = 0; i < sorted.length; i++) {
            const next = sorted[(i + 1) % sorted.length]
            const gap = ((next - sorted[i]) + modulo) % modulo || modulo
            if (gap > biggestGap) {
                biggestGap = gap
                startIdx = (i + 1) % sorted.length
            }
        }
        return sorted.slice(startIdx).concat(sorted.slice(0, startIdx))
    }

    function fmtMinutes (min) {
        min = ((min % 1440) + 1440) % 1440
        const h = Math.floor(min / 60)
        const m = min % 60
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
    }

    const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh']

    function ordinalNumber (n) { // 8 -> "8th", 22 -> "22nd"
        const mod10 = n % 10
        const mod100 = n % 100
        if (mod10 === 1 && mod100 !== 11) { return n + 'st' }
        if (mod10 === 2 && mod100 !== 12) { return n + 'nd' }
        if (mod10 === 3 && mod100 !== 13) { return n + 'rd' }
        return n + 'th'
    }

    function fmtDuration (minutes) {
        if (minutes % 60 === 0) {
            const h = minutes / 60
            return h + ' hour' + (h === 1 ? '' : 's')
        }
        return minutes + ' minute' + (minutes === 1 ? '' : 's')
    }

    const EVENT_LABELS = {
        sunrise: 'sunrise',
        sunset: 'sunset',
        solarNoon: 'solar noon',
        civilDawn: 'dawn',
        civilDusk: 'dusk'
    }

    function describeTerm (term) {
        let text
        switch (term.kind) {
            case 'always':
                text = 'always'
                break
            case 'day': {
                if (term.weekOrdinal) {
                    // spell the convention out - "last day of the week" is ambiguous
                    // between conventions, so show which day it resolved to
                    const nthText = term.weekOrdinal === 'last' ? 'last' : ORDINAL_WORDS[term.weekOrdinal]
                    text = 'day is ' + DAY_NAMES[term.days[0]] + ' (the ' + nthText + ' day of the week; ISO 8601 weeks start on Monday)'
                } else if (term.setName === 'weekend') {
                    text = 'day is a weekend'
                } else if (term.setName === 'weekday') {
                    text = 'day is a weekday (Monday to Friday)'
                } else {
                    const run = consecutiveRun(term.days, 7)
                    if (run) {
                        text = 'day is ' + DAY_NAMES[run[0]] + ' to ' + DAY_NAMES[run[1]]
                    } else {
                        text = 'day is ' + listJoin(rotateForDisplay(term.days, 7).map(function (d) { return DAY_NAMES[d] }), 'or')
                    }
                }
                if (term.sabbath) { text += ' (sabbath)' }
                break
            }
            case 'nthWeekday': {
                const nthText = term.nth === 'last'
                    ? (term.fromEnd > 1 ? ordinalNumber(term.fromEnd) + ' last' : 'last')
                    : ORDINAL_WORDS[term.nth]
                let scopeText = 'the month'
                if (term.month) {
                    scopeText = MONTH_NAMES[term.month] + (term.year ? ' ' + term.year : '')
                } else if (term.scope === 'year') {
                    scopeText = term.year ? String(term.year) : 'the year'
                }
                text = 'day is the ' + nthText + ' ' + DAY_NAMES[term.day] + ' of ' + scopeText
                break
            }
            case 'year': {
                const years = term.years
                const contiguous = years.length > 2 && years[years.length - 1] - years[0] === years.length - 1
                if (contiguous) {
                    text = 'year is ' + years[0] + ' to ' + years[years.length - 1]
                } else {
                    text = 'year is ' + listJoin(years.map(String), 'or')
                }
                break
            }
            case 'parity': {
                const labels = { day: 'the day of the month', month: 'the month number', year: 'the year' }
                text = labels[term.unit] + ' is ' + term.parity
                break
            }
            case 'month': {
                const run = consecutiveRun(term.months, 0)
                if (run) {
                    text = 'month is ' + MONTH_NAMES[run[0]] + ' to ' + MONTH_NAMES[run[1]]
                } else {
                    text = 'month is ' + listJoin(rotateForDisplay(term.months.map(function (m) { return m - 1 }), 12).map(function (m) { return MONTH_NAMES[m + 1] }), 'or')
                }
                if (term.year) { text += ' ' + term.year }
                break
            }
            case 'dayOfMonth': {
                const scopeText = term.scope === 'year'
                    ? (term.year ? String(term.year) : 'the year')
                    : (term.month ? MONTH_NAMES[term.month] + (term.year ? ' ' + term.year : '') : 'the month')
                if (term.firstCount || term.lastCount) {
                    const count = term.firstCount || term.lastCount
                    text = 'day is in the ' + (term.firstCount ? 'first' : 'last') + ' ' +
                        (count === 1 ? 'day' : count + ' days') + ' of ' + scopeText
                    break
                }
                if (term.last) {
                    const fromEndText = term.lastOffset ? ordinalNumber(term.lastOffset + 1) + ' last' : 'last'
                    text = 'day is the ' + fromEndText + ' day of ' + scopeText
                } else if (term.month) {
                    text = 'date is ' + listJoin(term.days.map(String), 'or') + ' ' + scopeText
                } else {
                    text = 'day of the month is ' + listJoin(term.days.map(String), 'or')
                }
                break
            }
            case 'ordinalWeek': {
                const nthText = term.nth === 'last'
                    ? (term.fromEnd > 1 ? ordinalNumber(term.fromEnd) + ' last' : 'last')
                    : (ORDINAL_WORDS[term.nth] || ordinalNumber(term.nth))
                let scopeText = 'the month'
                if (term.month) {
                    scopeText = MONTH_NAMES[term.month] + (term.year ? ' ' + term.year : '')
                } else if (term.scope === 'year') {
                    scopeText = term.year ? String(term.year) : 'the year'
                }
                text = 'it is the ' + nthText + ' week of ' + scopeText
                break
            }
            case 'namedDate': {
                const baseName = term.day + ' ' + MONTH_NAMES[term.month]
                if (term.withinDays) {
                    text = 'date is within ' + term.withinDays + ' day' + (term.withinDays === 1 ? '' : 's') + ' of ' + baseName + (term.name ? ' (' + term.name + ')' : '')
                    break
                }
                // resolve the offsets to an actual month/day for display (a
                // non-leap reference year; clamped like the evaluator clamps)
                let month = term.month
                let day = term.day
                let year = 2001
                if (term.offsetMonths) {
                    const total = (month - 1) + term.offsetMonths
                    year += Math.floor(total / 12)
                    month = ((total % 12) + 12) % 12 + 1
                    const dim = new Date(Date.UTC(year, month, 0)).getUTCDate()
                    if (day > dim) { day = dim }
                }
                if (term.offsetDays) {
                    const shifted = new Date(Date.UTC(year, month - 1, day) + (term.offsetDays * 86400000))
                    month = shifted.getUTCMonth() + 1
                    day = shifted.getUTCDate()
                }
                text = 'date is ' + day + ' ' + MONTH_NAMES[month] + (term.year ? ' ' + term.year : '') + (term.name ? ' (' + term.name + ')' : '')
                break
            }
            case 'minuteOfHour':
                if (term.style === 'at') {
                    text = 'the minute is ' + term.startMin + ' past the hour (every hour)'
                } else if (term.style === 'before') {
                    text = 'the minute is before ' + term.startMin + ' past the hour (every hour)'
                } else if (term.style === 'after') {
                    text = 'the minute is ' + term.startMin + ' or more past the hour (every hour)'
                } else {
                    text = 'the minute is between ' + term.startMin + ' and ' + term.endMin + ' past the hour (every hour)'
                    if (term.endMin <= term.startMin) { text += ' (wrapping)' }
                }
                break
            case 'timeRange':
                if (term.style === 'before') {
                    text = 'time is before ' + (term.endMin === 1440 ? 'midnight' : fmtMinutes(term.endMin))
                } else if (term.style === 'after') {
                    text = 'time is after ' + fmtMinutes(term.startMin)
                } else if (term.style === 'at') {
                    text = 'time is ' + fmtMinutes(term.startMin)
                } else {
                    text = 'time is between ' + fmtMinutes(term.startMin) + ' and ' + fmtMinutes(term.endMin)
                    if (term.endMin <= term.startMin) { text += ' (overnight)' }
                }
                break
            case 'solarState': {
                const labels = {
                    night: 'night (sun below -18 degrees)',
                    civilTwilight: 'civil twilight',
                    nauticalTwilight: 'nautical twilight',
                    astronomicalTwilight: 'astronomical twilight',
                    twilight: 'twilight',
                    goldenHour: 'golden hour'
                }
                text = 'it is ' + term.states.map(function (s) { return labels[s] || s }).join(' or ')
                if (term.direction === 'rise') {
                    text = term.states[0] === 'twilight' ? 'it is dawn (twilight, sun rising)' : text + ' (sun rising)'
                } else if (term.direction === 'fall') {
                    text = term.states[0] === 'twilight' ? 'it is dusk (twilight, sun setting)' : text + ' (sun setting)'
                }
                break
            }
            case 'sunDirection':
                text = term.direction === 'rise' ? 'the sun is rising (before solar noon)' : 'the sun is setting (after solar noon)'
                break
            case 'sunAltitude':
                if (term.label) {
                    text = 'the sun is ' + term.label + ' (' + (term.op === 'between' ? 'between ' + term.low + ' and ' + term.high : term.op + ' ' + term.degrees) + ' degrees)'
                } else if (term.op === 'between') {
                    text = 'sun altitude is between ' + term.low + ' and ' + term.high + ' degrees'
                } else if (term.op === 'above' && term.degrees === -0.833) {
                    text = 'the sun is up (daylight)'
                } else if (term.op === 'below' && term.degrees === -0.833) {
                    text = 'the sun is down (below the horizon)'
                } else if (term.op === 'below' && term.degrees === -6) {
                    text = 'it is dark (sun below civil twilight)'
                } else {
                    text = 'sun altitude is ' + term.op + ' ' + term.degrees + ' degrees'
                }
                break
            case 'sunAzimuth':
                text = 'sun azimuth is between ' + term.low + ' and ' + term.high + ' degrees'
                break
            case 'solarEvent': {
                const label = EVENT_LABELS[term.event] || term.event
                if (term.op === 'within') {
                    text = 'within ' + term.withinMin + ' minutes of ' + label
                } else if (term.offsetMin) {
                    text = 'more than ' + fmtDuration(term.offsetMin) + ' ' + term.op + ' ' + label
                } else {
                    text = term.op + ' ' + label
                }
                break
            }
            case 'solarBetween': {
                const fromText = typeof term.fromTime === 'number' ? fmtMinutes(term.fromTime) : (EVENT_LABELS[term.from] || term.from)
                const toText = typeof term.toTime === 'number' ? fmtMinutes(term.toTime) : (EVENT_LABELS[term.to] || term.to)
                text = 'between ' + fromText + ' and ' + toText
                break
            }
            case 'moonAltitude':
                if (term.label) {
                    text = 'the moon is ' + term.label + ' (' + (term.op === 'between' ? 'between ' + term.low + ' and ' + term.high : term.op + ' ' + term.degrees) + ' degrees)'
                } else if (term.op === 'between') {
                    text = 'moon altitude is between ' + term.low + ' and ' + term.high + ' degrees'
                } else if (term.op === 'above' && term.degrees === 0) {
                    text = 'the moon is above the horizon (visible)'
                } else {
                    text = 'moon altitude is ' + term.op + ' ' + term.degrees + ' degrees'
                }
                break
            case 'moonAzimuth':
                text = 'moon azimuth is between ' + term.low + ' and ' + term.high + ' degrees'
                break
            case 'moonPhase': {
                if (term.offsetDays) { // "day before blue moon", "2 days after a full moon"
                    const nouns = {
                        full: 'a full moon',
                        blue: 'a blue moon (the second full moon of a calendar month)',
                        seasonalBlue: 'a seasonal blue moon',
                        new: 'a new moon',
                        firstQuarter: 'a first-quarter moon',
                        lastQuarter: 'a last-quarter moon',
                        waxing: 'a waxing moon',
                        waning: 'a waning moon'
                    }
                    const magnitude = Math.abs(term.offsetDays)
                    text = 'it is ' + (magnitude === 1 ? 'the day' : magnitude + ' days') + ' ' +
                        (term.offsetDays > 0 ? 'after' : 'before') + ' ' + (nouns[term.phase] || term.phase)
                    break
                }
                const phases = {
                    full: 'full (within about a day)',
                    blue: 'a blue moon (the second full moon of a calendar month)',
                    seasonalBlue: 'a seasonal blue moon (the third full moon in an astronomical season of four)',
                    new: 'new (within about a day)',
                    firstQuarter: 'at first quarter (within about a day)',
                    lastQuarter: 'at last quarter (within about a day)',
                    waxing: 'waxing',
                    waning: 'waning'
                }
                text = 'the moon is ' + (phases[term.phase] || term.phase)
                break
            }
            case 'moonIllumination': {
                const opWords = { gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most' }
                text = 'the moon is ' + (opWords[term.op] || term.op) + ' ' + (Math.round(term.fraction * 1000) / 10) + '% illuminated'
                break
            }
            default:
                text = term.source || term.kind
        }
        if (term.negate) {
            // phrase negation naturally where easy, else prefix
            if (text.indexOf(' is ') >= 0) {
                text = text.replace(' is ', ' is not ')
            } else {
                text = 'not (' + text + ')'
            }
        }
        return text
    }

    // identity of a term for description factoring, ignoring cosmetic fields
    function termKey (term) {
        const keys = Object.keys(term).filter(function (k) { return k !== 'source' && k !== 'distributed' }).sort()
        return JSON.stringify(keys.map(function (k) { return [k, term[k]] }))
    }

    // The description must make the (already-distributed) grouping unmistakable:
    // - clauses shared by EVERY alternative are factored out: "(A, or B) and C"
    //   (this covers "except" terms and bracketed input like "(A or B) and C")
    // - a multi-clause alternative among several is bracketed:
    //   "A, or (B and C)" - so the and-binds-tighter precedence is visible
    function describe (ast) {
        if (!ast || !ast.groups || !ast.groups.length) { return '' }
        let groups = ast.groups
        const factored = []
        if (groups.length > 1) {
            const commonKeys = groups[0].terms
                .filter(function (t) {
                    const key = termKey(t)
                    return groups.every(function (g) {
                        return g.terms.some(function (t2) { return termKey(t2) === key })
                    })
                })
                .map(termKey)
            if (commonKeys.length) {
                groups[0].terms.forEach(function (t) {
                    if (commonKeys.indexOf(termKey(t)) >= 0) {
                        const d = describeTerm(t)
                        if (factored.indexOf(d) < 0) { factored.push(d) }
                    }
                })
                groups = groups.map(function (g) {
                    const seen = []
                    return {
                        type: 'and',
                        terms: g.terms.filter(function (t) {
                            const key = termKey(t)
                            // drop each common term once per group (keep duplicates)
                            if (commonKeys.indexOf(key) >= 0 && seen.indexOf(key) < 0) {
                                seen.push(key)
                                return false
                            }
                            return true
                        })
                    }
                })
            }
        }
        const groupTexts = groups.map(function (g) {
            const parts = g.terms.map(describeTerm)
            let text = parts.join(' and ')
            if (groups.length > 1 && parts.length > 1) { text = '(' + text + ')' }
            return text
        }).filter(function (t) { return t.length > 0 })
        let text = groupTexts.join(', or ')
        if (factored.length) {
            if (groupTexts.length > 1) { text = '(' + text + ')' }
            text = (text ? text + ' and ' : '') + factored.join(' and ')
        }
        return text
    }

    // categorised breakdown of an AST for the editor's details popout: one entry
    // per OR-alternative, each with { category, text, negate, requiresLocation }
    // facets so the UI can show the day(s)/month(s)/year(s)/time(s) at a glance
    const FACET_CATEGORIES = {
        always: 'Always',
        day: 'Days',
        nthWeekday: 'Days',
        dayOfMonth: 'Dates',
        namedDate: 'Dates',
        ordinalWeek: 'Dates',
        month: 'Months',
        year: 'Years',
        timeRange: 'Times',
        minuteOfHour: 'Times',
        solarState: 'Sun',
        sunDirection: 'Sun',
        sunAltitude: 'Sun',
        sunAzimuth: 'Sun',
        solarEvent: 'Sun',
        solarBetween: 'Sun',
        moonAltitude: 'Moon',
        moonAzimuth: 'Moon',
        moonPhase: 'Moon',
        moonIllumination: 'Moon'
    }

    function summarize (ast) {
        if (!ast || !ast.groups) { return [] }
        return ast.groups.map(function (g) {
            const facets = g.terms.map(function (t) {
                let category = FACET_CATEGORIES[t.kind] || 'Other'
                if (t.kind === 'parity') {
                    category = t.unit === 'year' ? 'Years' : (t.unit === 'month' ? 'Months' : 'Dates')
                }
                return {
                    category,
                    text: describeTerm(t),
                    negate: !!t.negate,
                    requiresLocation: LOCATION_KINDS.indexOf(t.kind) >= 0
                }
            })
            return { facets }
        })
    }

    // ------------------------------------------------------------------
    // Failure suggestions: when input is not understood, offer the nearest
    // known-good examples instead of a generic hint. Every entry MUST parse
    // cleanly - a test sweeps the corpus to keep that true.
    // ------------------------------------------------------------------

    const SUGGESTION_EXAMPLES = [
        // days
        'on saturdays', 'weekdays', 'weekends', 'monday to friday', 'not on tuesday', '2 days before friday',
        // ordinals
        'first monday of the month', '3rd tuesday of the month', 'last friday of the month',
        '2nd last friday of the month', 'last day of the month', '2nd last day of the month',
        'first day of the week', 'last day of the week', 'first week of the month', 'last week of 2027',
        'last month of the year', 'first monday of january', 'last day of jan', 'first day of the year',
        'last day of the year', 'last 2 days of the month', 'first 3 days of march', 'last 5 days of the year',
        // months, years, parity
        'in december', 'june to august', 'january 2027', '2027 to 2029', 'on even years', 'when day is odd',
        'on the 1st of the month',
        // dates
        'christmas day', 'christmas eve', 'day before christmas', '4 days after christmas',
        'within 2 days of christmas', 'new years day',
        // clock times
        'between 9am and 5pm', '10pm to 6am', 'before noon', 'after 10pm', 'until 6pm',
        'quarter past five', 'ten past', 'between 15 minutes and 30 minutes past the hour', '2 hours before noon',
        // sun
        'is night', 'during daylight', 'after dark', 'golden hour', 'sun rising', 'after sunset',
        'before sunrise', '2 hours after sunset', 'within 30 minutes of sunrise', 'between sunset and sunrise',
        'sun above 30 degrees', 'sun is between 10 and 12 degrees', 'sun is high',
        'sun azimuth is between 134 and 138 degrees',
        // moon
        'when the moon is visible', 'full moon', 'blue moon', 'seasonal blue moon', 'day before blue moon',
        'moon is high', 'moon is 90% illuminated', 'moon more than 50% illuminated', 'new moon',
        'moon azimuth is between 60 and 90 degrees',
        // combinations
        'on weekdays and during daylight', 'on weekends or after sunset', 'weekends or evenings except tuesday',
        '(last day of the month or wednesday) and after 10pm', 'every day'
    ]

    // connective words carry no topical signal for matching
    const SUGGESTION_STOP_WORDS = ['and', 'or', 'not', 'but', 'except', 'to']

    function significantWords (text) {
        const words = []
        String(text || '').toLowerCase().split(/[^a-z0-9%:]+/).forEach(function (raw) {
            let word = raw
            if (!word) { return }
            if (/^[a-z]+$/.test(word)) { word = stripPlural(word) }
            if (NOISE_WORDS.indexOf(word) >= 0 || SUGGESTION_STOP_WORDS.indexOf(word) >= 0) { return }
            if (words.indexOf(word) < 0) { words.push(word) }
        })
        return words
    }

    let suggestionIndex = null
    function suggestExamples (text) {
        if (!suggestionIndex) {
            suggestionIndex = SUGGESTION_EXAMPLES.map(function (example) {
                return { text: example, words: significantWords(example) }
            })
        }
        const inputWords = significantWords(text)
        if (!inputWords.length) { return [] }
        const scored = []
        suggestionIndex.forEach(function (example) {
            let score = 0
            inputWords.forEach(function (word) {
                if (example.words.indexOf(word) >= 0) {
                    score += 2 // exact word overlap
                } else if (word.length >= 4) {
                    for (let i = 0; i < example.words.length; i++) {
                        if (example.words[i].length >= 4 && editDistanceLE1(word, example.words[i]) <= 1) {
                            score += 1 // near-miss (typo) overlap
                            break
                        }
                    }
                }
            })
            // one exact word normally required; a lone typo'd word may qualify
            // on its fuzzy match alone
            if (score >= 2 || (score >= 1 && inputWords.length === 1)) { scored.push({ example, score }) }
        })
        // best score first; prefer the shorter example on ties (easier to adapt)
        scored.sort(function (a, b) { return (b.score - a.score) || (a.example.words.length - b.example.words.length) })
        return scored.slice(0, 3).map(function (entry) { return entry.example.text })
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    function parse (text) {
        const warnings = []
        const trimmed = String(text || '').trim()
        if (!trimmed) {
            return { ok: false, ast: null, description: '', unmatched: [], warnings, suggestions: [], suggestion: suggestionText('', []) }
        }
        const tokens = tokenize(trimmed)
        const matched = matchSymbols(tokens, warnings)
        promoteSunWords(matched.symbols, matched.unmatched)
        const ast = parseSymbols(matched.symbols, matched.unmatched, warnings)
        const unmatched = matched.unmatched
        const hasTerms = ast.groups.some(function (g) { return g.terms.length > 0 })
        if (!hasTerms) {
            const suggestions = suggestExamples(trimmed)
            return { ok: false, ast: null, description: '', unmatched, warnings, suggestions, suggestion: suggestionText(trimmed, suggestions) }
        }
        unmatched.forEach(function (u) { warnings.push('Ignored: \'' + u + '\'') })
        return { ok: true, ast, description: describe(ast), unmatched, warnings, suggestions: [], suggestion: '' }
    }

    function suggestionText (text, suggestions) {
        const quoted = text ? 'Did not understand \'' + text + '\'. ' : ''
        if (suggestions && suggestions.length) {
            return quoted + 'Did you mean \'' + suggestions.join('\', \'') + '\'?'
        }
        return quoted + 'Try phrases like \'weekdays between 9am and 5pm\', \'after sunset\', or \'when the moon is visible\'.'
    }

    function requiresLocation (ast) {
        if (!ast || !ast.groups) { return false }
        return ast.groups.some(function (g) {
            return g.terms.some(function (t) { return LOCATION_KINDS.indexOf(t.kind) >= 0 })
        })
    }

    // ------------------------------------------------------------------
    // utils
    // ------------------------------------------------------------------

    function clone (obj) {
        return JSON.parse(JSON.stringify(obj))
    }

    function uniqSorted (arr) {
        return arr.filter(function (v, i) { return arr.indexOf(v) === i }).sort(function (a, b) { return a - b })
    }

    return {
        parse,
        describe,
        summarize,
        requiresLocation,
        LOCATION_KINDS,
        _internal: {
            tokenize,
            matchSymbols,
            suggestExamples,
            SUGGESTION_EXAMPLES,
            editDistanceLE1,
            fuzzyLookup,
            toMinutes,
            consecutiveRun,
            DAY_WORDS,
            DAY_SETS,
            MONTH_WORDS,
            NOISE_WORDS,
            PHRASES
        }
    }
}))
