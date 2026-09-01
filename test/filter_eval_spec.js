/// <reference types="should" />
// Evaluator tests for lib/filter-eval.js at fixed instants/locations.
// Expected solar/lunar values are computed from require('suncalc') inside the
// tests so expectations track the library (existing suite convention).
const should = require('should')
const { describe, it } = require('node:test')
const SunCalc = require('suncalc')
const lang = require('../resources/filter-lang.js')
const evaluator = require('../lib/filter-eval.js')

const LONDON = { lat: 51.5, lon: -0.13 }
const POLAR = { lat: 89, lon: 0 }

function evalText (text, opts) {
    const parsed = lang.parse(text)
    parsed.ok.should.be.true(`condition "${text}" did not parse: ${parsed.suggestion}`)
    return evaluator.evaluate(parsed.ast, opts)
}

describe('filter-eval: calendar terms', function () {
    // 2026-06-21 is a Sunday
    const SUNDAY_NOON_UTC = Date.parse('2026-06-21T12:00:00Z')

    it('matches day of week in UTC-ish system terms', function () {
        evalText('on sundays', { ts: SUNDAY_NOON_UTC, tz: 'UTC' }).pass.should.be.true()
        evalText('on saturdays', { ts: SUNDAY_NOON_UTC, tz: 'UTC' }).pass.should.be.false()
    })

    it('respects the timezone for weekday boundaries (Sat 03:00Z = Fri evening in New York)', function () {
        const ts = Date.parse('2026-06-20T03:00:00Z') // Saturday 03:00 UTC
        evalText('on saturdays', { ts, tz: 'UTC' }).pass.should.be.true()
        evalText('on fridays', { ts, tz: 'America/New_York' }).pass.should.be.true()
        evalText('on saturdays', { ts, tz: 'America/New_York' }).pass.should.be.false()
    })

    it('negated day passes on other days', function () {
        evalText('not on tuesday', { ts: SUNDAY_NOON_UTC, tz: 'UTC' }).pass.should.be.true()
        evalText('not on sunday', { ts: SUNDAY_NOON_UTC, tz: 'UTC' }).pass.should.be.false()
    })

    it('matches months and named dates', function () {
        evalText('in june', { ts: SUNDAY_NOON_UTC, tz: 'UTC' }).pass.should.be.true()
        evalText('in december', { ts: SUNDAY_NOON_UTC, tz: 'UTC' }).pass.should.be.false()
        evalText('christmas day', { ts: Date.parse('2026-12-25T09:00:00Z'), tz: 'UTC' }).pass.should.be.true()
        evalText('on the 21st of the month', { ts: SUNDAY_NOON_UTC, tz: 'UTC' }).pass.should.be.true()
    })

    it('"every day" always passes', function () {
        evalText('every day', { ts: SUNDAY_NOON_UTC }).pass.should.be.true()
    })

    it('fails soft with an invalid timezone', function () {
        const r = evalText('on sundays', { ts: SUNDAY_NOON_UTC, tz: 'Not/AZone' })
        r.pass.should.be.false()
        r.reasons[0].detail.should.match(/cannot evaluate/)
    })
})

describe('filter-eval: time ranges (Europe/London, GMT in January)', function () {
    const tz = 'Europe/London'
    const at = iso => Date.parse(iso)

    it('overnight range 22:00-06:00 hits and misses at the edges', function () {
        const cond = 'between 10pm and 6am'
        evalText(cond, { ts: at('2026-01-15T23:30:00Z'), tz }).pass.should.be.true()
        evalText(cond, { ts: at('2026-01-16T05:59:00Z'), tz }).pass.should.be.true()
        evalText(cond, { ts: at('2026-01-16T06:00:00Z'), tz }).pass.should.be.false()
        evalText(cond, { ts: at('2026-01-15T12:00:00Z'), tz }).pass.should.be.false()
        evalText(cond, { ts: at('2026-01-15T22:00:00Z'), tz }).pass.should.be.true() // start inclusive
    })

    it('daytime range 09:00-17:00', function () {
        const cond = 'between 9am and 5pm'
        evalText(cond, { ts: at('2026-01-15T09:00:00Z'), tz }).pass.should.be.true()
        evalText(cond, { ts: at('2026-01-15T16:59:00Z'), tz }).pass.should.be.true()
        evalText(cond, { ts: at('2026-01-15T17:00:00Z'), tz }).pass.should.be.false()
        evalText(cond, { ts: at('2026-01-15T08:59:00Z'), tz }).pass.should.be.false()
    })

    it('respects DST local clock (2026-06-21T11:30Z is 12:30 BST)', function () {
        evalText('before noon', { ts: at('2026-06-21T11:30:00Z'), tz }).pass.should.be.false()
        evalText('before noon', { ts: at('2026-06-21T10:30:00Z'), tz }).pass.should.be.true()
    })
})

describe('filter-eval: solar terms (London)', function () {
    const tz = 'Europe/London'

    it('is night at London 23:00Z mid-January, not at noon', function () {
        evalText('is night', { ts: Date.parse('2026-01-15T23:00:00Z'), tz, ...LONDON }).pass.should.be.true()
        evalText('is night', { ts: Date.parse('2026-01-15T12:00:00Z'), tz, ...LONDON }).pass.should.be.false()
    })

    it('daylight at noon', function () {
        evalText('during daylight', { ts: Date.parse('2026-01-15T12:00:00Z'), tz, ...LONDON }).pass.should.be.true()
        evalText('during daylight', { ts: Date.parse('2026-01-15T23:00:00Z'), tz, ...LONDON }).pass.should.be.false()
    })

    it('sun rising/setting flips at solar noon', function () {
        const noon = SunCalc.getTimes(new Date('2026-06-21T12:00:00Z'), LONDON.lat, LONDON.lon).solarNoon.valueOf()
        evalText('sun rising', { ts: noon - 3600000, tz, ...LONDON }).pass.should.be.true()
        evalText('sun rising', { ts: noon + 3600000, tz, ...LONDON }).pass.should.be.false()
        evalText('sun setting', { ts: noon + 3600000, tz, ...LONDON }).pass.should.be.true()
    })

    it('after sunset uses the local calendar date', function () {
        const sunset = SunCalc.getTimes(new Date('2026-06-21T12:00:00Z'), LONDON.lat, LONDON.lon).sunset.valueOf()
        evalText('after sunset', { ts: sunset + 1800000, tz, ...LONDON }).pass.should.be.true()
        evalText('after sunset', { ts: sunset - 3600000, tz, ...LONDON }).pass.should.be.false()
        evalText('before sunset', { ts: sunset - 3600000, tz, ...LONDON }).pass.should.be.true()
    })

    it('within 30 minutes of sunrise', function () {
        const sunrise = SunCalc.getTimes(new Date('2026-06-21T12:00:00Z'), LONDON.lat, LONDON.lon).sunrise.valueOf()
        evalText('within 30 minutes of sunrise', { ts: sunrise + 600000, tz, ...LONDON }).pass.should.be.true()
        evalText('within 30 minutes of sunrise', { ts: sunrise + 3600000, tz, ...LONDON }).pass.should.be.false()
    })

    it('mixed clock/event windows: "10pm to sunrise" and "sunrise until 6pm"', function () {
        const sunrise = SunCalc.getTimes(new Date('2026-01-15T12:00:00Z'), LONDON.lat, LONDON.lon).sunrise.valueOf()
        const opts = { tz, ...LONDON }
        evalText('10pm to sunrise', { ts: Date.parse('2026-01-14T23:00:00Z'), ...opts }).pass.should.be.true()
        evalText('10pm to sunrise', { ts: Date.parse('2026-01-15T03:00:00Z'), ...opts }).pass.should.be.true()
        evalText('10pm to sunrise', { ts: sunrise - 600000, ...opts }).pass.should.be.true()
        evalText('10pm to sunrise', { ts: sunrise + 600000, ...opts }).pass.should.be.false()
        evalText('10pm to sunrise', { ts: Date.parse('2026-01-15T21:00:00Z'), ...opts }).pass.should.be.false()
        evalText('sunrise until 6pm', { ts: sunrise + 3600000, ...opts }).pass.should.be.true()
        evalText('sunrise until 6pm', { ts: Date.parse('2026-01-15T17:59:00Z'), ...opts }).pass.should.be.true()
        evalText('sunrise until 6pm', { ts: Date.parse('2026-01-15T18:30:00Z'), ...opts }).pass.should.be.false()
        evalText('sunrise until 6pm', { ts: sunrise - 3600000, ...opts }).pass.should.be.false()
    })

    it('between sunset and sunrise spans midnight', function () {
        evalText('between sunset and sunrise', { ts: Date.parse('2026-01-15T23:00:00Z'), tz, ...LONDON }).pass.should.be.true()
        evalText('between sunset and sunrise', { ts: Date.parse('2026-01-15T12:00:00Z'), tz, ...LONDON }).pass.should.be.false()
    })

    it('polar probe: sunrise does not occur at 89N in early January (fail soft, never throw)', function () {
        const r = evalText('after sunrise', { ts: Date.parse('2026-01-04T12:00:00Z'), tz: 'UTC', ...POLAR })
        r.pass.should.be.false()
        r.reasons[0].detail.should.match(/does not occur/)
    })

    it('polar probe: night state still computable at 89N (altitude based)', function () {
        // sun stays far below the horizon all day at 89N in January
        evalText('is night', { ts: Date.parse('2026-01-04T12:00:00Z'), tz: 'UTC', ...POLAR }).pass.should.be.true()
    })
})

describe('filter-eval: moon terms', function () {
    it('moon visibility matches suncalc altitude sign', function () {
        const ts = Date.parse('2026-06-21T12:00:00Z')
        const alt = SunCalc.getMoonPosition(new Date(ts), LONDON.lat, LONDON.lon).altitude
        const expected = alt > 0
        evalText('when the moon is visible', { ts, ...LONDON }).pass.should.equal(expected)
        evalText('no moon', { ts, ...LONDON }).pass.should.equal(!expected)
    })

    it('full moon within tolerance at the nearest full-moon instant', function () {
        // find the instant in Jan 2026 where phase is closest to 0.5 (hourly scan)
        let best = null
        for (let ts = Date.parse('2026-01-01T00:00:00Z'); ts < Date.parse('2026-02-01T00:00:00Z'); ts += 3600000) {
            const phase = SunCalc.getMoonIllumination(new Date(ts)).phase
            const dist = Math.abs(phase - 0.5)
            if (!best || dist < best.dist) { best = { ts, dist } }
        }
        evalText('full moon', { ts: best.ts }).pass.should.be.true()
        // two weeks away from full it must fail
        evalText('full moon', { ts: best.ts + (14 * 86400000) }).pass.should.be.false()
    })

    it('moon illumination threshold matches suncalc fraction', function () {
        const ts = Date.parse('2026-01-15T00:00:00Z')
        const fraction = SunCalc.getMoonIllumination(new Date(ts)).fraction
        evalText('moon more than 50% illuminated', { ts }).pass.should.equal(fraction > 0.5)
        evalText('moon less than 50% illuminated', { ts }).pass.should.equal(fraction < 0.5)
    })

    it('moon phase does not require a location', function () {
        const r = evalText('full moon', { ts: Date.parse('2026-01-15T00:00:00Z') })
        r.reasons[0].detail.should.not.match(/location/)
    })
})

describe('filter-eval: ordinal days', function () {
    // June 2026: the 1st is a Monday; Tuesdays fall on 2/9/16/23/30; Fridays on 5/12/19/26
    const tz = 'UTC'

    it('first monday of the month', function () {
        evalText('first monday of the month', { ts: Date.parse('2026-06-01T12:00:00Z'), tz }).pass.should.be.true()
        evalText('first monday of the month', { ts: Date.parse('2026-06-08T12:00:00Z'), tz }).pass.should.be.false() // second Monday
        evalText('first monday of the month', { ts: Date.parse('2026-06-02T12:00:00Z'), tz }).pass.should.be.false() // Tuesday
    })

    it('third tuesday of the month', function () {
        evalText('third tuesday of the month', { ts: Date.parse('2026-06-16T12:00:00Z'), tz }).pass.should.be.true()
        evalText('third tuesday of the month', { ts: Date.parse('2026-06-09T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('last friday of the month', function () {
        evalText('last friday of the month', { ts: Date.parse('2026-06-26T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last friday of the month', { ts: Date.parse('2026-06-19T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('last day of the month (incl. leap February)', function () {
        evalText('last day of the month', { ts: Date.parse('2026-06-30T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last day of the month', { ts: Date.parse('2026-06-29T12:00:00Z'), tz }).pass.should.be.false()
        evalText('last day of the month', { ts: Date.parse('2028-02-29T12:00:00Z'), tz }).pass.should.be.true() // 2028 is a leap year
        evalText('last day of the month', { ts: Date.parse('2027-02-28T12:00:00Z'), tz }).pass.should.be.true()
    })

    it('last day of the week is Sunday, first is Monday (ISO)', function () {
        evalText('last day of the week', { ts: Date.parse('2026-06-21T12:00:00Z'), tz }).pass.should.be.true() // Sunday
        evalText('last day of the week', { ts: Date.parse('2026-06-20T12:00:00Z'), tz }).pass.should.be.false() // Saturday
        evalText('first day of the week', { ts: Date.parse('2026-06-22T12:00:00Z'), tz }).pass.should.be.true() // Monday
    })
})

describe('filter-eval: date offsets', function () {
    const tz = 'UTC'

    it('christmas eve / day before christmas is 24 December', function () {
        evalText('christmas eve', { ts: Date.parse('2026-12-24T09:00:00Z'), tz }).pass.should.be.true()
        evalText('christmas eve', { ts: Date.parse('2026-12-25T09:00:00Z'), tz }).pass.should.be.false()
        evalText('day before christmas', { ts: Date.parse('2026-12-24T09:00:00Z'), tz }).pass.should.be.true()
    })

    it('new years eve wraps the year boundary (31 December)', function () {
        evalText('new years eve', { ts: Date.parse('2026-12-31T09:00:00Z'), tz }).pass.should.be.true()
        evalText('new years eve', { ts: Date.parse('2026-01-01T09:00:00Z'), tz }).pass.should.be.false()
    })

    it('4 days after christmas is 29 December', function () {
        evalText('4 days after christmas', { ts: Date.parse('2026-12-29T09:00:00Z'), tz }).pass.should.be.true()
        evalText('4 days after christmas', { ts: Date.parse('2026-12-28T09:00:00Z'), tz }).pass.should.be.false()
    })

    it('1 month before christmas is 25 November', function () {
        evalText('1 month before christmas', { ts: Date.parse('2026-11-25T09:00:00Z'), tz }).pass.should.be.true()
        evalText('1 month before christmas', { ts: Date.parse('2026-12-25T09:00:00Z'), tz }).pass.should.be.false()
    })

    it('1 month after halloween clamps to 30 November', function () {
        evalText('1 month after halloween', { ts: Date.parse('2026-11-30T09:00:00Z'), tz }).pass.should.be.true()
        evalText('1 month after halloween', { ts: Date.parse('2026-12-01T09:00:00Z'), tz }).pass.should.be.false()
    })

    it('within 2 days of christmas spans 23-27 December', function () {
        evalText('within 2 days of christmas', { ts: Date.parse('2026-12-23T09:00:00Z'), tz }).pass.should.be.true()
        evalText('within 2 days of christmas', { ts: Date.parse('2026-12-27T09:00:00Z'), tz }).pass.should.be.true()
        evalText('within 2 days of christmas', { ts: Date.parse('2026-12-20T09:00:00Z'), tz }).pass.should.be.false()
    })

    it('within N days also wraps years (30 Dec is within 2 days of new years day)', function () {
        evalText('within 2 days of new years day', { ts: Date.parse('2026-12-30T09:00:00Z'), tz }).pass.should.be.true()
    })
})

describe('filter-eval: solar event offsets (London, January - GMT)', function () {
    const tz = 'Europe/London'

    it('2 hours after sunset shifts the boundary later', function () {
        const sunset = SunCalc.getTimes(new Date('2026-01-15T12:00:00Z'), LONDON.lat, LONDON.lon).sunset.valueOf()
        evalText('2 hours after sunset', { ts: sunset + (3 * 3600000), tz, ...LONDON }).pass.should.be.true()
        evalText('2 hours after sunset', { ts: sunset + (1 * 3600000), tz, ...LONDON }).pass.should.be.false()
        // plain "after sunset" passes at sunset+1h, proving the offset moved it
        evalText('after sunset', { ts: sunset + (1 * 3600000), tz, ...LONDON }).pass.should.be.true()
    })

    it('30 minutes before sunrise shifts the boundary earlier', function () {
        const sunrise = SunCalc.getTimes(new Date('2026-01-15T12:00:00Z'), LONDON.lat, LONDON.lon).sunrise.valueOf()
        evalText('30 minutes before sunrise', { ts: sunrise - (2 * 3600000), tz, ...LONDON }).pass.should.be.true()
        evalText('30 minutes before sunrise', { ts: sunrise - (10 * 60000), tz, ...LONDON }).pass.should.be.false()
        evalText('before sunrise', { ts: sunrise - (10 * 60000), tz, ...LONDON }).pass.should.be.true()
    })
})

describe('filter-eval: last-day-of-month combinations', function () {
    const tz = 'UTC'
    // 2026: 30 Jun is a Tuesday; 31 Jul is a Friday; 30 Sep is a Wednesday

    it('"last day of the month except friday" fires on non-Friday month ends only', function () {
        evalText('last day of the month except friday', { ts: Date.parse('2026-06-30T12:00:00Z'), tz }).pass.should.be.true() // Tuesday
        evalText('last day of the month except friday', { ts: Date.parse('2026-07-31T12:00:00Z'), tz }).pass.should.be.false() // Friday
        evalText('last day of the month except friday', { ts: Date.parse('2026-07-30T12:00:00Z'), tz }).pass.should.be.false() // not last day
    })

    it('"last day of the month is friday" fires only when the month ends on a Friday', function () {
        evalText('last day of the month is friday', { ts: Date.parse('2026-07-31T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last day of the month is friday', { ts: Date.parse('2026-06-30T12:00:00Z'), tz }).pass.should.be.false() // Tuesday
        evalText('last day of the month is friday', { ts: Date.parse('2026-07-24T12:00:00Z'), tz }).pass.should.be.false() // Friday, not last
    })

    it('"last day of the month is not wednesday" skips Wednesday month ends', function () {
        evalText('last day of the month is not wednesday', { ts: Date.parse('2026-06-30T12:00:00Z'), tz }).pass.should.be.true() // Tuesday
        evalText('last day of the month is not wednesday', { ts: Date.parse('2026-09-30T12:00:00Z'), tz }).pass.should.be.false() // Wednesday
    })
})

describe('filter-eval: years', function () {
    const tz = 'UTC'

    it('january 2027 requires both month and year', function () {
        evalText('january 2027', { ts: Date.parse('2027-01-15T12:00:00Z'), tz }).pass.should.be.true()
        evalText('january 2027', { ts: Date.parse('2026-01-15T12:00:00Z'), tz }).pass.should.be.false()
        evalText('january 2027', { ts: Date.parse('2027-02-01T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('year ranges', function () {
        evalText('2027 to 2029', { ts: Date.parse('2028-06-15T12:00:00Z'), tz }).pass.should.be.true()
        evalText('2027 to 2029', { ts: Date.parse('2026-06-15T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('1st monday of the year (Jan 1 2026 is a Thursday, so 5 Jan)', function () {
        evalText('1st monday of the year', { ts: Date.parse('2026-01-05T12:00:00Z'), tz }).pass.should.be.true()
        evalText('1st monday of the year', { ts: Date.parse('2026-01-12T12:00:00Z'), tz }).pass.should.be.false() // 2nd Monday
        evalText('1st monday of the year', { ts: Date.parse('2026-02-02T12:00:00Z'), tz }).pass.should.be.false() // a later Monday
    })

    it('2nd tuesday of 2028 (Jan 1 2028 is a Saturday, so 11 Jan 2028)', function () {
        evalText('2nd tuesday of 2028', { ts: Date.parse('2028-01-11T12:00:00Z'), tz }).pass.should.be.true()
        evalText('2nd tuesday of 2028', { ts: Date.parse('2028-01-04T12:00:00Z'), tz }).pass.should.be.false() // 1st Tuesday
        evalText('2nd tuesday of 2028', { ts: Date.parse('2027-01-12T12:00:00Z'), tz }).pass.should.be.false() // right ordinal, wrong year
    })

    it('first monday of january (any year)', function () {
        evalText('first monday of january', { ts: Date.parse('2026-01-05T12:00:00Z'), tz }).pass.should.be.true()
        evalText('first monday of january', { ts: Date.parse('2026-02-02T12:00:00Z'), tz }).pass.should.be.false() // February
    })

    it('last day of the year', function () {
        evalText('last day of the year', { ts: Date.parse('2026-12-31T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last day of the year', { ts: Date.parse('2026-12-30T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('last day of a named month (incl. leap february)', function () {
        evalText('last day of jan', { ts: Date.parse('2026-01-31T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last day of jan', { ts: Date.parse('2026-01-30T12:00:00Z'), tz }).pass.should.be.false()
        evalText('last day of jan', { ts: Date.parse('2026-02-28T12:00:00Z'), tz }).pass.should.be.false() // wrong month
        evalText('last day of february', { ts: Date.parse('2028-02-29T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last day of february', { ts: Date.parse('2028-02-28T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('last day of a specific year', function () {
        evalText('last day of 2027', { ts: Date.parse('2027-12-31T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last day of 2027', { ts: Date.parse('2026-12-31T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('ordinal weeks of month and year', function () {
        evalText('first week of the month', { ts: Date.parse('2026-06-03T12:00:00Z'), tz }).pass.should.be.true()
        evalText('first week of the month', { ts: Date.parse('2026-06-10T12:00:00Z'), tz }).pass.should.be.false()
        evalText('2nd week of january', { ts: Date.parse('2026-01-10T12:00:00Z'), tz }).pass.should.be.true()
        evalText('2nd week of january', { ts: Date.parse('2026-02-10T12:00:00Z'), tz }).pass.should.be.false() // wrong month
        evalText('last week of 2027', { ts: Date.parse('2027-12-28T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last week of 2027', { ts: Date.parse('2027-12-20T12:00:00Z'), tz }).pass.should.be.false()
        evalText('last week of 2027', { ts: Date.parse('2026-12-28T12:00:00Z'), tz }).pass.should.be.false() // wrong year
    })

    it('2nd-last and before/after-the-last day arithmetic (June 2026 has 30 days)', function () {
        evalText('2nd last day of month', { ts: Date.parse('2026-06-29T12:00:00Z'), tz }).pass.should.be.true()
        evalText('2nd last day of month', { ts: Date.parse('2026-06-30T12:00:00Z'), tz }).pass.should.be.false()
        evalText('2 days before the last day of month', { ts: Date.parse('2026-06-28T12:00:00Z'), tz }).pass.should.be.true()
        evalText('day after the last day of month', { ts: Date.parse('2026-07-01T12:00:00Z'), tz }).pass.should.be.true()
        evalText('day after the last day of month', { ts: Date.parse('2026-06-30T12:00:00Z'), tz }).pass.should.be.false()
        // 2nd last Friday of June 2026 (Fridays: 5, 12, 19, 26) is the 19th
        evalText('2nd last friday of the month', { ts: Date.parse('2026-06-19T12:00:00Z'), tz }).pass.should.be.true()
        evalText('2nd last friday of the month', { ts: Date.parse('2026-06-26T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('first/last N days of a month or year (leap-aware)', function () {
        evalText('last 2 days of feb', { ts: Date.parse('2027-02-27T12:00:00Z'), tz }).pass.should.be.true() // 2027: 28 days
        evalText('last 2 days of feb', { ts: Date.parse('2027-02-26T12:00:00Z'), tz }).pass.should.be.false()
        evalText('last 2 days of feb', { ts: Date.parse('2028-02-28T12:00:00Z'), tz }).pass.should.be.true() // 2028: leap
        evalText('last 2 days of feb', { ts: Date.parse('2028-02-27T12:00:00Z'), tz }).pass.should.be.false()
        evalText('first 3 days of march', { ts: Date.parse('2026-03-03T12:00:00Z'), tz }).pass.should.be.true()
        evalText('first 3 days of march', { ts: Date.parse('2026-03-04T12:00:00Z'), tz }).pass.should.be.false()
        evalText('first 3 days of march', { ts: Date.parse('2026-04-02T12:00:00Z'), tz }).pass.should.be.false() // wrong month
        evalText('last 5 days of the year', { ts: Date.parse('2026-12-27T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last 5 days of the year', { ts: Date.parse('2026-12-26T12:00:00Z'), tz }).pass.should.be.false()
        evalText('first 3 months of the year', { ts: Date.parse('2026-02-15T12:00:00Z'), tz }).pass.should.be.true()
        evalText('first 3 months of the year', { ts: Date.parse('2026-04-15T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('day before/after a moon phase shifts the evaluation day', { timeout: 20000 }, function () {
        // full moon near 29 Jun 2026: find the peak, then test the neighbouring days
        let best = null
        for (let ts = Date.parse('2026-06-25T00:00:00Z'); ts < Date.parse('2026-07-05T00:00:00Z'); ts += 3600000) {
            const dist = Math.abs(SunCalc.getMoonIllumination(new Date(ts)).phase - 0.5)
            if (!best || dist < best.dist) { best = { ts, dist } }
        }
        evalText('day after full moon', { ts: best.ts + (24 * 3600000), tz }).pass.should.be.true()
        evalText('day after full moon', { ts: best.ts - (24 * 3600000), tz }).pass.should.be.false()
        evalText('day before full moon', { ts: best.ts - (24 * 3600000), tz }).pass.should.be.true()
    })

    it('last month of 2027', function () {
        evalText('last month of 2027', { ts: Date.parse('2027-12-15T12:00:00Z'), tz }).pass.should.be.true()
        evalText('last month of 2027', { ts: Date.parse('2027-11-15T12:00:00Z'), tz }).pass.should.be.false()
        evalText('last month of 2027', { ts: Date.parse('2026-12-15T12:00:00Z'), tz }).pass.should.be.false()
    })
})

describe('filter-eval: even/odd', function () {
    const tz = 'UTC'

    it('day-of-month parity', function () {
        evalText('when day is odd', { ts: Date.parse('2026-06-15T12:00:00Z'), tz }).pass.should.be.true()
        evalText('when day is odd', { ts: Date.parse('2026-06-16T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('month parity (June=6 even, July=7 odd)', function () {
        evalText('on even months', { ts: Date.parse('2026-06-15T12:00:00Z'), tz }).pass.should.be.true()
        evalText('on even months', { ts: Date.parse('2026-07-15T12:00:00Z'), tz }).pass.should.be.false()
    })

    it('year parity', function () {
        evalText('on even years', { ts: Date.parse('2026-06-15T12:00:00Z'), tz }).pass.should.be.true()
        evalText('on even years', { ts: Date.parse('2027-06-15T12:00:00Z'), tz }).pass.should.be.false()
    })
})

describe('filter-eval: sun/moon position', function () {
    const tz = 'Europe/London'
    const midsummerNoon = Date.parse('2026-06-21T12:00:00Z') // sun ~62 degrees over London

    it('altitude ranges track suncalc', function () {
        const alt = SunCalc.getPosition(new Date(midsummerNoon), LONDON.lat, LONDON.lon).altitude
        evalText('sun is high', { ts: midsummerNoon, tz, ...LONDON }).pass.should.equal(alt > 45)
        evalText('sun is low', { ts: midsummerNoon, tz, ...LONDON }).pass.should.equal(alt >= 0 && alt <= 15)
        evalText(`sun is between ${Math.floor(alt) - 1} and ${Math.ceil(alt) + 1} degrees`, { ts: midsummerNoon, tz, ...LONDON }).pass.should.be.true()
        evalText('sun is between 10 and 12 degrees', { ts: midsummerNoon, tz, ...LONDON }).pass.should.be.false()
    })

    it('moon altitude comparisons track suncalc', function () {
        const ts = Date.parse('2026-01-15T22:00:00Z')
        const alt = SunCalc.getMoonPosition(new Date(ts), LONDON.lat, LONDON.lon).altitude
        evalText('moon is high', { ts, tz, ...LONDON }).pass.should.equal(alt > 45)
        evalText('moon above -90 degrees', { ts, tz, ...LONDON }).pass.should.be.true()
        evalText('moon below -90 degrees', { ts, tz, ...LONDON }).pass.should.be.false()
    })

    it('sun position conditions require a location', function () {
        const r = evalText('sun is high', { ts: midsummerNoon, tz })
        r.pass.should.be.false()
        r.reasons[0].detail.should.match(/location/)
    })
})

describe('filter-eval: minute of the hour', function () {
    const tz = 'UTC'

    it('minute range passes inside and fails outside (end exclusive)', function () {
        const cond = 'between 15 minutes and 30 minutes past the hour'
        evalText(cond, { ts: Date.parse('2026-06-20T08:15:00Z'), tz }).pass.should.be.true()
        evalText(cond, { ts: Date.parse('2026-06-20T08:29:00Z'), tz }).pass.should.be.true()
        evalText(cond, { ts: Date.parse('2026-06-20T08:30:00Z'), tz }).pass.should.be.false()
        evalText(cond, { ts: Date.parse('2026-06-20T08:14:00Z'), tz }).pass.should.be.false()
        evalText(cond, { ts: Date.parse('2026-06-20T13:20:00Z'), tz }).pass.should.be.true() // any hour
    })

    it('"quarter past" matches minute 15 of every hour', function () {
        evalText('quarter past', { ts: Date.parse('2026-06-20T03:15:00Z'), tz }).pass.should.be.true()
        evalText('quarter past', { ts: Date.parse('2026-06-20T03:16:00Z'), tz }).pass.should.be.false()
    })

    it('"5 to" matches minute 55', function () {
        evalText('5 to', { ts: Date.parse('2026-06-20T03:55:00Z'), tz }).pass.should.be.true()
        evalText('5 to', { ts: Date.parse('2026-06-20T03:05:00Z'), tz }).pass.should.be.false()
    })

    it('"half past ten" is the clock time 10:30', function () {
        evalText('half past ten', { ts: Date.parse('2026-06-20T10:30:00Z'), tz }).pass.should.be.true()
        evalText('half past ten', { ts: Date.parse('2026-06-20T11:30:00Z'), tz }).pass.should.be.false()
    })

    it('"before quarter to the hour" passes for minutes 0-44 of every hour', function () {
        evalText('before quarter to the hour', { ts: Date.parse('2026-06-20T03:44:00Z'), tz }).pass.should.be.true()
        evalText('before quarter to the hour', { ts: Date.parse('2026-06-20T03:45:00Z'), tz }).pass.should.be.false()
        evalText('before quarter to the hour', { ts: Date.parse('2026-06-20T09:00:00Z'), tz }).pass.should.be.true()
    })

    it('"after quarter past" passes from minute 15 onwards each hour', function () {
        evalText('after quarter past', { ts: Date.parse('2026-06-20T03:15:00Z'), tz }).pass.should.be.true()
        evalText('after quarter past', { ts: Date.parse('2026-06-20T03:14:00Z'), tz }).pass.should.be.false()
    })

    it('float degree ranges track suncalc', function () {
        const ts = Date.parse('2026-06-21T12:00:00Z')
        const alt = SunCalc.getPosition(new Date(ts), LONDON.lat, LONDON.lon).altitude
        evalText('sun is between 43.2 and 80.5 deg', { ts, tz, ...LONDON }).pass.should.equal(alt >= 43.2 && alt <= 80.5)
    })
})

describe('filter-eval: findWindows (upcoming-matches preview)', function () {
    it('finds office-hours windows from a Saturday start', function () {
        const parsed = lang.parse('weekdays between 9am and 5pm')
        const result = evaluator.findWindows(parsed.ast, { ts: Date.parse('2026-06-20T00:00:00Z'), tz: 'UTC', budgetMs: 5000 })
        result.windows.length.should.equal(5) // Mon-Fri of the following week
        result.windows[0].start.should.equal(Date.parse('2026-06-22T09:00:00Z'))
        result.windows[0].end.should.equal(Date.parse('2026-06-22T17:00:00Z'))
    })

    it('finds a rare date months ahead (christmas from June)', function () {
        const parsed = lang.parse('christmas day')
        const result = evaluator.findWindows(parsed.ast, { ts: Date.parse('2026-06-01T00:00:00Z'), tz: 'UTC', budgetMs: 10000, maxWindows: 1 })
        result.windows.length.should.equal(1)
        result.windows[0].start.should.equal(Date.parse('2026-12-25T00:00:00Z'))
        result.windows[0].end.should.equal(Date.parse('2026-12-26T00:00:00Z'))
    })

    it('reports an open-ended window for always-true conditions', function () {
        const parsed = lang.parse('every day')
        const result = evaluator.findWindows(parsed.ast, { ts: Date.parse('2026-06-20T00:00:00Z'), tz: 'UTC', budgetMs: 500 })
        result.windows.length.should.equal(1)
        should(result.windows[0].end).be.null()
    })

    it('reports exact window edges, not sampling-grid edges (regression: 22:00-22:10 showed 22:15)', function () {
        const parsed = lang.parse('time is between 22:00 and 22:10')
        const result = evaluator.findWindows(parsed.ast, { ts: Date.parse('2026-06-20T00:00:00Z'), tz: 'UTC', budgetMs: 5000, maxWindows: 2 })
        result.windows[0].start.should.equal(Date.parse('2026-06-20T22:00:00Z'))
        result.windows[0].end.should.equal(Date.parse('2026-06-20T22:10:00Z'))
    })

    it('finds windows whose edges sit off the 15-minute grid', function () {
        const parsed = lang.parse('between 22:07 and 22:12')
        const result = evaluator.findWindows(parsed.ast, { ts: Date.parse('2026-06-20T00:00:00Z'), tz: 'UTC', budgetMs: 5000, maxWindows: 1 })
        result.windows.length.should.equal(1)
        result.windows[0].start.should.equal(Date.parse('2026-06-20T22:07:00Z'))
        result.windows[0].end.should.equal(Date.parse('2026-06-20T22:12:00Z'))
    })

    it('finds single-minute windows ("ten past" - one minute per hour)', function () {
        const parsed = lang.parse('ten past')
        const result = evaluator.findWindows(parsed.ast, { ts: Date.parse('2026-06-20T00:00:00Z'), tz: 'UTC', budgetMs: 5000, maxWindows: 2 })
        result.resolutionMinutes.should.be.belowOrEqual(5)
        result.windows[0].start.should.equal(Date.parse('2026-06-20T00:10:00Z'))
        result.windows[0].end.should.equal(Date.parse('2026-06-20T00:11:00Z'))
        result.windows[1].start.should.equal(Date.parse('2026-06-20T01:10:00Z'))
    })

    it('moon-gated time slice keeps exact clock edges (the reported case)', function () {
        const parsed = lang.parse('full moon and (time is between 22:00 and 22:10)')
        parsed.ok.should.be.true()
        const result = evaluator.findWindows(parsed.ast, { ts: Date.parse('2026-06-01T00:00:00Z'), tz: 'UTC', budgetMs: 10000, maxWindows: 2 })
        result.windows.length.should.be.above(0)
        result.windows.forEach(function (win) {
            const startMinOfDay = Math.floor(win.start / 60000) % 1440
            startMinOfDay.should.equal(22 * 60)
            ;(win.end - win.start).should.equal(10 * 60000)
        })
    })

    it('stays within its time budget', function () {
        const parsed = lang.parse('after sunset') // solar - much slower per sample
        const started = Date.now()
        evaluator.findWindows(parsed.ast, { ts: Date.parse('2026-06-20T00:00:00Z'), tz: 'UTC', lat: 51.5, lon: -0.13, budgetMs: 200 })
        ;(Date.now() - started).should.be.below(1500)
    })
})

describe('filter-eval: parenthesized conditions', function () {
    const tz = 'UTC'
    const cond = '(last day of the month or wednesday) and time is after 10pm'

    it('passes on the last day of the month after 22:00', function () {
        evalText(cond, { ts: Date.parse('2026-06-30T22:30:00Z'), tz }).pass.should.be.true() // Tuesday 30th
    })

    it('passes on a Wednesday after 22:00', function () {
        evalText(cond, { ts: Date.parse('2026-06-24T22:30:00Z'), tz }).pass.should.be.true()
    })

    it('fails on the last day before 22:00, and on other days after 22:00', function () {
        evalText(cond, { ts: Date.parse('2026-06-30T20:00:00Z'), tz }).pass.should.be.false()
        evalText(cond, { ts: Date.parse('2026-06-23T22:30:00Z'), tz }).pass.should.be.false() // Tuesday, not last day
    })

    it('not (saturday or sunday) means weekdays', function () {
        evalText('not (saturday or sunday)', { ts: Date.parse('2026-06-22T12:00:00Z'), tz }).pass.should.be.true() // Monday
        evalText('not (saturday or sunday)', { ts: Date.parse('2026-06-20T12:00:00Z'), tz }).pass.should.be.false() // Saturday
    })
})

describe('filter-eval: blue moon', function () {
    // full-moon peak instants in a range, by hourly scan of the phase
    function fullMoonPeaks (fromIso, toIso) {
        const peaks = []
        let best = null
        for (let ts = Date.parse(fromIso); ts < Date.parse(toIso); ts += 3600000) {
            const dist = Math.abs(SunCalc.getMoonIllumination(new Date(ts)).phase - 0.5)
            if (dist <= 0.017) {
                if (!best || dist < best.dist) { best = { ts, dist } }
            } else if (best) {
                peaks.push(best.ts)
                best = null
            }
        }
        if (best) { peaks.push(best.ts) }
        return peaks
    }

    it('May 2026 has two full moons and only the second is blue', { timeout: 20000 }, function () {
        const peaks = fullMoonPeaks('2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z')
        peaks.length.should.equal(2)
        evalText('blue moon', { ts: peaks[1], tz: 'UTC' }).pass.should.be.true()
        evalText('blue moon', { ts: peaks[0], tz: 'UTC' }).pass.should.be.false()
        evalText('full moon', { ts: peaks[1], tz: 'UTC' }).pass.should.be.true() // a blue moon is still full
    })

    it('an ordinary full moon is not blue', { timeout: 20000 }, function () {
        const peaks = fullMoonPeaks('2026-06-10T00:00:00Z', '2026-07-10T00:00:00Z')
        peaks.length.should.equal(1)
        evalText('blue moon', { ts: peaks[0], tz: 'UTC' }).pass.should.be.false()
    })

    it('a non-full instant is never blue', function () {
        evalText('blue moon', { ts: Date.parse('2026-05-15T12:00:00Z'), tz: 'UTC' }).pass.should.be.false()
    })

    it('computes equinox/solstice instants to the minute (Meeus)', function () {
        const seasonInstant = evaluator._internal.seasonInstant
        // published instants (UTC) for 2026; allow a generous +/-15 min
        const known = [
            [seasonInstant(2026, 0), '2026-03-20T14:46:00Z'],
            [seasonInstant(2026, 1), '2026-06-21T08:25:00Z'],
            [seasonInstant(2026, 2), '2026-09-23T00:05:00Z'],
            [seasonInstant(2026, 3), '2026-12-21T20:50:00Z']
        ]
        known.forEach(function (pair) {
            Math.abs(pair[0] - Date.parse(pair[1])).should.be.below(15 * 60000, 'expected ' + pair[1] + ' got ' + new Date(pair[0]).toISOString())
        })
    })

    it('20 May 2027 is a seasonal blue moon but not a monthly one', { timeout: 30000 }, function () {
        // find the full-moon peak near the published date by hourly scan
        let best = null
        for (let ts = Date.parse('2027-05-18T00:00:00Z'); ts < Date.parse('2027-05-23T00:00:00Z'); ts += 3600000) {
            const dist = Math.abs(SunCalc.getMoonIllumination(new Date(ts)).phase - 0.5)
            if (!best || dist < best.dist) { best = { ts, dist } }
        }
        evalText('seasonal blue moon', { ts: best.ts, tz: 'UTC' }).pass.should.be.true()
        evalText('blue moon', { ts: best.ts, tz: 'UTC' }).pass.should.be.false() // only one full moon in May 2027
    })

    it('ordinary full moons are not seasonal blue moons', { timeout: 30000 }, function () {
        let best = null
        for (let ts = Date.parse('2026-06-25T00:00:00Z'); ts < Date.parse('2026-07-05T00:00:00Z'); ts += 3600000) {
            const dist = Math.abs(SunCalc.getMoonIllumination(new Date(ts)).phase - 0.5)
            if (!best || dist < best.dist) { best = { ts, dist } }
        }
        evalText('seasonal blue moon', { ts: best.ts, tz: 'UTC' }).pass.should.be.false()
    })
})

describe('filter-eval: combinators and reasons', function () {
    it('AND groups require all terms', function () {
        // 2026-06-21 is a Sunday; noon London is daylight
        const ts = Date.parse('2026-06-21T12:00:00Z')
        evalText('on sundays and during daylight', { ts, tz: 'UTC', ...LONDON }).pass.should.be.true()
        evalText('on saturdays and during daylight', { ts, tz: 'UTC', ...LONDON }).pass.should.be.false()
    })

    it('OR groups pass when any group passes', function () {
        const ts = Date.parse('2026-06-21T12:00:00Z') // Sunday noon (daylight - not after sunset)
        evalText('on weekends or after sunset', { ts, tz: 'UTC', ...LONDON }).pass.should.be.true()
        evalText('on tuesdays or after sunset', { ts, tz: 'UTC', ...LONDON }).pass.should.be.false()
    })

    it('except-terms veto every group', function () {
        const sundayNoon = Date.parse('2026-06-21T12:00:00Z')
        evalText('weekends except sunday', { ts: sundayNoon, tz: 'UTC' }).pass.should.be.false()
        evalText('weekends except saturday', { ts: sundayNoon, tz: 'UTC' }).pass.should.be.true()
    })

    it('missing location fails the term with a clear detail', function () {
        const r = evalText('is night', { ts: Date.parse('2026-01-15T23:00:00Z') })
        r.pass.should.be.false()
        r.reasons[0].detail.should.match(/location/)
    })

    it('reasons carry source, description, pass and detail per term', function () {
        const r = evalText('weekdays between 9am and 5pm', { ts: Date.parse('2026-06-22T10:00:00Z'), tz: 'UTC' }) // Monday 10:00
        r.pass.should.be.true()
        r.reasons.should.have.length(2)
        r.reasons.forEach(function (reason) {
            reason.should.have.properties(['source', 'description', 'pass', 'detail'])
            reason.pass.should.be.true()
        })
    })
})
