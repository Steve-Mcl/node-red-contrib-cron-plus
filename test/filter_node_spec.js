/// <reference types="should" />
// Integration tests for the cronplus-filter node (node-red-node-test-helper).
// Time-sensitive tests inject msg.ts explicitly so no fake timers are needed.
const should = require('should')
const sinon = require('sinon')
const helper = require('node-red-node-test-helper')
const SunCalc = require('suncalc')
const filterNode = require('../cronplus-filter.js')
const cronplusNode = require('../cronplus.js')
const { describe, it, beforeEach, afterEach, after } = require('node:test')

helper.init(require.resolve('node-red'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// see test1_spec.js - align so every-second cron schedules fire predictably
const alignToSecondBoundary = () => sleep(1050 - (Date.now() % 1000))

after(() => {
    // node-red-node-test-helper leaves handles open after stopServer (mocha needed --exit
    // for the same reason). Node 18 has no --test-force-exit, so exit once the run has
    // settled; unref'd so it never delays a clean exit, process.exitCode preserves failures.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1000).unref()
})

// 2026-06-20 was a Saturday, 2026-06-24 a Wednesday
const SATURDAY_NOON = Date.parse('2026-06-20T12:00:00Z')
const WEDNESDAY_NOON = Date.parse('2026-06-24T12:00:00Z')

function filterFlow (conditionOrProps) {
    const props = typeof conditionOrProps === 'string' ? { condition: conditionOrProps } : conditionOrProps
    return [
        Object.assign({ id: 'f1', type: 'cronplus-filter', name: 'test filter', condition: '', location: '', locationType: 'none', timeZone: 'UTC', wires: [['h-pass'], ['h-block']] }, props),
        { id: 'h-pass', type: 'helper' },
        { id: 'h-block', type: 'helper' }
    ]
}

describe('cronplus-filter Node', function () {
    'use strict'

    beforeEach((t, done) => { helper.startServer(done) })

    afterEach((t, done) => {
        helper.unload().then(() => {
            helper.stopServer(done)
        })
    })

    it('loads with expected properties', function (t, done) {
        helper.load(filterNode, filterFlow('on saturdays'), function () {
            try {
                const f1 = helper.getNode('f1')
                should.exist(f1)
                f1.should.have.property('condition', 'on saturdays')
                f1.should.have.property('conditionType', 'str')
                done()
            } catch (err) {
                done(err)
            }
        })
    })

    it('routes a matching message to output 1 with msg.filter attached', function (t, done) {
        helper.load(filterNode, filterFlow('on saturdays'), function () {
            const f1 = helper.getNode('f1')
            const pass = helper.getNode('h-pass')
            const block = helper.getNode('h-block')
            block.on('input', function () { done(new Error('message must not arrive on the blocked output')) })
            pass.on('input', function (msg) {
                try {
                    msg.should.have.property('filter')
                    msg.filter.pass.should.be.true()
                    msg.filter.condition.should.equal('on saturdays')
                    msg.filter.description.should.equal('day is Saturday')
                    msg.filter.ts.should.equal(SATURDAY_NOON)
                    msg.filter.reasons.should.be.an.Array()
                    msg.payload.should.equal('hello') // original message untouched
                    done()
                } catch (err) {
                    done(err)
                }
            })
            f1.receive({ payload: 'hello', ts: SATURDAY_NOON })
        })
    })

    it('routes a non-matching message to output 2 only', function (t, done) {
        helper.load(filterNode, filterFlow('on saturdays'), function () {
            const f1 = helper.getNode('f1')
            const pass = helper.getNode('h-pass')
            const block = helper.getNode('h-block')
            pass.on('input', function () { done(new Error('message must not arrive on the allowed output')) })
            block.on('input', function (msg) {
                try {
                    msg.filter.pass.should.be.false()
                    done()
                } catch (err) {
                    done(err)
                }
            })
            f1.receive({ payload: 'hello', ts: WEDNESDAY_NOON })
        })
    })

    it('prefers msg.ts over msg.cronplus.triggerTimestamp', function (t, done) {
        helper.load(filterNode, filterFlow('on saturdays'), function () {
            const f1 = helper.getNode('f1')
            helper.getNode('h-pass').on('input', function (msg) {
                try {
                    msg.filter.ts.should.equal(SATURDAY_NOON)
                    done()
                } catch (err) {
                    done(err)
                }
            })
            f1.receive({ ts: SATURDAY_NOON, cronplus: { triggerTimestamp: WEDNESDAY_NOON, config: {} } })
        })
    })

    it('finds cronplus data moved to msg.payload (payloadType "default" quirk)', function (t, done) {
        helper.load(filterNode, filterFlow('on saturdays'), function () {
            const f1 = helper.getNode('f1')
            helper.getNode('h-pass').on('input', function (msg) {
                try {
                    msg.filter.ts.should.equal(SATURDAY_NOON)
                    done()
                } catch (err) {
                    done(err)
                }
            })
            f1.receive({ payload: { triggerTimestamp: SATURDAY_NOON, config: { location: '' } } })
        })
    })

    it('uses "now" when no timestamp is supplied', function (t, done) {
        helper.load(filterNode, filterFlow('every day'), function () {
            const f1 = helper.getNode('f1')
            const before = Date.now()
            helper.getNode('h-pass').on('input', function (msg) {
                try {
                    msg.filter.ts.should.be.aboveOrEqual(before)
                    msg.filter.ts.should.be.belowOrEqual(Date.now())
                    done()
                } catch (err) {
                    done(err)
                }
            })
            f1.receive({ payload: 1 })
        })
    })

    describe('location precedence', function () {
        // find an instant + two locations where moon visibility differs so the
        // location that won the precedence race is observable in the result
        const antipode = { lat: -51.5, lon: 179.87 }
        let probeTs = null
        for (let ts = Date.parse('2026-06-01T00:00:00Z'); ts < Date.parse('2026-06-08T00:00:00Z'); ts += 3600000) {
            const a = SunCalc.getMoonPosition(new Date(ts), 51.5, -0.13).altitude
            const b = SunCalc.getMoonPosition(new Date(ts), antipode.lat, antipode.lon).altitude
            if (a > 1 && b < -1) { probeTs = ts; break }
        }

        it('msg.location beats msg.cronplus.config.location', function (t, done) {
            should.exist(probeTs, 'no probe instant found')
            helper.load(filterNode, filterFlow('when the moon is visible'), function () {
                const f1 = helper.getNode('f1')
                helper.getNode('h-pass').on('input', function () { done() }) // London: visible
                helper.getNode('h-block').on('input', function () { done(new Error('msg.location (London) should have won')) })
                f1.receive({ ts: probeTs, location: '51.5,-0.13', cronplus: { triggerTimestamp: probeTs, config: { location: `${antipode.lat},${antipode.lon}` } } })
            })
        })

        it('msg.cronplus.config.location beats the node fixed config', function (t, done) {
            should.exist(probeTs, 'no probe instant found')
            helper.load(filterNode, filterFlow({ condition: 'when the moon is visible', locationType: 'fixed', location: '51.5,-0.13' }), function () {
                const f1 = helper.getNode('f1')
                helper.getNode('h-pass').on('input', function () { done(new Error('cronplus location (antipode) should have won')) })
                helper.getNode('h-block').on('input', function () { done() }) // antipode: not visible
                f1.receive({ ts: probeTs, cronplus: { triggerTimestamp: probeTs, config: { location: `${antipode.lat},${antipode.lon}` } } })
            })
        })

        it('falls back to the node fixed config location', function (t, done) {
            should.exist(probeTs, 'no probe instant found')
            helper.load(filterNode, filterFlow({ condition: 'when the moon is visible', locationType: 'fixed', location: '51.5,-0.13' }), function () {
                const f1 = helper.getNode('f1')
                helper.getNode('h-pass').on('input', function () { done() })
                helper.getNode('h-block').on('input', function () { done(new Error('node config location (London) should apply')) })
                f1.receive({ ts: probeTs })
            })
        })
    })

    it('errors (catchable) when a sun/moon condition has no location; nothing forwarded', function (t, done) {
        const flow = filterFlow('when the moon is visible')
        flow.push({ id: 'c1', type: 'catch', scope: null, uncaught: false, wires: [['h-catch']] })
        flow.push({ id: 'h-catch', type: 'helper' })
        helper.load(filterNode, flow, function () {
            const f1 = helper.getNode('f1')
            helper.getNode('h-pass').on('input', function () { done(new Error('must not forward')) })
            helper.getNode('h-block').on('input', function () { done(new Error('must not forward')) })
            helper.getNode('h-catch').on('input', function (msg) {
                try {
                    msg.error.message.should.match(/location/)
                    done()
                } catch (err) {
                    done(err)
                }
            })
            f1.receive({ ts: SATURDAY_NOON })
        })
    })

    it('errors (catchable) when msg.ts is unparsable', function (t, done) {
        const flow = filterFlow('every day')
        flow.push({ id: 'c1', type: 'catch', scope: null, uncaught: false, wires: [['h-catch']] })
        flow.push({ id: 'h-catch', type: 'helper' })
        helper.load(filterNode, flow, function () {
            const f1 = helper.getNode('f1')
            helper.getNode('h-catch').on('input', function (msg) {
                try {
                    msg.error.message.should.match(/msg\.ts/)
                    done()
                } catch (err) {
                    done(err)
                }
            })
            f1.receive({ ts: 'not a date' })
        })
    })

    it('reports an invalid stored condition at construction and rejects inputs', function (t, done) {
        const flow = filterFlow('complete gibberish xyzzy')
        flow.push({ id: 'c1', type: 'catch', scope: null, uncaught: false, wires: [['h-catch']] })
        flow.push({ id: 'h-catch', type: 'helper' })
        helper.load(filterNode, flow, function () {
            const f1 = helper.getNode('f1')
            helper.getNode('h-pass').on('input', function () { done(new Error('must not forward')) })
            helper.getNode('h-block').on('input', function () { done(new Error('must not forward')) })
            helper.getNode('h-catch').on('input', function (msg) {
                try {
                    msg.error.message.should.match(/cannot understand/i)
                    done()
                } catch (err) {
                    done(err)
                }
            })
            f1.receive({ ts: SATURDAY_NOON })
        })
    })

    describe('condition from msg / env', function () {
        it('reads the condition from a msg property per message', function (t, done) {
            helper.load(filterNode, filterFlow({ condition: 'gate', conditionType: 'msg' }), function () {
                const f1 = helper.getNode('f1')
                let passCount = 0
                helper.getNode('h-pass').on('input', function (msg) {
                    try {
                        passCount++
                        msg.filter.condition.should.equal('on saturdays')
                        // second message: same ts but a non-matching condition must block
                        f1.receive({ ts: SATURDAY_NOON, gate: 'on sundays' })
                    } catch (err) {
                        done(err)
                    }
                })
                helper.getNode('h-block').on('input', function (msg) {
                    try {
                        passCount.should.equal(1)
                        msg.filter.condition.should.equal('on sundays')
                        done()
                    } catch (err) {
                        done(err)
                    }
                })
                f1.receive({ ts: SATURDAY_NOON, gate: 'on saturdays' })
            })
        })

        it('errors (catchable) when the msg condition is not understood', function (t, done) {
            const flow = filterFlow({ condition: 'gate', conditionType: 'msg' })
            flow.push({ id: 'c1', type: 'catch', scope: null, uncaught: false, wires: [['h-catch']] })
            flow.push({ id: 'h-catch', type: 'helper' })
            helper.load(filterNode, flow, function () {
                const f1 = helper.getNode('f1')
                helper.getNode('h-catch').on('input', function (msg) {
                    try {
                        msg.error.message.should.match(/cannot understand/i)
                        done()
                    } catch (err) {
                        done(err)
                    }
                })
                f1.receive({ ts: SATURDAY_NOON, gate: 'utter nonsense' })
            })
        })

        it('reads the condition from an environment variable', function (t, done) {
            process.env.TEST_FILTER_COND = 'on saturdays'
            helper.load(filterNode, filterFlow({ condition: 'TEST_FILTER_COND', conditionType: 'env' }), function () {
                const f1 = helper.getNode('f1')
                helper.getNode('h-pass').on('input', function (msg) {
                    try {
                        msg.filter.condition.should.equal('on saturdays')
                        delete process.env.TEST_FILTER_COND
                        done()
                    } catch (err) {
                        done(err)
                    }
                })
                helper.getNode('h-block').on('input', function () { done(new Error('should have passed')) })
                f1.receive({ ts: SATURDAY_NOON })
            })
        })
    })

    describe('allow/deny-until status (always NOW-based)', function () {
        // node-red-node-test-helper wraps status at the Node prototype (like
        // warn/error), so the spy is shared - filter calls by thisValue
        function lastStatusOf (node) {
            const calls = node.status.getCalls().filter(function (c) { return c.thisValue === node })
            calls.length.should.be.above(0)
            return calls[calls.length - 1].args[0]
        }

        // fake only Date (sinon works on Node 18); real timers keep the helper alive
        function withFakeNow (now, run, done) {
            const clock = sinon.useFakeTimers({ now, toFake: ['Date'] })
            run(function finish (err) {
                clock.restore()
                done(err)
            })
        }

        it('shows the decision at deploy time, before any message arrives', function (t, done) {
            withFakeNow(WEDNESDAY_NOON, function (finish) {
                helper.load(filterNode, filterFlow('weekdays between 9am and 5pm'), function () {
                    const f1 = helper.getNode('f1')
                    setTimeout(function () { // init resolves the location asynchronously
                        try {
                            const status = lastStatusOf(f1)
                            status.fill.should.equal('green')
                            status.text.should.equal('allow until 17:00')
                            finish()
                        } catch (err) {
                            finish(err)
                        }
                    }, 50)
                })
            }, done)
        })

        it('shows "deny until <next window>" when currently blocked', function (t, done) {
            withFakeNow(SATURDAY_NOON, function (finish) {
                helper.load(filterNode, filterFlow('weekdays between 9am and 5pm'), function () {
                    const f1 = helper.getNode('f1')
                    setTimeout(function () {
                        try {
                            const status = lastStatusOf(f1)
                            status.fill.should.equal('grey')
                            status.text.should.equal('deny until Mon 09:00')
                            finish()
                        } catch (err) {
                            finish(err)
                        }
                    }, 50)
                })
            }, done)
        })

        it('status stays NOW-based even when a message carries an old ts', function (t, done) {
            withFakeNow(WEDNESDAY_NOON, function (finish) {
                helper.load(filterNode, filterFlow('weekdays between 9am and 5pm'), function () {
                    const f1 = helper.getNode('f1')
                    helper.getNode('h-block').on('input', function (msg) {
                        try {
                            msg.filter.pass.should.be.false() // routed per its own Saturday ts
                            lastStatusOf(f1).text.should.equal('allow until 17:00') // status per NOW
                            finish()
                        } catch (err) {
                            finish(err)
                        }
                    })
                    f1.receive({ ts: SATURDAY_NOON })
                })
            }, done)
        })

        it('shows plain "allow" when the condition never flips', function (t, done) {
            withFakeNow(WEDNESDAY_NOON, function (finish) {
                helper.load(filterNode, filterFlow('every day'), function () {
                    const f1 = helper.getNode('f1')
                    setTimeout(function () {
                        try {
                            lastStatusOf(f1).text.should.equal('allow')
                            finish()
                        } catch (err) {
                            finish(err)
                        }
                    }, 50)
                })
            }, done)
        })

        it('shows "waiting for message" for msg-type conditions', function (t, done) {
            helper.load(filterNode, filterFlow({ condition: 'gate', conditionType: 'msg' }), function () {
                const f1 = helper.getNode('f1')
                try {
                    lastStatusOf(f1).text.should.equal('waiting for message')
                    done()
                } catch (err) {
                    done(err)
                }
            })
        })

        it('shows "no location" for sun/moon conditions with no configured location', function (t, done) {
            helper.load(filterNode, filterFlow('when the moon is visible'), function () {
                const f1 = helper.getNode('f1')
                setTimeout(function () {
                    try {
                        lastStatusOf(f1).text.should.match(/no location/)
                        done()
                    } catch (err) {
                        done(err)
                    }
                }, 50)
            })
        })
    })

    describe('preview admin endpoint', function () {
        it('returns upcoming windows for a valid condition', function (t, done) {
            helper.load(filterNode, filterFlow('weekdays between 9am and 5pm'), function () {
                helper.request()
                    .post('/cronplus-filter/f1/preview')
                    .set('Content-Type', 'application/json')
                    .send({ condition: 'weekdays between 9am and 5pm', location: '', locationType: 'none', timeZone: 'UTC' })
                    .expect(200)
                    .end(function (err, res) {
                        if (err) { return done(err) }
                        try {
                            res.body.should.have.property('windows')
                            res.body.windows.length.should.be.above(0)
                            res.body.should.have.property('now')
                            res.body.should.have.property('resolutionMinutes')
                            done()
                        } catch (assertErr) {
                            done(assertErr)
                        }
                    })
            })
        })

        it('reports location required for sun/moon conditions with no location', function (t, done) {
            helper.load(filterNode, filterFlow('when the moon is visible'), function () {
                helper.request()
                    .post('/cronplus-filter/f1/preview')
                    .set('Content-Type', 'application/json')
                    .send({ condition: 'when the moon is visible', location: '', locationType: 'none', timeZone: '' })
                    .expect(200)
                    .end(function (err, res) {
                        if (err) { return done(err) }
                        try {
                            res.body.needsLocation.should.be.true()
                            done()
                        } catch (assertErr) {
                            done(assertErr)
                        }
                    })
            })
        })

        it('reports an invalid condition', function (t, done) {
            helper.load(filterNode, filterFlow('every day'), function () {
                helper.request()
                    .post('/cronplus-filter/f1/preview')
                    .set('Content-Type', 'application/json')
                    .send({ condition: 'total flurble', location: '', locationType: 'none', timeZone: '' })
                    .expect(200)
                    .end(function (err, res) {
                        if (err) { return done(err) }
                        try {
                            res.body.error.should.match(/invalid condition/)
                            done()
                        } catch (assertErr) {
                            done(assertErr)
                        }
                    })
            })
        })
    })

    it('gates a live cronplus schedule (payloadType default)', { timeout: 5000 }, async function () {
        const flow = [
            { id: 'cp1', type: 'cronplus', name: 'every second', outputField: 'payload', timeZone: '', commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'sched1', topic: 'sched1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '* * * * * * *', location: '', offset: '0' }], wires: [['f1']] },
            { id: 'f1', type: 'cronplus-filter', name: 'gate', condition: 'every day', location: '', locationType: 'none', timeZone: '', wires: [['h-pass'], ['h-block']] },
            { id: 'h-pass', type: 'helper' },
            { id: 'h-block', type: 'helper' }
        ]
        await alignToSecondBoundary()
        await helper.load([cronplusNode, filterNode], flow)
        const received = []
        helper.getNode('h-pass').on('input', function (msg) { received.push(msg) })
        await sleep(2050)
        received.length.should.be.aboveOrEqual(1)
        received[0].should.have.property('filter')
        received[0].filter.pass.should.be.true()
        received[0].payload.should.have.property('triggerTimestamp')
        received[0].filter.ts.should.equal(received[0].payload.triggerTimestamp)
    })
})
