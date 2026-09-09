/* Evaluator for the cronplus-when-gate condition AST (see resources/when-gate-lang.js).
   Node.js only - this is where suncalc comes in; the parser stays dependency-free
   so it can also run in the editor.

   evaluate(ast, { ts, lat, lon, tz }) => { pass, reasons }
     ts  - epoch milliseconds to evaluate at
     lat/lon - optional; required only when the AST contains sun/moon terms
     tz  - optional IANA timezone for day/time/month terms (default: system)
   Terms that cannot be computed (missing location, invalid timezone, a solar
   event that does not occur at polar latitudes) evaluate to pass:false with an
   explanatory detail - they never throw. */
'use strict'
const SunCalc = require('suncalc')
// published packages ship only the minified parser; dev checkouts prefer source
let whenGateLang
try {
    whenGateLang = require('../resources/when-gate-lang.js')
} catch (_e) {
    whenGateLang = require('../resources/when-gate-lang.min.js')
}

const DAY_MS = 86400000
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function daysInMonth (year, month) { // month 1-12
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function daysInYear (year) {
    return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS
}

function dayOfYear (parts) { // from getLocalParts output, 1-based
    return ((Date.UTC(parts.year, parts.month - 1, parts.dayOfMonth) - Date.UTC(parts.year, 0, 1)) / DAY_MS) + 1
}

// KEEP IN SYNC with getSunTimes in cronplus.js (~line 594): the same alias map
// from the legacy cron-plus event IDs onto the suncalc v2 names. Duplicated here
// because cronplus.js keeps its helpers module-private. Angles are degrees.
function getSunTimes (date, lat, lng) {
    const times = SunCalc.getTimes(date, lat, lng)
    times.civilDawn = times.dawn
    times.civilDusk = times.dusk
    times.morningGoldenHourEnd = times.goldenHourEnd
    times.eveningGoldenHourStart = times.goldenHour
    times.nightStart = times.night
    return times
}

// tz-aware local calendar parts without a date library. hourCycle h23 avoids
// the "24:00" midnight quirk of hour12:false. Throws RangeError on a bad tz.
// Formatters are cached per timezone - constructing Intl.DateTimeFormat is by
// far the most expensive step and the preview scan calls this thousands of times.
const formatterCache = new Map()
function getFormatter (tz) {
    const key = tz || ' system'
    let formatter = formatterCache.get(key)
    if (!formatter) {
        const opts = {
            weekday: 'short',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hourCycle: 'h23'
        }
        if (tz) { opts.timeZone = tz }
        formatter = new Intl.DateTimeFormat('en-US', opts)
        formatterCache.set(key, formatter)
    }
    return formatter
}

function getLocalParts (ts, tz) {
    const parts = getFormatter(tz).formatToParts(new Date(ts))
    const map = {}
    parts.forEach(function (p) { map[p.type] = p.value })
    const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return {
        weekday: weekdays[map.weekday],
        year: parseInt(map.year),
        month: parseInt(map.month),
        dayOfMonth: parseInt(map.day),
        hour: parseInt(map.hour),
        minute: parseInt(map.minute)
    }
}

function localDateKey (ts, tz) {
    const p = getLocalParts(ts, tz)
    return p.year + '-' + p.month + '-' + p.dayOfMonth
}

function sunAltitude (ts, lat, lon) {
    return SunCalc.getPosition(new Date(ts), lat, lon).altitude // degrees (suncalc v2)
}

function sunAzimuth (ts, lat, lon) {
    return SunCalc.getPosition(new Date(ts), lat, lon).azimuth // degrees, compass bearing from North (suncalc v2)
}

function sunDirection (ts, lat, lon) {
    return sunAltitude(ts + 60000, lat, lon) > sunAltitude(ts, lat, lon) ? 'rise' : 'fall'
}

// azimuth is a compass bearing (0-360, wraps at North) - "between 350 and 10"
// spans through 360/0, so a plain low <= az <= high check only works when the
// range doesn't cross north; low > high signals a wrapping range instead
function inAzimuthRange (az, low, high) {
    return low <= high ? (az >= low && az <= high) : (az >= low || az <= high)
}

// solar states by sun-altitude thresholds (polar safe - no event scanning):
// night <= -18 < astronomical <= -12 < nautical <= -6 < civil <= -0.833 < day.
// Composites: twilight spans (-18, -0.833], goldenHour spans (-6, 6].
function solarStateMatch (state, altDeg) {
    switch (state) {
        case 'night': return altDeg <= -18
        case 'astronomicalTwilight': return altDeg > -18 && altDeg <= -12
        case 'nauticalTwilight': return altDeg > -12 && altDeg <= -6
        case 'civilTwilight': return altDeg > -6 && altDeg <= -0.833
        case 'twilight': return altDeg > -18 && altDeg <= -0.833
        case 'goldenHour': return altDeg > -6 && altDeg <= 6
        case 'day': return altDeg > -0.833
        default: return false
    }
}

// all occurrences of a solar event over the local dates around ts (±1 day),
// as [{ time, dateKey }] sorted ascending. Non-occurring days are skipped.
function eventOccurrences (event, ts, lat, lon, tz) {
    const out = []
    for (let d = -1; d <= 1; d++) {
        const t = getSunTimes(new Date(ts + (d * DAY_MS)), lat, lon)[event]
        if (t && !isNaN(t.valueOf())) {
            out.push({ time: t.valueOf(), dateKey: localDateKey(t.valueOf(), tz) })
        }
    }
    out.sort(function (a, b) { return a.time - b.time })
    // de-dup (adjacent scan days can return the same instant)
    return out.filter(function (o, i) { return i === 0 || o.time !== out[i - 1].time })
}

// instant of the full-moon peak nearest to ts (hourly scan, +/-36h). Only used
// for blue-moon checks, and only when the instant is already near a full moon.
function fullMoonPeakNear (ts) {
    let best = ts
    let bestDist = Math.abs(SunCalc.getMoonIllumination(new Date(ts)).phase - 0.5)
    for (let t = ts - (36 * 3600000); t <= ts + (36 * 3600000); t += 3600000) {
        const dist = Math.abs(SunCalc.getMoonIllumination(new Date(t)).phase - 0.5)
        if (dist < bestDist) {
            bestDist = dist
            best = t
        }
    }
    return best
}

const SYNODIC_MS = Math.round(29.530588 * DAY_MS)

// ---------------------------------------------------------------------------
// Equinox/solstice instants (Meeus, Astronomical Algorithms ch. 27, valid
// 1000-3000 AD, accurate to about a minute - suncalc has no equivalent).
// Used only for the seasonal blue moon ("third full moon in a season of four").
// ---------------------------------------------------------------------------
const MEEUS_SEASON_TERMS = [
    [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186],
    [182, 27.85, 445267.112], [156, 73.14, 45036.886], [136, 171.52, 22518.443],
    [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513],
    [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
    [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417],
    [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029],
    [14, 199.76, 31436.921], [12, 95.39, 14577.848], [12, 287.11, 31931.756],
    [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074]
]
// mean-instant polynomial coefficients per season (March, June, September, December)
const MEEUS_JDE0 = [
    [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
    [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
    [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
    [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032]
]

const RAD = Math.PI / 180

// epoch ms (UTC) of the given year's equinox/solstice; season 0=Mar,1=Jun,2=Sep,3=Dec
function seasonInstant (year, season) {
    const y = (year - 2000) / 1000
    const c = MEEUS_JDE0[season]
    const jde0 = c[0] + (c[1] * y) + (c[2] * y * y) + (c[3] * y * y * y) + (c[4] * y * y * y * y)
    const t = (jde0 - 2451545.0) / 36525
    const w = ((35999.373 * t) - 2.47) * RAD
    const deltaLambda = 1 + (0.0334 * Math.cos(w)) + (0.0007 * Math.cos(2 * w))
    let s = 0
    for (let i = 0; i < MEEUS_SEASON_TERMS.length; i++) {
        const term = MEEUS_SEASON_TERMS[i]
        s += term[0] * Math.cos((term[1] + (term[2] * t)) * RAD)
    }
    const jde = jde0 + ((0.00001 * s) / deltaLambda)
    // TT vs UTC differs by ~70s in this era - irrelevant at full-moon-peak resolution
    return (jde - 2440587.5) * DAY_MS
}

// is the full moon peaking at peakTs the third of four in its astronomical season?
// Small cache: every scan sample inside one full-moon window resolves the same peak.
const seasonalBlueCache = new Map()
function isSeasonalBlueMoon (peakTs) {
    const cacheKey = Math.round(peakTs / 3600000)
    if (seasonalBlueCache.has(cacheKey)) { return seasonalBlueCache.get(cacheKey) }
    // season boundaries around the peak (spans year ends, so compute neighbours too)
    const year = new Date(peakTs).getUTCFullYear()
    const boundaries = []
    for (let y = year - 1; y <= year + 1; y++) {
        for (let season = 0; season < 4; season++) { boundaries.push(seasonInstant(y, season)) }
    }
    boundaries.sort(function (a, b) { return a - b })
    let start = null
    let end = null
    for (let i = 0; i < boundaries.length - 1; i++) {
        if (peakTs >= boundaries[i] && peakTs < boundaries[i + 1]) {
            start = boundaries[i]
            end = boundaries[i + 1]
            break
        }
    }
    let result = false
    if (start !== null) {
        // enumerate the season's full moons by hopping synodically outward from
        // the KNOWN peak (fullMoonPeakNear only refines near an actual full moon)
        const peaks = [peakTs]
        let p = fullMoonPeakNear(peakTs - SYNODIC_MS)
        while (p >= start) {
            peaks.unshift(p)
            p = fullMoonPeakNear(p - SYNODIC_MS)
        }
        p = fullMoonPeakNear(peakTs + SYNODIC_MS)
        while (p < end) {
            peaks.push(p)
            p = fullMoonPeakNear(p + SYNODIC_MS)
        }
        result = peaks.length === 4 && peaks.indexOf(peakTs) === 2 // the third of four
    }
    if (seasonalBlueCache.size > 100) { seasonalBlueCache.clear() }
    seasonalBlueCache.set(cacheKey, result)
    return result
}

// epoch ms of the given local wall-clock time (minutes past midnight) on the
// local calendar date of the reference year/month/day, in tz. Inverse of
// getLocalParts, found by guess-and-correct (two passes cover DST shifts).
function epochForLocal (year, month, dayOfMonth, minutes, tz) {
    let guess = Date.UTC(year, month - 1, dayOfMonth, Math.floor(minutes / 60), minutes % 60)
    for (let i = 0; i < 2; i++) {
        const p = getLocalParts(guess, tz)
        const deltaMin = ((Date.UTC(p.year, p.month - 1, p.dayOfMonth) - Date.UTC(year, month - 1, dayOfMonth)) / 60000) +
            (((p.hour * 60) + p.minute) - minutes)
        if (!deltaMin) { break }
        guess -= deltaMin * 60000
    }
    return guess
}

// the instants at which the local clock reads `minutes` on the days around ts
function clockOccurrences (minutes, ts, tz) {
    const out = []
    for (let d = -1; d <= 1; d++) {
        const p = getLocalParts(ts + (d * DAY_MS), tz)
        out.push(epochForLocal(p.year, p.month, p.dayOfMonth, minutes, tz))
    }
    out.sort(function (a, b) { return a - b })
    return out.filter(function (t, i) { return i === 0 || t !== out[i - 1] })
}

function fmtDetailTime (ts, tz) {
    try {
        return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined })
    } catch (_e) {
        return new Date(ts).toISOString()
    }
}

// evaluate one term (negate NOT applied here). Returns { pass, detail }
function evalTerm (term, ctx) {
    const { ts, lat, lon, tz } = ctx
    switch (term.kind) {
        case 'always':
            return { pass: true, detail: 'always passes' }
        case 'day': {
            const p = getLocalParts(ts, tz)
            return { pass: term.days.indexOf(p.weekday) >= 0, detail: 'local day is ' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][p.weekday] }
        }
        case 'month': {
            const p = getLocalParts(ts, tz)
            if (term.year && p.year !== term.year) {
                return { pass: false, detail: 'local year is ' + p.year }
            }
            return { pass: term.months.indexOf(p.month) >= 0, detail: 'local month is ' + p.month }
        }
        case 'dayOfMonth': {
            const p = getLocalParts(ts, tz)
            if (term.year && p.year !== term.year) {
                return { pass: false, detail: 'local year is ' + p.year }
            }
            if (term.month && p.month !== term.month) {
                return { pass: false, detail: 'local month is ' + p.month }
            }
            // "first/last N days of <month|year>"
            if (term.firstCount || term.lastCount) {
                let pass
                if (term.scope === 'year') {
                    const doy = dayOfYear(p)
                    pass = term.firstCount ? doy <= term.firstCount : doy > daysInYear(p.year) - term.lastCount
                    return { pass, detail: 'local day is number ' + doy + ' of the year' }
                }
                const dim = daysInMonth(p.year, p.month)
                pass = term.firstCount ? p.dayOfMonth <= term.firstCount : p.dayOfMonth > dim - term.lastCount
                return { pass, detail: 'local day of month is ' + p.dayOfMonth + ' (month has ' + dim + ' days)' }
            }
            if (term.last) {
                const dim = daysInMonth(p.year, p.month)
                return { pass: p.dayOfMonth === dim - (term.lastOffset || 0), detail: 'local day of month is ' + p.dayOfMonth + ' (month has ' + dim + ' days)' }
            }
            return { pass: term.days.indexOf(p.dayOfMonth) >= 0, detail: 'local day of month is ' + p.dayOfMonth }
        }
        case 'ordinalWeek': {
            const p = getLocalParts(ts, tz)
            if (term.year && p.year !== term.year) {
                return { pass: false, detail: 'local year is ' + p.year }
            }
            if (term.month && p.month !== term.month) {
                return { pass: false, detail: 'local month is ' + p.month }
            }
            let pass
            const fromEnd = term.fromEnd || 1
            if (term.scope === 'year') {
                const doy = dayOfYear(p)
                const diy = daysInYear(p.year)
                pass = term.nth === 'last'
                    ? (doy > diy - (7 * fromEnd) && doy <= diy - (7 * (fromEnd - 1)))
                    : Math.ceil(doy / 7) === term.nth
                return { pass, detail: 'local day is number ' + doy + ' of the year (week ' + Math.ceil(doy / 7) + ')' }
            }
            const dim = daysInMonth(p.year, p.month)
            pass = term.nth === 'last'
                ? (p.dayOfMonth > dim - (7 * fromEnd) && p.dayOfMonth <= dim - (7 * (fromEnd - 1)))
                : Math.ceil(p.dayOfMonth / 7) === term.nth
            return { pass, detail: 'local day of month is ' + p.dayOfMonth + ' (week ' + Math.ceil(p.dayOfMonth / 7) + ')' }
        }
        case 'nthWeekday': {
            const p = getLocalParts(ts, tz)
            if (term.year && p.year !== term.year) {
                return { pass: false, detail: 'local year is ' + p.year }
            }
            if (term.month && p.month !== term.month) {
                return { pass: false, detail: 'local month is ' + p.month }
            }
            if (p.weekday !== term.day) {
                return { pass: false, detail: 'local day is ' + DAY_NAMES[p.weekday] }
            }
            let pass
            const fromEnd = term.fromEnd || 1 // "2nd last friday" counts from the end
            if (term.scope === 'year') {
                const doy = dayOfYear(p)
                if (term.nth === 'last') {
                    const diy = daysInYear(p.year)
                    pass = doy > diy - (7 * fromEnd) && doy <= diy - (7 * (fromEnd - 1))
                } else {
                    pass = Math.ceil(doy / 7) === term.nth
                }
                return { pass, detail: 'local day is ' + DAY_NAMES[p.weekday] + ' number ' + Math.ceil(doy / 7) + ' of the year' }
            }
            if (term.nth === 'last') {
                const dim = daysInMonth(p.year, p.month)
                pass = p.dayOfMonth > dim - (7 * fromEnd) && p.dayOfMonth <= dim - (7 * (fromEnd - 1))
            } else {
                pass = Math.ceil(p.dayOfMonth / 7) === term.nth
            }
            return { pass, detail: 'local day is ' + DAY_NAMES[p.weekday] + ' number ' + Math.ceil(p.dayOfMonth / 7) + ' of the month' }
        }
        case 'year': {
            const p = getLocalParts(ts, tz)
            if (term.op) {
                const pass = term.op === 'before' ? p.year < term.boundary : p.year > term.boundary
                return { pass, detail: 'local year is ' + p.year }
            }
            return { pass: term.years.indexOf(p.year) >= 0, detail: 'local year is ' + p.year }
        }
        case 'parity': {
            const p = getLocalParts(ts, tz)
            const value = term.unit === 'year' ? p.year : (term.unit === 'month' ? p.month : p.dayOfMonth)
            const isEven = value % 2 === 0
            const pass = term.parity === 'even' ? isEven : !isEven
            return { pass, detail: 'local ' + (term.unit === 'day' ? 'day of month' : term.unit) + ' is ' + value + ' (' + (isEven ? 'even' : 'odd') + ')' }
        }
        case 'namedDate': {
            // offsets are calendar arithmetic on the anniversary for the local
            // year (and neighbours, so offsets that wrap a year boundary work,
            // e.g. new years eve). Pure UTC-date maths - no DST involvement.
            const p = getLocalParts(ts, tz)
            const local = Date.UTC(p.year, p.month - 1, p.dayOfMonth)
            const fromYear = term.year || (p.year - 1)
            const toYear = term.year || (p.year + 1)
            for (let y = fromYear; y <= toYear; y++) {
                let year = y
                let month = term.month
                let day = term.day
                if (term.offsetMonths) {
                    const total = (month - 1) + term.offsetMonths
                    year = y + Math.floor(total / 12)
                    month = ((total % 12) + 12) % 12 + 1
                    const dim = daysInMonth(year, month)
                    if (day > dim) { day = dim } // e.g. 1 month after 31 Oct -> 30 Nov
                }
                let target = Date.UTC(year, month - 1, day)
                if (term.offsetDays) { target += term.offsetDays * DAY_MS }
                if (term.withinDays) {
                    if (Math.abs(target - local) <= term.withinDays * DAY_MS) {
                        return { pass: true, detail: 'local date is ' + p.dayOfMonth + '/' + p.month }
                    }
                } else if (target === local) {
                    return { pass: true, detail: 'local date is ' + p.dayOfMonth + '/' + p.month }
                }
            }
            return { pass: false, detail: 'local date is ' + p.dayOfMonth + '/' + p.month }
        }
        case 'minuteOfHour': {
            const p = getLocalParts(ts, tz)
            const detail = 'minute of the hour is ' + p.minute
            if (term.style === 'at') { return { pass: p.minute === term.startMin, detail } }
            if (term.style === 'before') { return { pass: p.minute < term.startMin, detail } }
            if (term.style === 'after') { return { pass: p.minute >= term.startMin, detail } }
            if (term.endMin <= term.startMin) { // wrapping, e.g. between 50 and 10 past
                return { pass: p.minute >= term.startMin || p.minute < term.endMin, detail }
            }
            return { pass: p.minute >= term.startMin && p.minute < term.endMin, detail }
        }
        case 'timeRange': {
            const p = getLocalParts(ts, tz)
            const t = (p.hour * 60) + p.minute
            const detail = 'local time is ' + fmtDetailTime(ts, tz)
            if (term.style === 'before') { return { pass: t < term.endMin, detail } }
            if (term.style === 'after') { return { pass: t >= term.startMin, detail } }
            if (term.style === 'at') { return { pass: t === term.startMin, detail } }
            if (term.endMin <= term.startMin) { // overnight, e.g. 22:00-06:00
                return { pass: t >= term.startMin || t < term.endMin, detail }
            }
            return { pass: t >= term.startMin && t < term.endMin, detail }
        }
        case 'sunAltitude': {
            const alt = sunAltitude(ts, lat, lon)
            let pass
            if (term.op === 'between') {
                pass = alt >= term.low && alt <= term.high
            } else {
                pass = term.op === 'above' ? alt > term.degrees : alt <= term.degrees
            }
            return { pass, detail: 'sun altitude is ' + alt.toFixed(1) + ' degrees' }
        }
        case 'sunAzimuth': {
            const az = sunAzimuth(ts, lat, lon)
            return { pass: inAzimuthRange(az, term.low, term.high), detail: 'sun azimuth is ' + az.toFixed(1) + ' degrees' }
        }
        case 'solarState': {
            const alt = sunAltitude(ts, lat, lon)
            let pass = term.states.some(function (s) { return solarStateMatch(s, alt) })
            let detail = 'sun altitude is ' + alt.toFixed(1) + ' degrees'
            if (pass && term.direction) {
                const dir = sunDirection(ts, lat, lon)
                pass = dir === term.direction
                detail += ', sun is ' + (dir === 'rise' ? 'rising' : 'setting')
            }
            return { pass, detail }
        }
        case 'sunDirection': {
            const dir = sunDirection(ts, lat, lon)
            return { pass: dir === term.direction, detail: 'sun is ' + (dir === 'rise' ? 'rising (before solar noon)' : 'setting (after solar noon)') }
        }
        case 'solarEvent': {
            const occ = eventOccurrences(term.event, ts, lat, lon, tz)
            if (term.op === 'within') {
                if (!occ.length) {
                    return { pass: false, detail: term.event + ' does not occur around this date at this location' }
                }
                const nearest = occ.reduce(function (best, o) {
                    return Math.abs(o.time - ts) < Math.abs(best.time - ts) ? o : best
                })
                const diffMin = Math.abs(nearest.time - ts) / 60000
                return {
                    pass: diffMin <= term.withinMin,
                    detail: 'nearest ' + term.event + ' is ' + fmtDetailTime(nearest.time, tz) + ' (' + Math.round(diffMin) + ' min away)'
                }
            }
            // before/after: the occurrence on ts's local calendar date
            const todayKey = localDateKey(ts, tz)
            const today = occ.find(function (o) { return o.dateKey === todayKey })
            if (!today) {
                return { pass: false, detail: term.event + ' does not occur on this date at this location' }
            }
            // an offset shifts the boundary: "2 hours after sunset" starts passing
            // at sunset+2h; "30 minutes before sunrise" stops passing at sunrise-30m
            const boundary = today.time + ((term.offsetMin || 0) * 60000 * (term.op === 'after' ? 1 : -1))
            const pass = term.op === 'before' ? ts < boundary : ts >= boundary
            return { pass, detail: term.event + ' today is ' + fmtDetailTime(today.time, tz) + '; now is ' + fmtDetailTime(ts, tz) }
        }
        case 'solarBetween': {
            // inside the current from->to cycle: most recent `from` at or before ts,
            // then pass while ts is earlier than the next `to` after that `from`.
            // Either endpoint may be a solar event or a local clock time
            // ("10pm to sunrise", "sunrise until 6pm").
            const fromIsClock = typeof term.fromTime === 'number'
            const toIsClock = typeof term.toTime === 'number'
            const hhmm = function (minutes) { return ('0' + Math.floor(minutes / 60)).slice(-2) + ':' + ('0' + (minutes % 60)).slice(-2) }
            const fromName = fromIsClock ? hhmm(term.fromTime) : term.from
            const toName = toIsClock ? hhmm(term.toTime) : term.to
            const occurrencesOf = function (isClock, minutes, event, aroundTs) {
                return isClock
                    ? clockOccurrences(minutes, aroundTs, tz)
                    : eventOccurrences(event, aroundTs, lat, lon, tz).map(function (o) { return o.time })
            }
            const fromOcc = occurrencesOf(fromIsClock, term.fromTime, term.from, ts).filter(function (t) { return t <= ts })
            if (!fromOcc.length) {
                return { pass: false, detail: 'no recent ' + fromName + ' at this location' }
            }
            const from = fromOcc[fromOcc.length - 1]
            const toOcc = occurrencesOf(toIsClock, term.toTime, term.to, from + DAY_MS)
                .concat(occurrencesOf(toIsClock, term.toTime, term.to, from))
                .filter(function (t) { return t > from })
                .sort(function (a, b) { return a - b })
            if (!toOcc.length) {
                return { pass: false, detail: 'no ' + toName + ' following ' + fromName + ' at this location' }
            }
            const pass = ts >= from && ts < toOcc[0]
            return { pass, detail: fromName + ' was ' + fmtDetailTime(from, tz) + ', next ' + toName + ' is ' + fmtDetailTime(toOcc[0], tz) }
        }
        case 'moonAltitude': {
            const alt = SunCalc.getMoonPosition(new Date(ts), lat, lon).altitude // degrees
            let pass
            if (term.op === 'between') {
                pass = alt >= term.low && alt <= term.high
            } else {
                pass = term.op === 'above' ? alt > term.degrees : alt <= term.degrees
            }
            return { pass, detail: 'moon altitude is ' + alt.toFixed(1) + ' degrees' }
        }
        case 'moonAzimuth': {
            const az = SunCalc.getMoonPosition(new Date(ts), lat, lon).azimuth // degrees, compass bearing from North
            return { pass: inAzimuthRange(az, term.low, term.high), detail: 'moon azimuth is ' + az.toFixed(1) + ' degrees' }
        }
        case 'moonPhase': {
            // "day before/after <phase>": the phase condition held offsetDays ago
            const tsm = ts - ((term.offsetDays || 0) * DAY_MS)
            const illum = SunCalc.getMoonIllumination(new Date(tsm))
            const phase = illum.phase // 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
            const tolerance = 0.017 // about half a day either side
            let pass
            switch (term.phase) {
                case 'new': pass = Math.min(phase, 1 - phase) <= tolerance; break
                case 'firstQuarter': pass = Math.abs(phase - 0.25) <= tolerance; break
                case 'full': pass = Math.abs(phase - 0.5) <= tolerance; break
                case 'lastQuarter': pass = Math.abs(phase - 0.75) <= tolerance; break
                case 'waxing': pass = phase < 0.5; break
                case 'waning': pass = phase >= 0.5; break
                case 'blue': {
                    // the second full moon of a calendar month (month judged in
                    // the node timezone): full now, AND the previous full-moon
                    // peak (one synodic month earlier) fell in the same month
                    if (Math.abs(phase - 0.5) > tolerance) {
                        pass = false
                        break
                    }
                    const peak = fullMoonPeakNear(tsm)
                    const prevPeak = fullMoonPeakNear(peak - SYNODIC_MS)
                    const here = getLocalParts(peak, tz)
                    const previous = getLocalParts(prevPeak, tz)
                    pass = here.year === previous.year && here.month === previous.month
                    return { pass, detail: 'full moon peaks ' + fmtDetailTime(peak, tz) + '; previous full moon was ' + (pass ? 'earlier the same month' : 'in the previous month') }
                }
                case 'seasonalBlue': {
                    // the third full moon in an astronomical season holding four
                    if (Math.abs(phase - 0.5) > tolerance) {
                        pass = false
                        break
                    }
                    const peak = fullMoonPeakNear(tsm)
                    pass = isSeasonalBlueMoon(peak)
                    return { pass, detail: 'full moon peaks ' + fmtDetailTime(peak, tz) + (pass ? ' - the third of four this season' : ' - not the third of four this season') }
                }
                default: pass = false
            }
            return { pass, detail: 'moon phase is ' + phase.toFixed(3) + ' (' + Math.round(illum.fraction * 100) + '% illuminated)' }
        }
        case 'moonIllumination': {
            const fraction = SunCalc.getMoonIllumination(new Date(ts)).fraction
            let pass
            switch (term.op) {
                case 'gt': pass = fraction > term.fraction; break
                case 'gte': pass = fraction >= term.fraction; break
                case 'lt': pass = fraction < term.fraction; break
                case 'lte': pass = fraction <= term.fraction; break
                default: pass = false
            }
            return { pass, detail: 'moon is ' + Math.round(fraction * 100) + '% illuminated' }
        }
        default:
            return { pass: false, detail: 'unknown condition kind: ' + term.kind }
    }
}

// fast pass/fail only - no reasons, short-circuits groups and terms. This is
// what the window scanner uses: building reason descriptions per sample made
// scans an order of magnitude slower.
function evaluatePass (ast, opts) {
    if (!ast || !ast.groups || !ast.groups.length) { return false }
    const ctx = { ts: opts.ts, lat: opts.lat, lon: opts.lon, tz: opts.tz || undefined }
    const locationOk = typeof ctx.lat === 'number' && typeof ctx.lon === 'number' && !isNaN(ctx.lat) && !isNaN(ctx.lon)
    for (let g = 0; g < ast.groups.length; g++) {
        const terms = ast.groups[g].terms
        let groupPass = true
        for (let i = 0; i < terms.length; i++) {
            const term = terms[i]
            let raw = false
            if (whenGateLang.LOCATION_KINDS.indexOf(term.kind) >= 0 && !locationOk) {
                raw = false
            } else {
                try {
                    raw = evalTerm(term, ctx).pass
                } catch (_e) {
                    raw = false
                }
            }
            if ((term.negate ? !raw : raw) === false) {
                groupPass = false
                break
            }
        }
        if (groupPass) { return true }
    }
    return false
}

function evaluate (ast, opts) {
    const ctx = {
        ts: opts.ts,
        lat: opts.lat,
        lon: opts.lon,
        tz: opts.tz || undefined
    }
    const reasons = []
    let pass = false
    if (!ast || !ast.groups || !ast.groups.length) {
        return { pass: false, reasons: [{ source: '', description: '', pass: false, detail: 'no condition' }] }
    }
    ast.groups.forEach(function (group) {
        let groupPass = true
        group.terms.forEach(function (term) {
            let result
            const needsLocation = whenGateLang.LOCATION_KINDS.indexOf(term.kind) >= 0
            if (needsLocation && (typeof ctx.lat !== 'number' || typeof ctx.lon !== 'number' || isNaN(ctx.lat) || isNaN(ctx.lon))) {
                result = { pass: false, detail: 'location (lat/lon) required but not available' }
            } else {
                try {
                    result = evalTerm(term, ctx)
                } catch (err) {
                    // never throw from a term (bad timezone, library edge case, ...)
                    result = { pass: false, detail: 'cannot evaluate: ' + err.message }
                }
            }
            const termPass = term.negate ? !result.pass : result.pass
            if (!termPass) { groupPass = false }
            reasons.push({
                source: term.source || term.kind,
                description: whenGateLang.describe({ type: 'or', groups: [{ type: 'and', terms: [term] }] }),
                pass: termPass,
                detail: result.detail
            })
        })
        if (groupPass) { pass = true }
    })
    return { pass, reasons }
}

function gcd (a, b) {
    a = Math.abs(Math.round(a))
    b = Math.abs(Math.round(b))
    while (b) {
        const r = a % b
        a = b
        b = r
    }
    return a
}

// choose a sampling step the condition's clock boundaries actually land on:
// "between 22:00 and 22:10" needs 5-minute samples, "ten past" (a single
// minute each hour) needs 1-minute samples, plain conditions keep 15
function pickResolution (ast) {
    let res = 15
    if (!ast || !ast.groups) { return res }
    ast.groups.forEach(function (g) {
        g.terms.forEach(function (t) {
            if (t.kind === 'timeRange') {
                res = gcd(res, t.startMin % 1440) || res
                res = gcd(res, t.endMin % 1440) || res
            } else if (t.kind === 'minuteOfHour') {
                res = gcd(res, t.startMin) || res
                if (t.style === 'between') { res = gcd(res, t.endMin) || res }
            } else if (t.kind === 'solarBetween') {
                if (typeof t.fromTime === 'number') { res = gcd(res, t.fromTime % 1440) || res }
                if (typeof t.toTime === 'number') { res = gcd(res, t.toTime % 1440) || res }
            }
        })
    })
    return Math.max(1, Math.min(15, res))
}

// scan forward for periods where the condition passes - powers the editor's
// "upcoming matches" details popout and the node's allow/deny-until status.
// Sample-based on a minute grid with window edges refined to the exact minute;
// hard time-budgeted so a pathological condition cannot stall anything.
function findWindows (ast, opts) {
    opts = opts || {}
    const stepMs = (opts.resolutionMinutes || pickResolution(ast)) * 60000
    const budgetMs = opts.budgetMs || 400
    const maxWindows = opts.maxWindows || 5
    const horizonMs = (opts.horizonDays || 400) * DAY_MS
    const startTs = opts.ts || Date.now()
    const started = Date.now()
    const evalOpts = { lat: opts.lat, lon: opts.lon, tz: opts.tz }
    function passAt (ts) {
        return evaluatePass(ast, { ts, lat: evalOpts.lat, lon: evalOpts.lon, tz: evalOpts.tz })
    }
    // binary-search the minute (grid-aligned) where the decision flips between
    // a sample with state `fromPass` at fromTs and the opposite state at toTs
    function refineFlip (fromTs, toTs, fromPass) {
        let lo = fromTs
        let hi = toTs
        while (hi - lo > 60000) {
            let mid = lo + (Math.round((hi - lo) / 2 / 60000) * 60000)
            if (mid <= lo) { mid = lo + 60000 }
            if (mid >= hi) { mid = hi - 60000 }
            if (passAt(mid) === fromPass) { lo = mid } else { hi = mid }
        }
        return hi // the first minute in the flipped state
    }
    const firstSample = Math.floor(startTs / stepMs) * stepMs
    let t = firstSample
    const scanEnd = startTs + horizonMs
    const windows = []
    let open = null
    let truncated = false
    while (t < scanEnd) {
        if (Date.now() - started > budgetMs) {
            truncated = true
            break
        }
        const pass = passAt(t)
        if (pass && open === null) {
            // refine the start unless the very first sample was already passing
            open = t === firstSample ? t : refineFlip(t - stepMs, t, false)
        }
        if (!pass && open !== null) {
            windows.push({ start: open, end: refineFlip(t - stepMs, t, true) })
            open = null
            if (windows.length >= maxWindows) { break }
        }
        t += stepMs
    }
    if (open !== null) { windows.push({ start: open, end: null }) } // still allowed when the scan stopped
    return { windows, scannedFrom: startTs, scannedUntil: t, resolutionMinutes: stepMs / 60000, truncated }
}

module.exports = {
    evaluate,
    evaluatePass,
    findWindows,
    _internal: {
        getSunTimes,
        seasonInstant,
        isSeasonalBlueMoon,
        getLocalParts,
        solarStateMatch,
        sunAltitude,
        sunAzimuth,
        sunDirection,
        eventOccurrences
    }
}
