/// <reference types="should" />
// Parser tests for resources/filter-lang.js - pure module, no node-red helper needed.
const should = require('should')
const { describe, it } = require('node:test')
const lang = require('../resources/filter-lang.js')

// convenience: parse and return the flat term list of the only AND group
function onlyGroupTerms (text) {
    const r = lang.parse(text)
    r.ok.should.be.true(`expected "${text}" to parse, got: ${r.suggestion}`)
    r.ast.groups.should.have.length(1)
    return r.ast.groups[0].terms
}

function onlyTerm (text) {
    const terms = onlyGroupTerms(text)
    terms.should.have.length(1)
    return terms[0]
}

describe('filter-lang parse: days', function () {
    ;['saturday', 'on saturday only', 'just on saturday', 'saturdays'].forEach(function (text) {
        it(`parses "${text}" as day Saturday`, function () {
            const term = onlyTerm(text)
            term.kind.should.equal('day')
            term.days.should.eql([6])
            term.negate.should.be.false()
            lang.parse(text).description.should.equal('day is Saturday')
        })
    })

    it('parses "on the sabbath" as Saturday, described as sabbath', function () {
        const term = onlyTerm('on the sabbath')
        term.kind.should.equal('day')
        term.days.should.eql([6])
        lang.parse('on the sabbath').description.should.equal('day is Saturday (sabbath)')
    })

    it('fuzzy-corrects the typo "sabath" with a warning', function () {
        const r = lang.parse('sabath')
        r.ok.should.be.true()
        r.ast.groups[0].terms[0].days.should.eql([6])
        r.warnings.length.should.be.above(0)
        r.warnings[0].should.match(/sabbath/)
    })

    it('fuzzy-corrects "saterday"', function () {
        const r = lang.parse('saterday')
        r.ok.should.be.true()
        r.ast.groups[0].terms[0].days.should.eql([6])
    })

    it('parses "weekdays" as Monday to Friday', function () {
        const term = onlyTerm('weekdays')
        term.kind.should.equal('day')
        term.days.should.eql([1, 2, 3, 4, 5])
        lang.parse('weekdays').description.should.match(/weekday/i)
    })

    it('parses "on weekends"', function () {
        const term = onlyTerm('on weekends')
        term.days.should.eql([0, 6])
    })

    it('parses "monday to friday" as a day range', function () {
        const term = onlyTerm('monday to friday')
        term.days.should.eql([1, 2, 3, 4, 5])
        lang.parse('monday to friday').description.should.equal('day is Monday to Friday')
    })

    it('parses "mon-wed" as a day range', function () {
        const term = onlyTerm('mon-wed')
        term.days.should.eql([1, 2, 3])
    })

    it('parses wrap-around range "friday to monday"', function () {
        const term = onlyTerm('friday to monday')
        term.days.should.eql([0, 1, 5, 6])
    })

    it('coalesces "saturday and sunday" into one day set', function () {
        const term = onlyTerm('saturday and sunday')
        term.kind.should.equal('day')
        term.days.should.eql([0, 6])
        lang.parse('saturday and sunday').description.should.equal('day is Saturday or Sunday')
    })

    it('coalesces "saturday or sunday" into one day set', function () {
        const r = lang.parse('saturday or sunday')
        r.ast.groups.should.have.length(1)
        r.ast.groups[0].terms[0].days.should.eql([0, 6])
    })

    it('understands bare "sun" as Sunday in a list context ("sat and sun")', function () {
        const term = onlyTerm('sat and sun')
        term.days.should.eql([0, 6])
    })

    it('understands "sat-sun" as a range', function () {
        const term = onlyTerm('sat-sun')
        term.days.should.eql([0, 6])
    })

    it('parses "not on tuesday" as negated day', function () {
        const term = onlyTerm('not on tuesday')
        term.kind.should.equal('day')
        term.days.should.eql([2])
        term.negate.should.be.true()
        lang.parse('not on tuesday').description.should.equal('day is not Tuesday')
    })
})

describe('filter-lang parse: months and dates', function () {
    it('parses "in december"', function () {
        const term = onlyTerm('in december')
        term.kind.should.equal('month')
        term.months.should.eql([12])
        lang.parse('in december').description.should.equal('month is December')
    })

    it('parses "june to august" as a month range', function () {
        const term = onlyTerm('june to august')
        term.months.should.eql([6, 7, 8])
        lang.parse('june to august').description.should.equal('month is June to August')
    })

    it('parses wrap-around month range "november to february"', function () {
        const term = onlyTerm('november to february')
        term.months.should.eql([1, 2, 11, 12])
    })

    it('parses "on the 1st of the month"', function () {
        const term = onlyTerm('on the 1st of the month')
        term.kind.should.equal('dayOfMonth')
        term.days.should.eql([1])
    })

    it('parses "christmas day"', function () {
        const term = onlyTerm('christmas day')
        term.kind.should.equal('namedDate')
        term.month.should.equal(12)
        term.day.should.equal(25)
    })

    it('parses "new years day"', function () {
        const term = onlyTerm("new year's day")
        term.kind.should.equal('namedDate')
        term.month.should.equal(1)
        term.day.should.equal(1)
    })
})

describe('filter-lang parse: time ranges', function () {
    it('parses "weekdays between 9am and 5pm"', function () {
        const terms = onlyGroupTerms('weekdays between 9am and 5pm')
        terms.should.have.length(2)
        terms[0].kind.should.equal('day')
        terms[0].days.should.eql([1, 2, 3, 4, 5])
        terms[1].kind.should.equal('timeRange')
        terms[1].startMin.should.equal(540)
        terms[1].endMin.should.equal(1020)
    })

    it('parses overnight range "between 10pm and 6am"', function () {
        const term = onlyTerm('between 10pm and 6am')
        term.startMin.should.equal(1320)
        term.endMin.should.equal(360)
        lang.parse('between 10pm and 6am').description.should.match(/overnight/)
    })

    it('parses "before noon"', function () {
        const term = onlyTerm('before noon')
        term.kind.should.equal('timeRange')
        term.style.should.equal('before')
        term.endMin.should.equal(720)
        lang.parse('before noon').description.should.equal('time is before 12:00')
    })

    it('parses "after 10pm"', function () {
        const term = onlyTerm('after 10pm')
        term.style.should.equal('after')
        term.startMin.should.equal(1320)
    })

    it('parses "from 09:00 to 17:30"', function () {
        const term = onlyTerm('from 09:00 to 17:30')
        term.startMin.should.equal(540)
        term.endMin.should.equal(1050)
    })

    it('parses "at 9.30pm" (dot separator) as an exact-minute condition', function () {
        const term = onlyTerm('at 9.30pm')
        term.style.should.equal('at')
        term.startMin.should.equal(1290)
    })

    it('handles 12am and 12pm correctly', function () {
        onlyTerm('at 12am').startMin.should.equal(0)
        onlyTerm('at 12pm').startMin.should.equal(720)
    })

    it('bare "TIME to TIME" is a range (regression: "10pm to 6am" parsed as at-22:00 AND before-06:00)', function () {
        const term = onlyTerm('10pm to 6am')
        term.should.have.properties({ kind: 'timeRange', style: 'between', startMin: 1320, endMin: 360 })
        lang.parse('10pm to 6am').unmatched.should.have.length(0)
        onlyTerm('9am to 5pm').should.have.properties({ startMin: 540, endMin: 1020 })
        onlyTerm('9am - 5pm').should.have.properties({ startMin: 540, endMin: 1020 })
        onlyTerm('noon to 3pm').should.have.properties({ startMin: 720, endMin: 900 })
        onlyTerm('9am to 17').should.have.properties({ startMin: 540, endMin: 1020 })
        onlyTerm('at 10pm').style.should.equal('at') // bare time without a range word unchanged
    })
})

describe('filter-lang parse: solar', function () {
    ;['is night', 'at night', 'night'].forEach(function (text) {
        it(`parses "${text}" as the night state`, function () {
            const term = onlyTerm(text)
            term.kind.should.equal('solarState')
            term.states.should.eql(['night'])
        })
    })

    it('parses "after dark" as sun below civil twilight', function () {
        const term = onlyTerm('after dark')
        term.kind.should.equal('sunAltitude')
        term.op.should.equal('below')
        term.degrees.should.equal(-6)
    })

    it('parses "during daylight" as sun above horizon', function () {
        const term = onlyTerm('during daylight')
        term.kind.should.equal('sunAltitude')
        term.op.should.equal('above')
        term.degrees.should.equal(-0.833)
    })

    it('parses "sun rising" as rise direction', function () {
        const term = onlyTerm('sun rising')
        term.kind.should.equal('sunDirection')
        term.direction.should.equal('rise')
    })

    it('parses "the sun is setting"', function () {
        const term = onlyTerm('the sun is setting')
        term.kind.should.equal('sunDirection')
        term.direction.should.equal('fall')
    })

    it('parses "dawn" standalone as the rising-twilight state', function () {
        const term = onlyTerm('dawn')
        term.kind.should.equal('solarState')
        term.states.should.eql(['twilight'])
        term.direction.should.equal('rise')
    })

    it('parses "before dawn" as a solar event condition', function () {
        const term = onlyTerm('before dawn')
        term.kind.should.equal('solarEvent')
        term.event.should.equal('civilDawn')
        term.op.should.equal('before')
    })

    it('parses "after sunset"', function () {
        const term = onlyTerm('after sunset')
        term.kind.should.equal('solarEvent')
        term.event.should.equal('sunset')
        term.op.should.equal('after')
    })

    it('parses "within 30 minutes of sunrise"', function () {
        const term = onlyTerm('within 30 minutes of sunrise')
        term.kind.should.equal('solarEvent')
        term.event.should.equal('sunrise')
        term.op.should.equal('within')
        term.withinMin.should.equal(30)
    })

    it('parses "within 1 hour of solar noon"', function () {
        const term = onlyTerm('within 1 hour of solar noon')
        term.event.should.equal('solarNoon')
        term.withinMin.should.equal(60)
    })

    it('parses "between sunset and sunrise"', function () {
        const term = onlyTerm('between sunset and sunrise')
        term.kind.should.equal('solarBetween')
        term.from.should.equal('sunset')
        term.to.should.equal('sunrise')
    })

    it('parses "golden hour"', function () {
        const term = onlyTerm('golden hour')
        term.kind.should.equal('solarState')
        term.states.should.eql(['goldenHour'])
    })
})

describe('filter-lang parse: moon', function () {
    ;['when the moon is visible', 'moon visible', 'moon is up', 'moon above the horizon'].forEach(function (text) {
        it(`parses "${text}" as moon above horizon`, function () {
            const term = onlyTerm(text)
            term.kind.should.equal('moonAltitude')
            term.op.should.equal('above')
            term.degrees.should.equal(0)
        })
    })

    it('parses "full moon"', function () {
        const term = onlyTerm('full moon')
        term.kind.should.equal('moonPhase')
        term.phase.should.equal('full')
    })

    it('parses "new moon"', function () {
        onlyTerm('new moon').phase.should.equal('new')
    })

    it('parses "seasonal blue moon" distinctly from "blue moon"', function () {
        onlyTerm('seasonal blue moon').should.have.properties({ kind: 'moonPhase', phase: 'seasonalBlue' })
    })

    it('parses "blue moon" and its compositions with nothing ignored', function () {
        onlyTerm('blue moon').should.have.properties({ kind: 'moonPhase', phase: 'blue' })
        lang.parse('blue moon').description.should.equal('the moon is a blue moon (the second full moon of a calendar month)')
        lang.parse('blue moon at the weekend').unmatched.should.have.length(0)
        lang.parse('blue moon and within 30 minutes of sunset').unmatched.should.have.length(0)
    })

    it('parses "moon more than 50% illuminated"', function () {
        const term = onlyTerm('moon more than 50% illuminated')
        term.kind.should.equal('moonIllumination')
        term.op.should.equal('gt')
        term.fraction.should.equal(0.5)
    })

    it('parses "moon less than 25% illuminated"', function () {
        const term = onlyTerm('moon less than 25% illuminated')
        term.op.should.equal('lt')
        term.fraction.should.equal(0.25)
    })

    it('parses a bare percentage as at-least: "moon is 90% illuminated"', function () {
        const term = onlyTerm('moon is 90% illuminated')
        term.kind.should.equal('moonIllumination')
        term.op.should.equal('gte')
        term.fraction.should.equal(0.9)
        const r = lang.parse('moon is 90% illuminated')
        r.unmatched.should.have.length(0)
        r.description.should.equal('the moon is at least 90% illuminated')
    })

    it('parses "moon at least 90% illuminated" and "moon at most 20% illuminated"', function () {
        onlyTerm('moon at least 90% illuminated').op.should.equal('gt')
        onlyTerm('moon at most 20% illuminated').op.should.equal('lt')
    })
})

describe('filter-lang parse: combinators', function () {
    it('parses "on weekends or after sunset" as two OR groups', function () {
        const r = lang.parse('on weekends or after sunset')
        r.ok.should.be.true()
        r.ast.groups.should.have.length(2)
        r.ast.groups[0].terms[0].kind.should.equal('day')
        r.ast.groups[1].terms[0].kind.should.equal('solarEvent')
    })

    it('parses "on weekdays and during daylight" as one AND group', function () {
        const terms = onlyGroupTerms('on weekdays and during daylight')
        terms.should.have.length(2)
        terms[0].kind.should.equal('day')
        terms[1].kind.should.equal('sunAltitude')
    })

    it('distributes "except tuesday" into every OR group', function () {
        const r = lang.parse('weekends or evenings except tuesday')
        r.ok.should.be.true()
        r.ast.groups.should.have.length(2)
        r.ast.groups.forEach(function (g) {
            const ex = g.terms.filter(function (t) { return t.negate && t.kind === 'day' })
            ex.should.have.length(1)
            ex[0].days.should.eql([2])
        })
        r.description.should.match(/day is not Tuesday/)
    })

    it('supports "but not" as except', function () {
        const r = lang.parse('weekends but not sunday')
        r.ok.should.be.true()
        const g = r.ast.groups[0]
        g.terms.should.have.length(2)
        g.terms[1].negate.should.be.true()
        g.terms[1].days.should.eql([0])
    })

    it('parses "every day" as always-true', function () {
        const term = onlyTerm('every day')
        term.kind.should.equal('always')
        lang.parse('every day').description.should.equal('always')
    })
})

describe('filter-lang parse: last-day-of-month combinations', function () {
    it('"last day of the month except friday" ANDs a negated Friday', function () {
        const terms = onlyGroupTerms('last day of the month except friday')
        terms.should.have.length(2)
        terms[0].kind.should.equal('dayOfMonth')
        terms[0].last.should.be.true()
        terms[1].kind.should.equal('day')
        terms[1].days.should.eql([5])
        terms[1].negate.should.be.true()
    })

    it('"last day of the month is friday" ANDs a positive Friday', function () {
        const terms = onlyGroupTerms('last day of the month is friday')
        terms.should.have.length(2)
        terms[0].last.should.be.true()
        terms[1].days.should.eql([5])
        terms[1].negate.should.be.false()
    })

    it('"last day of the month is not wednesday" ANDs a negated Wednesday', function () {
        const terms = onlyGroupTerms('last day of the month is not wednesday')
        terms.should.have.length(2)
        terms[0].last.should.be.true()
        terms[1].days.should.eql([3])
        terms[1].negate.should.be.true()
    })
})

describe('filter-lang parse: years', function () {
    it('parses a bare year and "in <year>"', function () {
        onlyTerm('2027').should.have.properties({ kind: 'year' })
        onlyTerm('in 2027').years.should.eql([2027])
        lang.parse('in 2027').description.should.equal('year is 2027')
    })

    it('parses a year range', function () {
        onlyTerm('2027 to 2029').years.should.eql([2027, 2028, 2029])
        lang.parse('2027 to 2029').description.should.equal('year is 2027 to 2029')
    })

    it('parses "january 2027" as month AND year', function () {
        const terms = onlyGroupTerms('january 2027')
        terms.should.have.length(2)
        terms[0].kind.should.equal('month')
        terms[0].months.should.eql([1])
        terms[1].kind.should.equal('year')
        terms[1].years.should.eql([2027])
    })

    it('parses "1st monday of the year" with year scope', function () {
        const term = onlyTerm('1st monday of the year')
        term.kind.should.equal('nthWeekday')
        term.nth.should.equal(1)
        term.day.should.equal(1)
        term.scope.should.equal('year')
    })

    it('parses "2nd tuesday of 2028" with a specific year', function () {
        const term = onlyTerm('2nd tuesday of 2028')
        term.scope.should.equal('year')
        term.year.should.equal(2028)
        term.day.should.equal(2)
        term.nth.should.equal(2)
        lang.parse('2nd tuesday of 2028').description.should.equal('day is the second Tuesday of 2028')
    })

    it('parses "first monday of january [2027]" scoped to a month', function () {
        const term = onlyTerm('first monday of january')
        term.month.should.equal(1)
        should.not.exist(term.year)
        onlyTerm('first monday of january 2027').year.should.equal(2027)
    })

    it('parses "last month of the year" as December (regression: mis-read as last day of month)', function () {
        const term = onlyTerm('last month of the year')
        term.kind.should.equal('month')
        term.months.should.eql([12])
        lang.parse('last month of the year').description.should.equal('month is December')
        onlyTerm('first month of the year').months.should.eql([1])
        onlyTerm('2nd month of the year').months.should.eql([2])
        lang.parse('last month').ok.should.be.false() // "the previous month" - too ambiguous
    })

    it('parses "1st day of the month" with no leftover words', function () {
        const r = lang.parse('1st day of the month')
        r.ast.groups[0].terms[0].should.have.properties({ kind: 'dayOfMonth' })
        r.ast.groups[0].terms[0].days.should.eql([1])
        r.unmatched.should.have.length(0)
    })

    it('parses month-scoped ordinal days: "last day of jan", "3rd day of february"', function () {
        const term = onlyTerm('last day of jan')
        term.should.have.properties({ kind: 'dayOfMonth', last: true, month: 1 })
        lang.parse('last day of jan').description.should.equal('day is the last day of January')
        lang.parse('last day in jan').unmatched.should.have.length(0) // 'in' variant
        onlyTerm('3rd day of february').should.have.properties({ kind: 'dayOfMonth', month: 2 })
        onlyTerm('3rd day of february').days.should.eql([3])
        onlyTerm('last day of january 2027').year.should.equal(2027)
    })

    it('parses year-scoped ordinal days: "last day of 2027"', function () {
        const term = onlyTerm('last day of 2027')
        term.should.have.properties({ kind: 'namedDate', month: 12, day: 31, year: 2027 })
        onlyTerm('first day of 2027').should.have.properties({ month: 1, day: 1, year: 2027 })
    })

    it('parses ordinal weeks: "last week of 2027", "first week of the month", "2nd week of january"', function () {
        onlyTerm('last week of 2027').should.have.properties({ kind: 'ordinalWeek', nth: 'last', scope: 'year', year: 2027 })
        onlyTerm('first week of the month').should.have.properties({ kind: 'ordinalWeek', nth: 1, scope: 'month' })
        onlyTerm('2nd week of january').should.have.properties({ kind: 'ordinalWeek', nth: 2, month: 1 })
        onlyTerm('23rd week of 2027').nth.should.equal(23)
        lang.parse('last week of 2027').unmatched.should.have.length(0)
        lang.parse('last week').ok.should.be.false() // "the previous week" - too ambiguous
    })

    it('parses "last month of 2027" as December 2027', function () {
        const term = onlyTerm('last month of 2027')
        term.should.have.properties({ kind: 'month', year: 2027 })
        term.months.should.eql([12])
        lang.parse('last month of 2027').description.should.equal('month is December 2027')
    })

    it('parses "first/last day of the year" as fixed dates', function () {
        const first = onlyTerm('first day of the year')
        first.kind.should.equal('namedDate')
        first.month.should.equal(1)
        first.day.should.equal(1)
        const last = onlyTerm('last day of the year')
        last.month.should.equal(12)
        last.day.should.equal(31)
    })
})

describe('filter-lang parse: even/odd', function () {
    it('parses "when day is odd" as day-of-month parity', function () {
        const term = onlyTerm('when day is odd')
        term.kind.should.equal('parity')
        term.unit.should.equal('day')
        term.parity.should.equal('odd')
        lang.parse('when day is odd').description.should.equal('the day of the month is odd')
    })

    it('parses "odd days", "on even months", "on even years"', function () {
        onlyTerm('odd days').should.have.properties({ kind: 'parity', unit: 'day', parity: 'odd' })
        onlyTerm('on even months').should.have.properties({ kind: 'parity', unit: 'month', parity: 'even' })
        onlyTerm('on even years').should.have.properties({ kind: 'parity', unit: 'year', parity: 'even' })
    })

    it('parses trailing parity: "month is even", "year is odd"', function () {
        onlyTerm('month is even').should.have.properties({ kind: 'parity', unit: 'month', parity: 'even' })
        onlyTerm('year is odd').should.have.properties({ kind: 'parity', unit: 'year', parity: 'odd' })
    })

    it('does not break "christmas eve" (even/eve are distinct words)', function () {
        onlyTerm('christmas eve').kind.should.equal('namedDate')
    })
})

describe('filter-lang summarize', function () {
    it('categorises terms per alternative with negation separated', function () {
        const r = lang.parse('weekdays between 9am and 5pm except tuesday')
        const alts = lang.summarize(r.ast)
        alts.should.have.length(1)
        const facets = alts[0].facets
        facets.some(function (f) { return f.category === 'Days' && !f.negate }).should.be.true()
        facets.some(function (f) { return f.category === 'Times' && !f.negate }).should.be.true()
        facets.some(function (f) { return f.category === 'Days' && f.negate }).should.be.true()
    })

    it('marks sun/moon facets as requiring a location', function () {
        const alts = lang.summarize(lang.parse('after sunset or full moon').ast)
        const flat = alts.reduce(function (acc, a) { return acc.concat(a.facets) }, [])
        flat.find(function (f) { return f.category === 'Sun' }).requiresLocation.should.be.true()
        flat.find(function (f) { return f.category === 'Moon' }).requiresLocation.should.be.false() // moon phase needs no location
    })
})

describe('filter-lang parse: sun/moon position', function () {
    it('parses "sun is between 10 and 12 degrees"', function () {
        const term = onlyTerm('sun is between 10 and 12 degrees')
        term.kind.should.equal('sunAltitude')
        term.op.should.equal('between')
        term.low.should.equal(10)
        term.high.should.equal(12)
        lang.parse('sun is between 10 and 12 degrees').description.should.equal('sun altitude is between 10 and 12 degrees')
    })

    it('parses "sun above 30 degrees" and "moon below -5 degrees"', function () {
        onlyTerm('sun above 30 degrees').should.have.properties({ kind: 'sunAltitude', op: 'above', degrees: 30 })
        onlyTerm('moon below -5 degrees').should.have.properties({ kind: 'moonAltitude', op: 'below', degrees: -5 })
    })

    it('parses negative between range "sun is between -6 and 0 degrees"', function () {
        const term = onlyTerm('sun is between -6 and 0 degrees')
        term.low.should.equal(-6)
        term.high.should.equal(0)
    })

    it('parses "sun is high", "sun is low", "moon is high", "moon is low"', function () {
        onlyTerm('sun is high').should.have.properties({ kind: 'sunAltitude', op: 'above', degrees: 45 })
        onlyTerm('the sun is low').should.have.properties({ kind: 'sunAltitude', op: 'between', low: 0, high: 15 })
        onlyTerm('moon is high').should.have.properties({ kind: 'moonAltitude', op: 'above', degrees: 45 })
        onlyTerm('moon is low').should.have.properties({ kind: 'moonAltitude', op: 'between', low: 0, high: 15 })
        lang.parse('sun is low').description.should.equal('the sun is low (between 0 and 15 degrees)')
        lang.parse('moon is high').description.should.equal('the moon is high (above 45 degrees)')
    })

    it('moon illumination percent still wins over altitude', function () {
        onlyTerm('moon more than 50% illuminated').kind.should.equal('moonIllumination')
        onlyTerm('moon more than 20 degrees').should.have.properties({ kind: 'moonAltitude', op: 'above', degrees: 20 })
    })

    it('bare "sun" in day context is still Sunday', function () {
        onlyTerm('sat and sun').days.should.eql([0, 6])
        onlyTerm('sun above horizon').kind.should.equal('sunAltitude') // phrase unchanged
    })
})

describe('filter-lang parse: minute of the hour', function () {
    it('parses "between 15 minutes and 30 minutes past the hour"', function () {
        const term = onlyTerm('between 15 minutes and 30 minutes past the hour')
        term.kind.should.equal('minuteOfHour')
        term.style.should.equal('between')
        term.startMin.should.equal(15)
        term.endMin.should.equal(30)
    })

    it('parses "from 0 minutes to 10 minutes"', function () {
        const term = onlyTerm('from 0 minutes to 10 minutes')
        term.startMin.should.equal(0)
        term.endMin.should.equal(10)
    })

    it('parses "quarter past", "half past", "quarter to"', function () {
        onlyTerm('quarter past').should.have.properties({ kind: 'minuteOfHour', startMin: 15 })
        onlyTerm('half past').should.have.properties({ kind: 'minuteOfHour', startMin: 30 })
        onlyTerm('quarter to').should.have.properties({ kind: 'minuteOfHour', startMin: 45 })
    })

    it('parses "ten past", "5 to", "15 minutes past the hour"', function () {
        onlyTerm('ten past').should.have.properties({ kind: 'minuteOfHour', startMin: 10 })
        onlyTerm('5 to').should.have.properties({ kind: 'minuteOfHour', startMin: 55 })
        onlyTerm('15 minutes past the hour').should.have.properties({ kind: 'minuteOfHour', startMin: 15 })
    })

    it('anchors to a clock time when an hour follows: "quarter past five", "quarter to five"', function () {
        onlyTerm('quarter past five').should.have.properties({ kind: 'timeRange', style: 'at', startMin: 315 }) // 05:15
        onlyTerm('quarter to five').should.have.properties({ kind: 'timeRange', style: 'at', startMin: 285 }) // 04:45
        onlyTerm('half past ten').startMin.should.equal(630) // 10:30
        onlyTerm('quarter past 5pm').startMin.should.equal(1035) // 17:15
        onlyTerm('ten past ten').startMin.should.equal(610) // 10:10
    })

    it('does not steal date ranges: "monday to friday" and "2027 to 2029" still work', function () {
        onlyTerm('monday to friday').kind.should.equal('day')
        onlyTerm('2027 to 2029').kind.should.equal('year')
    })

    it('supports before/after minute-of-hour: "before quarter to the hour", "after 10 past"', function () {
        const before = onlyTerm('before quarter to the hour')
        before.should.have.properties({ kind: 'minuteOfHour', style: 'before', startMin: 45 })
        lang.parse('before quarter to the hour').unmatched.should.have.length(0)
        onlyTerm('after quarter past').should.have.properties({ kind: 'minuteOfHour', style: 'after', startMin: 15 })
        onlyTerm('after 10 past the hour').should.have.properties({ kind: 'minuteOfHour', style: 'after', startMin: 10 })
        onlyTerm('before 20 past').should.have.properties({ kind: 'minuteOfHour', style: 'before', startMin: 20 })
    })

    it('before/after an anchored minute phrase becomes a clock-time bound', function () {
        onlyTerm('before quarter past five').should.have.properties({ kind: 'timeRange', style: 'before', endMin: 315 })
        onlyTerm('after half past ten').should.have.properties({ kind: 'timeRange', style: 'after', startMin: 630 })
    })

    it('leading "until"/"till" reads as before: "until 6pm", "till sunset"', function () {
        onlyTerm('until 6pm').should.have.properties({ kind: 'timeRange', style: 'before', endMin: 1080 })
        onlyTerm('till sunset').should.have.properties({ kind: 'solarEvent', event: 'sunset', op: 'before' })
        const r = lang.parse('last day in 2026 after 6pm and 1st day in 2027 until 6pm')
        r.unmatched.should.have.length(0)
        r.ast.groups[0].terms.should.have.length(4)
        onlyTerm('monday until friday').days.should.eql([1, 2, 3, 4, 5]) // range joiner unchanged
    })

    it('"before/until midnight" means the end of the day, not 00:00', function () {
        onlyTerm('before midnight').endMin.should.equal(1440)
        onlyTerm('until midnight').endMin.should.equal(1440)
        lang.parse('until midnight').description.should.equal('time is before midnight')
    })

    it('word numbers anchor spoken times; ambiguous digit "9 to 5" is rejected, not misread', function () {
        onlyTerm('five to nine').should.have.properties({ kind: 'timeRange', style: 'at', startMin: 535 }) // 08:55
        onlyTerm('twenty five past eight').startMin.should.equal(505) // 08:25
        onlyTerm('5 minutes to 9').startMin.should.equal(535) // explicit unit also allowed
        onlyTerm('one hour after sunset').offsetMin.should.equal(60)
        lang.parse('9 to 5').ok.should.be.false() // means working hours to most people - fail honestly
    })
})

describe('filter-lang parse: decimal numbers', function () {
    it('parses float degrees: "sun is between 43.2 and 80.5 deg"', function () {
        const term = onlyTerm('sun is between 43.2 and 80.5 deg')
        term.low.should.equal(43.2)
        term.high.should.equal(80.5)
        lang.parse('sun is between 43.2 and 80.5 deg').unmatched.should.have.length(0)
    })

    it('parses "moon above 12.5 degrees" and negative floats', function () {
        onlyTerm('moon above 12.5 degrees').degrees.should.equal(12.5)
        onlyTerm('sun below -6.5 degrees').degrees.should.equal(-6.5)
    })

    it('parses float percentages and durations', function () {
        onlyTerm('moon more than 62.5% illuminated').fraction.should.equal(0.625)
        onlyTerm('1.5 hours after sunset').offsetMin.should.equal(90)
        onlyTerm('within 1.5 hours of sunrise').withinMin.should.equal(90)
    })

    it('rejects fractions where whole units are required', function () {
        lang.parse('quarter past 5.5').ast.groups[0].terms[0].kind.should.equal('minuteOfHour') // 5.5 not taken as an hour anchor
        onlyTerm('in 2027').kind.should.equal('year')
        lang.parse('in 2027.5').ok.should.be.false() // not a year, not anything else
    })
})

describe('filter-lang parse: parentheses and precedence', function () {
    it('distributes "(A or B) and C" so C applies to both alternatives', function () {
        const r = lang.parse('(last day of the month or wednesday) and time is after 10pm')
        r.ok.should.be.true()
        r.ast.groups.should.have.length(2)
        r.ast.groups.forEach(function (g) {
            g.terms.some(function (t) { return t.kind === 'timeRange' && t.startMin === 1320 }).should.be.true()
        })
        r.description.should.equal('(day is the last day of the month, or day is Wednesday) and time is after 22:00')
    })

    it('without brackets, AND binds tighter and the description shows it', function () {
        const r = lang.parse('last day of the month or wednesday and time is after 10pm')
        r.ok.should.be.true()
        r.ast.groups.should.have.length(2)
        r.ast.groups[0].terms.should.have.length(1) // last day of month alone
        r.ast.groups[1].terms.should.have.length(2) // wednesday AND time
        r.description.should.equal('day is the last day of the month, or (day is Wednesday and time is after 22:00)')
    })

    it('brackets on both sides distribute fully', function () {
        const r = lang.parse('(mon or wed) and (before noon or after 8pm)')
        r.ok.should.be.true()
        // day terms coalesce within each row, time alternatives stay separate
        r.ast.groups.should.have.length(2)
        r.ast.groups.forEach(function (g) {
            g.terms.some(function (t) { return t.kind === 'day' }).should.be.true()
            g.terms.some(function (t) { return t.kind === 'timeRange' }).should.be.true()
        })
    })

    it('negates a bracketed group with De Morgan: not (saturday or sunday)', function () {
        const r = lang.parse('not (saturday or sunday)')
        r.ok.should.be.true()
        r.ast.groups.should.have.length(1)
        const term = r.ast.groups[0].terms[0]
        term.kind.should.equal('day')
        term.negate.should.be.true()
        term.days.should.eql([0, 6])
    })

    it('except still applies to the whole condition alongside brackets', function () {
        const r = lang.parse('(weekends or evenings) except tuesday')
        r.ok.should.be.true()
        r.ast.groups.should.have.length(2)
        r.ast.groups.forEach(function (g) {
            g.terms.some(function (t) { return t.negate && t.kind === 'day' && t.days[0] === 2 }).should.be.true()
        })
    })

    it('tolerates unbalanced brackets', function () {
        lang.parse('(saturday').ok.should.be.true()
        lang.parse('saturday)').ok.should.be.true()
        lang.parse('saturday) or sunday').ast.groups[0].terms[0].days.should.eql([0, 6])
        lang.parse('()').ok.should.be.false()
    })
})

describe('filter-lang parse: failures and partial matches', function () {
    it('rejects gibberish with a helpful suggestion', function () {
        const r = lang.parse('flurble quickly')
        r.ok.should.be.false()
        r.suggestion.should.match(/Try phrases like/)
        r.suggestion.should.match(/flurble/)
    })

    it('rejects empty input', function () {
        lang.parse('').ok.should.be.false()
        lang.parse(null).ok.should.be.false()
    })

    it('keeps going past an unknown word ("saturday flurble")', function () {
        const r = lang.parse('saturday flurble')
        r.ok.should.be.true()
        r.ast.groups[0].terms[0].days.should.eql([6])
        r.unmatched.should.containEql('flurble')
        r.warnings.some(function (w) { return /flurble/.test(w) }).should.be.true()
    })
})

describe('filter-lang failure suggestions', function () {
    it('every suggestion-corpus example parses cleanly (they are shown to users as known-good)', function () {
        lang._internal.SUGGESTION_EXAMPLES.forEach(function (example) {
            const r = lang.parse(example)
            r.ok.should.be.true('corpus example does not parse: "' + example + '" - ' + r.suggestion)
            r.unmatched.should.have.length(0, 'corpus example has ignored words: "' + example + '"')
        })
    })

    it('offers near matches for partially-recognised input ("last days")', function () {
        const r = lang.parse('last days')
        r.ok.should.be.false()
        r.suggestions.length.should.be.above(0)
        r.suggestions.some(function (s) { return /last day/.test(s) }).should.be.true()
        r.suggestion.should.match(/Did you mean/)
    })

    it('offers topic matches ("moon" input suggests moon examples)', function () {
        const suggestions = lang._internal.suggestExamples('moon glow shine')
        suggestions.length.should.be.above(0)
        suggestions.every(function (s) { return /moon/.test(s) }).should.be.true()
    })

    it('falls back to the generic hint for total gibberish', function () {
        const r = lang.parse('xyzzy blorp')
        r.suggestions.should.have.length(0)
        r.suggestion.should.match(/Try phrases like/)
    })

    it('successful parses carry an empty suggestions array', function () {
        lang.parse('on saturdays').suggestions.should.have.length(0)
    })

    it('typo-corrects words whose correct form ends in s (regression: "cristmas")', function () {
        const r = lang.parse('cristmas')
        r.ok.should.be.true()
        r.ast.groups[0].terms[0].should.have.properties({ kind: 'namedDate', month: 12, day: 25 })
        r.warnings[0].should.match(/assumed 'christmas'/)
    })
})

describe('filter-lang requiresLocation', function () {
    it('is false for pure calendar/time conditions', function () {
        lang.requiresLocation(lang.parse('weekdays between 9am and 5pm').ast).should.be.false()
        lang.requiresLocation(lang.parse('every day').ast).should.be.false()
    })

    it('is true for solar and moon-altitude conditions', function () {
        lang.requiresLocation(lang.parse('after sunset').ast).should.be.true()
        lang.requiresLocation(lang.parse('is night').ast).should.be.true()
        lang.requiresLocation(lang.parse('when the moon is visible').ast).should.be.true()
    })

    it('is false for moon phase (no location needed)', function () {
        lang.requiresLocation(lang.parse('full moon').ast).should.be.false()
    })
})

describe('filter-lang parse: ordinal days (nth weekday, day of week/month)', function () {
    it('parses "first monday of the month"', function () {
        const term = onlyTerm('first monday of the month')
        term.kind.should.equal('nthWeekday')
        term.nth.should.equal(1)
        term.day.should.equal(1)
        lang.parse('first monday of the month').description.should.equal('day is the first Monday of the month')
    })

    it('parses "third tuesday of month"', function () {
        const term = onlyTerm('third tuesday of month')
        term.nth.should.equal(3)
        term.day.should.equal(2)
    })

    it('parses "3rd tuesday of the month" (numeric ordinal)', function () {
        const term = onlyTerm('3rd tuesday of the month')
        term.kind.should.equal('nthWeekday')
        term.nth.should.equal(3)
        term.day.should.equal(2)
    })

    it('parses "last friday of the month"', function () {
        const term = onlyTerm('last friday of the month')
        term.kind.should.equal('nthWeekday')
        term.nth.should.equal('last')
        term.day.should.equal(5)
        lang.parse('last friday of the month').description.should.equal('day is the last Friday of the month')
    })

    it('parses "last day of the month"', function () {
        const term = onlyTerm('last day of the month')
        term.kind.should.equal('dayOfMonth')
        term.last.should.be.true()
        lang.parse('last day of the month').description.should.equal('day is the last day of the month')
    })

    it('parses "first day of the month"', function () {
        const term = onlyTerm('first day of the month')
        term.kind.should.equal('dayOfMonth')
        term.days.should.eql([1])
    })

    it('parses "last day of the week" as Sunday (ISO, documented)', function () {
        const term = onlyTerm('last day of the week')
        term.kind.should.equal('day')
        term.days.should.eql([0])
        lang.parse('last day of the week').description.should.match(/Sunday.*last day of the week.*ISO 8601 weeks start on Monday/)
    })

    it('parses "first day of the week" as Monday', function () {
        onlyTerm('first day of the week').days.should.eql([1])
    })

    it('counts from the end: "2nd last day of month" (regression: parsed as day-2 AND last-day)', function () {
        const term = onlyTerm('2nd last day of month')
        term.should.have.properties({ kind: 'dayOfMonth', last: true, lastOffset: 1 })
        lang.parse('2nd last day of month').description.should.equal('day is the 2nd last day of the month')
        onlyTerm('second last day of the month').lastOffset.should.equal(1)
        onlyTerm('2nd last friday of the month').should.have.properties({ kind: 'nthWeekday', nth: 'last', fromEnd: 2 })
        onlyTerm('2nd last month of the year').months.should.eql([11])
    })

    it('counts of days from either end: "last 2 days of feb", "first 3 days of march"', function () {
        onlyTerm('last 2 days of feb').should.have.properties({ kind: 'dayOfMonth', lastCount: 2, month: 2 })
        onlyTerm('first 3 days of march').should.have.properties({ kind: 'dayOfMonth', firstCount: 3, month: 3 })
        onlyTerm('last 5 days of the year').should.have.properties({ lastCount: 5, scope: 'year' })
        onlyTerm('last 3 days of 2027').should.have.properties({ lastCount: 3, scope: 'year', year: 2027 })
        onlyTerm('last 2 weeks of the year').lastCount.should.equal(14)
        onlyTerm('first 3 months of the year').months.should.eql([1, 2, 3])
        lang.parse('last 2 days of feb').description.should.equal('day is in the last 2 days of February')
        lang.parse('last 2 days').ok.should.be.false() // "the previous two days" - too ambiguous
    })

    it('offsets anchor on date-like sub-conditions, not just named dates', function () {
        onlyTerm('day before the last day of month').should.have.properties({ kind: 'dayOfMonth', last: true, lastOffset: 1 })
        onlyTerm('2 days before the last day of month').lastOffset.should.equal(2)
        onlyTerm('day after the last day of month').days.should.eql([1]) // 1st of the next month
        onlyTerm('2 days after the last day of month').days.should.eql([2])
        onlyTerm('2 days after last day of january').should.have.properties({ kind: 'dayOfMonth', month: 2 })
        onlyTerm('day before blue moon').should.have.properties({ kind: 'moonPhase', phase: 'blue', offsetDays: -1 })
        onlyTerm('2 days after full moon').offsetDays.should.equal(2)
        onlyTerm('2 days before friday').days.should.eql([3]) // Wednesday
        onlyTerm('2 hours before noon').should.have.properties({ kind: 'timeRange', style: 'before', endMin: 600 })
        onlyTerm('2 days before the 15th of the month').days.should.eql([13])
    })

    it('does not set-union flagged terms with plain day terms', function () {
        const terms = lang.parse('monday or last day of the week').ast.groups
        // stays as two OR groups (or one group per term) - never merged into one day set
        const flat = terms.reduce(function (acc, g) { return acc.concat(g.terms) }, [])
        flat.should.have.length(2)
        flat.some(function (t) { return t.weekOrdinal === 'last' }).should.be.true()
    })

    it('"first quarter moon" still wins over the ordinal word', function () {
        onlyTerm('first quarter moon').kind.should.equal('moonPhase')
    })
})

describe('filter-lang parse: date offsets (eve, day before/after, N units before/after)', function () {
    it('parses "christmas eve" as 24 December', function () {
        const term = onlyTerm('christmas eve')
        term.kind.should.equal('namedDate')
        term.month.should.equal(12)
        term.day.should.equal(25)
        term.offsetDays.should.equal(-1)
        lang.parse('christmas eve').description.should.equal('date is 24 December (christmas eve)')
    })

    it('parses "new years eve" as 31 December (wraps the year)', function () {
        const term = onlyTerm("new year's eve")
        term.month.should.equal(1)
        term.day.should.equal(1)
        term.offsetDays.should.equal(-1)
        lang.parse('new years eve').description.should.equal('date is 31 December (new years eve)')
    })

    it('parses "day before christmas"', function () {
        const term = onlyTerm('day before christmas')
        term.kind.should.equal('namedDate')
        term.offsetDays.should.equal(-1)
        lang.parse('the day before christmas').description.should.equal('date is 24 December (christmas)')
    })

    it('parses "day after christmas"', function () {
        onlyTerm('day after christmas').offsetDays.should.equal(1)
        lang.parse('day after christmas').description.should.equal('date is 26 December (christmas)')
    })

    it('parses "4 days after christmas"', function () {
        const term = onlyTerm('4 days after christmas')
        term.offsetDays.should.equal(4)
        lang.parse('4 days after christmas').description.should.equal('date is 29 December (christmas)')
    })

    it('parses "2 weeks before christmas"', function () {
        onlyTerm('2 weeks before christmas').offsetDays.should.equal(-14)
        lang.parse('2 weeks before christmas').description.should.equal('date is 11 December (christmas)')
    })

    it('parses "1 month before christmas"', function () {
        const term = onlyTerm('1 month before christmas')
        term.offsetMonths.should.equal(-1)
        lang.parse('1 month before christmas').description.should.equal('date is 25 November (christmas)')
    })

    it('parses "1 month after halloween" with day clamping (Nov 31 -> Nov 30)', function () {
        const term = onlyTerm('1 month after halloween')
        term.offsetMonths.should.equal(1)
        lang.parse('1 month after halloween').description.should.equal('date is 30 November (halloween)')
    })

    it('parses "within 2 days of christmas"', function () {
        const term = onlyTerm('within 2 days of christmas')
        term.kind.should.equal('namedDate')
        term.withinDays.should.equal(2)
        lang.parse('within 2 days of christmas').description.should.match(/within 2 days of 25 December/)
    })

    it('degrades "day before noon" to the plain time condition with a warning', function () {
        const r = lang.parse('day before noon')
        r.ok.should.be.true()
        r.ast.groups[0].terms.should.have.length(1)
        r.ast.groups[0].terms[0].kind.should.equal('timeRange')
        r.ast.groups[0].terms[0].endMin.should.equal(720)
        r.unmatched.length.should.be.above(0)
    })
})

describe('filter-lang parse: solar event offsets', function () {
    it('parses "2 hours after sunset"', function () {
        const term = onlyTerm('2 hours after sunset')
        term.kind.should.equal('solarEvent')
        term.event.should.equal('sunset')
        term.op.should.equal('after')
        term.offsetMin.should.equal(120)
        lang.parse('2 hours after sunset').description.should.equal('more than 2 hours after sunset')
    })

    it('parses "30 minutes before sunrise"', function () {
        const term = onlyTerm('30 minutes before sunrise')
        term.op.should.equal('before')
        term.offsetMin.should.equal(30)
        lang.parse('30 minutes before sunrise').description.should.equal('more than 30 minutes before sunrise')
    })

    it('plain "after sunset" is unchanged (no offset)', function () {
        const term = onlyTerm('after sunset')
        should.not.exist(term.offsetMin)
    })
})

describe('filter-lang parse: termination (regression: parse("first") hung the editor)', function () {
    // Words that only exist inside multi-word phrases (e.g. 'first' from
    // "first quarter moon") fuzzy-match themselves without ever resolving to a
    // symbol, which used to loop forever in matchSymbols. Every vocabulary word
    // must parse to completion on its own - this sweep keeps that true as the
    // vocabulary grows. The per-test timeout turns a future hang into a failure.
    it('every vocabulary word parses to completion standalone', { timeout: 10000 }, function () {
        const words = new Set(['first', 'last', 'quarter', 'horizon', 'least', 'than', 'solar', 'above', 'below', 'business'])
        lang._internal.PHRASES.forEach(function (p) { p.words.forEach(function (w) { words.add(w) }) })
        Object.keys(lang._internal.DAY_WORDS).forEach(function (w) { words.add(w) })
        Object.keys(lang._internal.DAY_SETS).forEach(function (w) { words.add(w) })
        Object.keys(lang._internal.MONTH_WORDS).forEach(function (w) { words.add(w) })
        words.forEach(function (word) {
            const r = lang.parse(word) // must return, ok either way
            r.should.have.property('ok')
        })
    })

    it('a typo that corrects to a phrase-only word terminates as unmatched ("frist")', { timeout: 5000 }, function () {
        const r = lang.parse('frist')
        r.ok.should.be.false()
    })

    it('phrase-only words still work inside their phrases', function () {
        onlyTerm('first quarter moon').phase.should.equal('firstQuarter')
        onlyTerm('moon above the horizon').kind.should.equal('moonAltitude')
        onlyTerm('within 1 hour of solar noon').event.should.equal('solarNoon')
    })

    it('real typos still fuzzy-correct after the loop guard', function () {
        const r = lang.parse('saterday')
        r.ok.should.be.true()
        r.ast.groups[0].terms[0].days.should.eql([6])
        r.warnings[0].should.match(/assumed 'saturday'/)
    })
})

describe('filter-lang internals', function () {
    it('editDistanceLE1 basics', function () {
        lang._internal.editDistanceLE1('sabbath', 'sabath').should.equal(1) // deletion
        lang._internal.editDistanceLE1('wednesday', 'wedensday').should.equal(1) // transposition
        lang._internal.editDistanceLE1('monday', 'friday').should.equal(2)
    })

    it('toMinutes handles am/pm and 24h', function () {
        lang._internal.toMinutes(9, 0, 'am').should.equal(540)
        lang._internal.toMinutes(9, 30, 'pm').should.equal(1290)
        lang._internal.toMinutes(12, 0, 'am').should.equal(0)
        lang._internal.toMinutes(12, 0, 'pm').should.equal(720)
        lang._internal.toMinutes(17, 30, undefined).should.equal(1050)
    })
})
