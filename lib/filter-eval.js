/* Evaluator for the cronplus-filter condition AST (see resources/filter-lang.js).
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
let filterLang
try {
    filterLang = require('../resources/filter-lang.js')
} catch (_e) {
    filterLang = require('../resources/filter-lang.min.js')
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

function sunDirection (ts, lat, lon) {
    return sunAltitude(ts + 60000, lat, lon) > sunAltitude(ts, lat, lon) ? 'rise' : 'fall'
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
            if (term.last) {
                const dim = daysInMonth(p.year, p.month)
                return { pass: p.dayOfMonth === dim, detail: 'local day of month is ' + p.dayOfMonth + ' (month has ' + dim + ' days)' }
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
            if (term.scope === 'year') {
                const doy = dayOfYear(p)
                pass = term.nth === 'last' ? doy > daysInYear(p.year) - 7 : Math.ceil(doy / 7) === term.nth
                return { pass, detail: 'local day is number ' + doy + ' of the year (week ' + Math.ceil(doy / 7) + ')' }
            }
            const dim = daysInMonth(p.year, p.month)
            pass = term.nth === 'last' ? p.dayOfMonth > dim - 7 : Math.ceil(p.dayOfMonth / 7) === term.nth
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
            if (term.scope === 'year') {
                const doy = dayOfYear(p)
                if (term.nth === 'last') {
                    pass = doy > daysInYear(p.year) - 7
                } else {
                    pass = Math.ceil(doy / 7) === term.nth
                }
                return { pass, detail: 'local day is ' + DAY_NAMES[p.weekday] + ' number ' + Math.ceil(doy / 7) + ' of the year' }
            }
            if (term.nth === 'last') {
                pass = p.dayOfMonth > daysInMonth(p.year, p.month) - 7
            } else {
                pass = Math.ceil(p.dayOfMonth / 7) === term.nth
            }
            return { pass, detail: 'local day is ' + DAY_NAMES[p.weekday] + ' number ' + Math.ceil(p.dayOfMonth / 7) + ' of the month' }
        }
        case 'year': {
            const p = getLocalParts(ts, tz)
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
            const fromOcc = eventOccurrences(term.from, ts, lat, lon, tz).filter(function (o) { return o.time <= ts })
            if (!fromOcc.length) {
                return { pass: false, detail: 'no recent ' + term.from + ' at this location' }
            }
            const from = fromOcc[fromOcc.length - 1]
            const toOcc = eventOccurrences(term.to, from.time + DAY_MS, lat, lon, tz)
                .concat(eventOccurrences(term.to, from.time, lat, lon, tz))
                .filter(function (o) { return o.time > from.time })
                .sort(function (a, b) { return a.time - b.time })
            if (!toOcc.length) {
                return { pass: false, detail: 'no ' + term.to + ' following ' + term.from + ' at this location' }
            }
            const pass = ts >= from.time && ts < toOcc[0].time
            return { pass, detail: term.from + ' was ' + fmtDetailTime(from.time, tz) + ', next ' + term.to + ' is ' + fmtDetailTime(toOcc[0].time, tz) }
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
        case 'moonPhase': {
            const illum = SunCalc.getMoonIllumination(new Date(ts))
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
            if (filterLang.LOCATION_KINDS.indexOf(term.kind) >= 0 && !locationOk) {
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
            const needsLocation = filterLang.LOCATION_KINDS.indexOf(term.kind) >= 0
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
                description: filterLang.describe({ type: 'or', groups: [{ type: 'and', terms: [term] }] }),
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
        getLocalParts,
        solarStateMatch,
        sunAltitude,
        sunDirection,
        eventOccurrences
    }
}
