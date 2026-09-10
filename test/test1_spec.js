/// <reference types="should" />
const should = require('should')
const helper = require('node-red-node-test-helper')
const cronplusNode = require('../cronplus.js')
const { describe, it, beforeEach, afterEach, after } = require('node:test')

helper.init(require.resolve('node-red'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// wait until just after a wall-clock second boundary so every-second cron schedules
// created after this fire at predictable ~950/1950/2950ms offsets. Without it, a
// schedule added just before a boundary fires almost immediately and sneaks an extra
// trigger into sleep(~2050) windows, making count assertions flaky (seen on CI).
const alignToSecondBoundary = () => sleep(1050 - (Date.now() % 1000))

after(() => {
    // node-red-node-test-helper leaves handles open after stopServer (mocha needed --exit
    // for the same reason). Node 18 has no --test-force-exit, so exit once the run has
    // settled; unref'd so it never delays a clean exit, process.exitCode preserves failures.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1000).unref()
})

describe('cron-plus Node', function () {
    'use strict'

    beforeEach((t, done) => { helper.startServer(done) })

    afterEach((t, done) => {
        helper.unload().then(() => {
            helper.stopServer(done)
        })
    })

    it('should inject within 1 sec from cron expression * * * * * * *', { timeout: 1100 }, function (t, done) {
        const flow = [
            { id: 't1n1', type: 'cronplus', name: 'every1sec', outputField: 'payload', timeZone: '', persistDynamic: false, commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'schedule1', topic: 'schedule1', payloadType: 'num', payload: '100', expressionType: 'cron', expression: '* * * * * * *', location: '', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' }], wires: [['t1n2']] },
            { id: 't1n2', type: 'helper' }
        ]
        helper.load(cronplusNode, flow, function () {
            const t1n2 = helper.getNode('t1n2')
            t1n2.on('input', function (msg) {
                msg.should.have.property('topic', 'schedule1')
                msg.should.have.property('cronplus').which.is.an.Object()
                msg.should.have.property('payload').which.is.a.Number()
                helper.clearFlows().then(function () {
                    done()
                })
            })
        })
    })

    it('should warn (not crash) when button pressed and no valid schedules exist', { timeout: 2000 }, function (t, done) {
        // schedule has a blank date-sequence expression so no task will be created,
        // then an empty msg (button press) must not throw an unhandled rejection
        const flow = [
            { id: 't1n3', type: 'cronplus', name: 'no schedules', outputField: 'payload', timeZone: '', persistDynamic: false, commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'dates', expression: '', location: '', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' }], wires: [[]] }
        ]
        helper.load(cronplusNode, flow, function () {
            const t1n3 = helper.getNode('t1n3')
            t1n3.receive({}) // simulate button press (no topic, no payload)
            setTimeout(() => {
                try {
                    t1n3.warn.calledWith('No schedule available to trigger').should.be.true('expected "No schedule available to trigger" warning')
                    done()
                } catch (err) {
                    done(err)
                }
            }, 200)
        })
    })

    it('should catch errors thrown during a scheduled trigger (no unhandled rejection)', { timeout: 4000 }, function (t, done) {
        // a schedule that fires every second - node.status is made to throw part way
        // through sendMsg (outside its internal try/catch) to prove the scheduled-run
        // call site routes the rejection to node.error instead of crashing the runtime
        const flow = [
            { id: 't1n4', type: 'cronplus', name: 'every1sec', outputField: 'payload', timeZone: '', persistDynamic: false, commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '* * * * * * *', location: '', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' }], wires: [[]] }
        ]
        helper.load(cronplusNode, flow, function () {
            const t1n4 = helper.getNode('t1n4')
            const originalStatus = t1n4.status
            t1n4.status = function (status) {
                if (status && status.text === 'Schedule Started') {
                    throw new Error('forced error during sendMsg')
                }
                return originalStatus.call(t1n4, status)
            }
            let finished = false
            const finish = (err) => {
                if (finished) { return }
                finished = true
                clearInterval(pollTimer)
                clearTimeout(failTimer)
                done(err)
            }
            const pollTimer = setInterval(() => {
                const errCall = t1n4.error.getCalls().find(c => c.args[0] && c.args[0].message === 'forced error during sendMsg')
                if (errCall) { finish() }
            }, 100)
            const failTimer = setTimeout(() => {
                finish(new Error('node.error was not called - error from scheduled trigger was not caught'))
            }, 3000)
        })
    })

    it('should not hang when a schedule can never occur (e.g. 30th of February)', { timeout: 5000 }, function (t, done) {
        // cronosjs searches year-by-year for the next occurrence; an impossible date
        // with an unbounded year field made that search spin forever, locking up the
        // runtime on deploy. The year scan is now bounded and reports "Never".
        const flow = [
            { id: 't1n5', type: 'cronplus', name: 'never', outputField: 'payload', timeZone: '', persistDynamic: false, commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0 0 30 02 *', location: '', offset: '0' }], wires: [['t1n6']] },
            { id: 't1n6', type: 'helper' }
        ]
        helper.load(cronplusNode, flow, function () {
            // reaching this callback at all proves deploy did not lock the event loop
            const t1n5 = helper.getNode('t1n5')
            const t1n6 = helper.getNode('t1n6')
            t1n6.on('input', function (msg) {
                try {
                    msg.should.have.property('payload').which.is.an.Object()
                    msg.payload.should.have.property('result').which.is.an.Object()
                    msg.payload.result.should.have.property('description').which.is.a.String()
                    msg.payload.result.should.have.property('prettyNext', 'Never')
                    done()
                } catch (err) {
                    done(err)
                }
            })
            // also exercise the describe path with the impossible expression
            t1n5.receive({ payload: { command: 'describe', expressionType: 'cron', expression: '0 0 30 02 *' } })
        })
    })

    describe('save state store validation', function () {
        // issue #104: the editor offers the built-in 'memory' context store on a
        // default node-red install (no contextStorage configured in settings), but
        // the runtime rejected it. It must be accepted, and a genuinely unknown
        // store must produce an actionable warning that does not affect the
        // persistence of other cronplus nodes.
        const makeNode = (id, storeName) => ({
            id, type: 'cronplus', name: 'store test ' + id, outputField: 'payload', timeZone: '', storeName, commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0 0 * * * * 2000', location: '', offset: '0' }], wires: [[]]
        })
        // the test helper stubs warn at the prototype, so the spy is shared by all
        // nodes - filter calls by thisValue to get the calls made by *this* node
        const invalidStoreWarnings = (n) => n.warn.getCalls().filter(c => c.thisValue === n && typeof c.args[0] === 'string' && c.args[0].includes('Invalid store name'))

        it("should accept the built-in 'memory' store, 'file' and none without warning", async function () {
            const flow = [makeNode('s1', 'memory'), makeNode('s2', 'file'), makeNode('s3', '')]
            await helper.load(cronplusNode, flow)
            invalidStoreWarnings(helper.getNode('s1')).should.have.length(0)
            invalidStoreWarnings(helper.getNode('s2')).should.have.length(0)
            invalidStoreWarnings(helper.getNode('s3')).should.have.length(0)
        })
        it('should warn with guidance for an unknown store, without affecting other nodes', async function () {
            const flow = [makeNode('s1', 'bogus'), makeNode('s2', 'memory')]
            await helper.load(cronplusNode, flow)
            const bad = helper.getNode('s1')
            const good = helper.getNode('s2')
            const warnings = invalidStoreWarnings(bad)
            warnings.should.have.length(1)
            warnings[0].args[0].should.match(/Invalid store name specified 'bogus'/)
            warnings[0].args[0].should.match(/contextStorage/) // actionable guidance
            bad.should.have.property('contextAvailable', false) // per node, not module wide
            invalidStoreWarnings(good).should.have.length(0)
        })
    })

    describe('DST transition handling (Debian cron rules)', function () {
        // Jobs whose minute or hour field starts with `*` ("wildcard jobs") keep
        // their real-time interval across a DST change, so they also run during
        // the repeated hour when clocks go back. Jobs with a fixed hour + minute
        // ("fixed-time jobs") run only once in a repeated hour, and run as soon
        // as possible after a missing hour when clocks go forward.
        // Ref: https://blog.healthchecks.io/2021/10/how-debian-cron-handles-dst-transitions/
        // MockTimers' 'Date' api landed in Node 20.11.0 - earlier versions throw on enable()
        const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
        const hasMockDate = nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 11)
        const iso = d => new Date(d).toISOString()

        // loads a cronplus node and returns a function that asks it to describe
        // a cron expression at a fixed point in time (Europe/London)
        const loadDescriber = async () => {
            const flow = [
                { id: 'dst1', type: 'cronplus', name: 'dst', outputField: 'payload', timeZone: 'Europe/London', persistDynamic: false, commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0 0 * * * * 2000', location: '', offset: '0' }], wires: [['dst2']] },
                { id: 'dst2', type: 'helper' }
            ]
            await helper.load(cronplusNode, flow)
            const dst1 = helper.getNode('dst1')
            const dst2 = helper.getNode('dst2')
            return (expression, time) => new Promise(resolve => {
                dst2.once('input', msg => resolve(msg.payload.result))
                dst1.receive({ payload: { command: 'describe', expressionType: 'cron', expression, timeZone: 'Europe/London', time } })
            })
        }

        // UK fall back: Sun 26 Oct 2025, 02:00 BST -> 01:00 GMT (01:00-01:59 local occurs twice)
        it('wildcard schedule should keep running through the repeated hour (clocks go back)', async function () {
            const describeExpr = await loadDescriber()
            const result = await describeExpr('0,15,30,45 * * * * * *', '2025-10-26T00:59:50Z') // 01:59:50 BST
            iso(result.nextDate).should.eql('2025-10-26T01:00:00.000Z') // 01:00:00 GMT, second pass of the repeated hour
        })
        it('minute-wildcard schedule with fixed hour is a wildcard job (clocks go back)', async function () {
            const describeExpr = await loadDescriber()
            const result = await describeExpr('0 * 1 * * * *', '2025-10-26T00:59:30Z') // 01:59:30 BST
            iso(result.nextDate).should.eql('2025-10-26T01:00:00.000Z') // hour 1 repeats - runs again
        })
        it('fixed-time schedule should run only once in the repeated hour (clocks go back)', async function () {
            const describeExpr = await loadDescriber()
            const first = await describeExpr('0 30 1 * * * *', '2025-10-26T00:29:00Z') // 01:29 BST
            iso(first.nextDate).should.eql('2025-10-26T00:30:00.000Z') // 01:30 BST, first pass runs
            const second = await describeExpr('0 30 1 * * * *', '2025-10-26T00:31:00Z') // 01:31 BST, already ran
            iso(second.nextDate).should.eql('2025-10-27T01:30:00.000Z') // NOT 01:30 GMT (second pass) - next day
        })

        // UK spring forward: Sun 30 Mar 2025, 01:00 GMT -> 02:00 BST (01:00-01:59 local never occurs)
        it('wildcard schedule should keep its cadence through the missing hour (clocks go forward)', async function () {
            const describeExpr = await loadDescriber()
            const result = await describeExpr('0,15,30,45 * * * * * *', '2025-03-30T00:59:50Z') // 00:59:50 GMT
            iso(result.nextDate).should.eql('2025-03-30T01:00:00.000Z') // = 02:00:00 BST, 10 real seconds later
        })
        it('fixed-time schedule in the missing hour should run as soon as possible (clocks go forward)', async function () {
            const describeExpr = await loadDescriber()
            const missed = await describeExpr('0 30 1 * * * *', '2025-03-30T00:29:00Z') // 00:29 GMT - 01:30 local will not occur
            iso(missed.nextDate).should.eql('2025-03-30T01:00:00.000Z') // runs at the transition (02:00 BST)
            const after = await describeExpr('0 30 1 * * * *', '2025-03-30T01:01:00Z') // just after the transition
            iso(after.nextDate).should.eql('2025-03-31T00:30:00.000Z') // 01:30 BST the next day
        })

        // live scheduler (task creation) path - mock timers travel through the transition
        it('live wildcard schedule should fire during the repeated hour (clocks go back)', { timeout: 10000 }, async function (t) {
            if (!hasMockDate) {
                t.skip('Node 20.11+ required for fake timers (Date) to work through DST transition')
                return
            }
            t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date('2025-10-26T00:59:50Z').getTime() }) // 01:59:50 BST
            const drain = () => new Promise(resolve => setImmediate(resolve))
            try {
                const flow = [
                    { id: 'dst3', type: 'cronplus', name: 'dst-live', outputField: 'payload', timeZone: 'Europe/London', persistDynamic: false, commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'every15', topic: 'every15', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0,15,30,45 * * * * * *', location: '', offset: '0' }], wires: [['dst4']] },
                    { id: 'dst4', type: 'helper' }
                ]
                await helper.load(cronplusNode, flow)
                const dst4 = helper.getNode('dst4')
                const fires = []
                dst4.on('input', msg => fires.push(iso(msg.payload.triggerTimestamp)))
                // advance 35s of fake time through the transition, in small steps so
                // each fire sees the clock at its own moment
                for (let i = 0; i < 700; i++) { t.mock.timers.tick(50); await drain() }
                fires.should.containEql('2025-10-26T01:00:00.000Z') // 01:00:00 GMT - first slot of the repeated hour
                fires.should.containEql('2025-10-26T01:00:15.000Z')
            } finally {
                t.mock.timers.reset()
            }
        })
    })

    describe('solar & lunar event calculations (suncalc)', function () {
        const SunCalc = require('suncalc')
        const iso = d => new Date(d).toISOString()
        const LOC = '55.0,-1.418'
        const LAT = 55.0
        const LNG = -1.418

        // loads a cronplus node and returns a function that sends a describe
        // command and resolves with the command response's result object
        const loadDescriber = async () => {
            const flow = [
                { id: 'sl1', type: 'cronplus', name: 'suncalc test', outputField: 'payload', timeZone: '', persistDynamic: false, commandResponseMsgOutput: 'output1', outputs: 1, options: [{ name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0 0 * * * * 2000', location: '', offset: '0' }], wires: [['sl2']] },
                { id: 'sl2', type: 'helper' }
            ]
            await helper.load(cronplusNode, flow)
            const sl1 = helper.getNode('sl1')
            const sl2 = helper.getNode('sl2')
            return (payload) => new Promise(resolve => {
                sl2.once('input', msg => resolve(msg.payload.result))
                sl1.receive({ payload: Object.assign({ command: 'describe' }, payload) })
            })
        }

        it("solar 'sunrise' should keep suncalc2 semantics (top edge of the sun appears)", { timeout: 5000 }, async function () {
            const ask = await loadDescriber()
            const result = await ask({ expressionType: 'solar', location: LOC, solarType: 'selected', solarEvents: 'sunrise', time: '2026-06-15T12:00:00Z' })
            result.nextEvent.should.eql('sunrise')
            // the returned time must be the sunrise of its own day, NOT sunriseEnd
            const times = SunCalc.getTimes(new Date(result.nextEventTime), LAT, LNG)
            iso(result.nextEventTime).should.eql(iso(times.sunrise))
            iso(result.nextEventTime).should.not.eql(iso(times.sunriseEnd))
        })
        it("solar 'sunset' should keep suncalc2 semantics (sun disappears below the horizon)", { timeout: 5000 }, async function () {
            const ask = await loadDescriber()
            const result = await ask({ expressionType: 'solar', location: LOC, solarType: 'selected', solarEvents: 'sunset', time: '2026-06-15T12:00:00Z' })
            result.nextEvent.should.eql('sunset')
            const times = SunCalc.getTimes(new Date(result.nextEventTime), LAT, LNG)
            iso(result.nextEventTime).should.eql(iso(times.sunset))
            iso(result.nextEventTime).should.not.eql(iso(times.sunsetStart))
        })
        it("solar 'nightEnd' should not fire on days when astronomical dawn does not occur", { timeout: 5000 }, async function () {
            // at 55N in mid-June the sun never reaches -18 degrees - suncalc returns
            // null for such days, which must be skipped. The next true astronomical
            // dawn is several weeks away (late July)
            const ask = await loadDescriber()
            const result = await ask({ expressionType: 'solar', location: LOC, solarType: 'selected', solarEvents: 'nightEnd', time: '2026-06-15T12:00:00Z' })
            result.nextEvent.should.eql('nightEnd')
            new Date(result.nextEventTime).getTime().should.be.above(new Date('2026-07-01T00:00:00Z').getTime())
        })
        it("lunar 'rise' should return the next moon rise for the location", { timeout: 5000 }, async function () {
            const t0 = new Date('2026-06-15T12:00:00Z')
            const ask = await loadDescriber()
            const result = await ask({ expressionType: 'lunar', location: LOC, lunarType: 'selected', lunarEvents: 'rise', time: t0.toISOString() })
            result.nextEvent.should.eql('rise')
            new Date(result.nextEventTime).getTime().should.be.above(t0.getTime())
            // the returned time must be the moon rise of its own day per suncalc
            const moonTimes = SunCalc.getMoonTimes(new Date(result.nextEventTime), LAT, LNG)
            iso(result.nextEventTime).should.eql(iso(moonTimes.rise))
        })
        it('lunar describe should not crash when there are no recent moon events (polar latitudes)', { timeout: 5000 }, async function () {
            // at 89N the moon is continuously up or down for days at a time - the first
            // week of Jan 2026 has no rise/set events at all, so the backwards scan
            // finds no prior event (this used to throw and no response was ever sent)
            const t0 = new Date('2026-01-04T00:00:00Z')
            const ask = await loadDescriber()
            const result = await ask({ expressionType: 'lunar', location: '89.0,0.0', lunarType: 'all', time: t0.toISOString() })
            should.exist(result)
            result.should.have.property('lunarState').which.is.an.Object()
            result.lunarState.should.have.property('illumination') // moon data present even with no prior event
            new Date(result.nextEventTime).getTime().should.be.above(t0.getTime()) // events resume within the forward scan window
        })
    })

    const getObjectProperty = function (object, path, defaultValue) {
        return path
            // eslint-disable-next-line no-useless-escape
            .split(/[\.\[\]\'\"]/)
            .filter(p => p)
            .reduce((o, p) => o ? o[p] : defaultValue, object)
    }

    /**
     * Test basic operations of cronplus including return property name and return types/values
     * @param {string} topic The topic cronplus output should have
     * @param {string} outputField The msg property to return the payload in
     * @param {string} payloadType The expected payload type e.g. str, num, json, default
     * @param {Any} payloadValue The value to be returned by the cronplus node
     * @param {Any} returnType the expected type
     * @param {Any} returnVal the expected value
     */
    function basicTest (topic, outputField, payloadType, payloadValue, returnType, returnVal, opts) {
        it('should inject value of type ' + payloadType + ' in msg.' + outputField, { timeout: 2000 }, function (t, done) {
            opts = opts || {}
            const cronnode = {
                id: 't2n1',
                type: 'cronplus',
                name: 'test1',
                outputField,
                timeZone: '',
                persistDynamic: false,
                commandResponseMsgOutput: 'output1',
                outputs: 1,
                options: [
                    { name: 'schedule1', topic, payloadType, payload: payloadValue, expressionType: 'cron', expression: '0 0 * * * * 2000', location: '', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' },
                    { name: 'schedule2', topic, payloadType, payload: payloadValue, expressionType: 'solar', expression: '41.1,2.1', location: '41.1,2.1', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' }
                ],
                wires: [['t2n2']],
                // g: 'grp',
                z: 'tab1'
            }
            const flow = [
                { id: 'tab1', type: 'tab', label: 'Flow 1', env: [{ name: 'tabpos', value: opts.tabpos || '51.1, 1.1', type: 'str' }] },
                // { id: 'grp', type: 'group', z: 'tab1', name: '', style: { label: true }, nodes: ['schedule1', 'schedule2'], env: [{ name: 'grppos', value: opts.grppos || '49.49, 1.2', type: 'str' }] },
                cronnode,
                { id: 't2n2', type: 'helper', z: 'tab1' }
            ]
            if (opts.defaultLocationType && opts.defaultLocation) {
                cronnode.defaultLocationType = opts.defaultLocationType
                cronnode.defaultLocation = opts.defaultLocation
            }
            if (opts.location) {
                cronnode.options[1].location = opts.location
                cronnode.options[1].expression = opts.location
            }
            helper.load(cronplusNode, flow, function () {
                const t2n1 = helper.getNode('t2n1')
                const t2n2 = helper.getNode('t2n2')
                // const grp = helper.getNode('grp')
                t2n2.on('input', function (msg) {
                    try {
                        msg.should.have.property('topic', topic)
                        msg.should.have.propertyByPath(...outputField.split('.'))
                        if (returnType === 'default' && returnVal) {
                            returnVal.forEach(e => {
                                const result = getObjectProperty(msg, e.prop)
                                should.deepEqual(result, e.value)
                            })
                        }
                        if (returnType !== 'default' && returnVal) {
                            const result = getObjectProperty(msg, outputField)
                            should(result).be.of.type(returnType)
                            should.deepEqual(result, returnVal)
                        }
                        helper.clearFlows().then(function () {
                            done()
                        })
                    } catch (err) {
                        done(err)
                    }
                })
                t2n1.receive({ topic: 'trigger', payload: opts.schedule || 'schedule1' }) // trigger schedule
            })
        })
    }

    describe('basic tests', function () {
        basicTest('topic1', 'payload', 'num', 10, 'number', 10)
        basicTest('topic2', 'result', 'str', '10', 'string', '10')
        basicTest('topic3', 'payload.value', 'bool', true, 'boolean', true)
        const valJson = '{"x":"vx","n":1,"o":{}}'
        basicTest('topic4', 'my.nested.payload', 'json', valJson, 'object', JSON.parse(valJson))
        const valBuf = '[1,2,3,4,5]'
        basicTest('topic5', 'payload', 'bin', valBuf, 'object', Buffer.from(JSON.parse(valBuf)))
        const valJsonata = '{"x":1+2}'
        const valJsonataResult = '{"x":3}'
        basicTest('topic6', 'my.nested.payload', 'jsonata', valJsonata, 'object', JSON.parse(valJsonataResult))

        const opts = { defaultLocationType: 'fixed', defaultLocation: '55.555, 0.5555', schedule: 'schedule2' }
        const results = [
            { prop: 'payload.config.location', value: '55.555, 0.5555' }
        ]
        basicTest('topic6', 'payload', 'default', '', 'default', results, opts)
    })
    // // group env var - groups not working in test env!
    // const opts2 = { defaultLocationType: 'env', defaultLocation: 'pos', schedule: 'schedule2' }
    // const results2 = [
    //     { prop: 'payload.config.location', value: '49.49, 1.2' }
    // ]
    // basicTest('topic7', 'payload', 'default', '', 'default', results2, opts2)

    // // tab env var - not supported?
    // const opts3 = { defaultLocationType: 'env', defaultLocation: 'tabpos', schedule: 'schedule2', tabpos: '48.48, 1.48' }
    // const results3 = [
    //     { prop: 'payload.config.location', value: '48.48, 1.48' }
    // ]
    // basicTest('topic7', 'payload', 'default', '', 'default', results3, opts3)

    describe('extended tests', function () {
        const cronNodeName = 't3n1'

        const getTestFlow = (nodeName = 'testNode') => {
            return [
                { id: 'helperNode1', type: 'helper' },
                { id: 'helperNode2', type: 'helper' },
                { id: 'helperNode3', type: 'helper' },
                { id: 'helperNode4', type: 'helper' },
                { id: 'helperNodeDynSchedules', type: 'helper' },
                { id: 'helperNodeCmdResponses', type: 'helper' },
                { id: 'catchHelper', type: 'helper' },
                { id: 'completeHelper', type: 'helper' },
                {
                    id: nodeName,
                    type: 'cronplus',
                    name: '',
                    outputField: 'payload',
                    timeZone: '',
                    persistDynamic: false,
                    commandResponseMsgOutput: 'fanOut',
                    outputs: 6,
                    options: [
                        { name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0 * * * * * *', location: '', offset: '0' },
                        { name: 'schedule2', topic: 'schedule2', payloadType: 'default', payload: '', expressionType: 'dates', expression: [Date.now() + 60000, Date.now() + 120000], location: '', offset: '0' },
                        { name: 'schedule3', topic: 'schedule3', payloadType: 'default', payload: '', expressionType: 'solar', expression: '0 * * * * * *', location: '55.0 -1.418', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' },
                        { name: 'schedule4', topic: 'schedule4', payloadType: 'default', payload: '', expressionType: 'lunar', expression: '0 * * * * * *', location: '55.0 -1.418', offset: '0', lunarType: 'all', lunarEvents: 'rise,set' }
                    ],
                    wires: [['helperNode1'], ['helperNode2'], ['helperNode3'], ['helperNode4'], ['helperNodeDynSchedules'], ['helperNodeCmdResponses']]
                },
                { id: 'catchNode1', type: 'catch', name: '', scope: [nodeName], uncaught: false, wires: [['catchHelper']] },
                { id: 'completeNode1', type: 'complete', name: '', scope: [nodeName], wires: [['completeHelper']] }
            ]
        }
        const flow = getTestFlow(cronNodeName)
        /** @type {nodeRed.Node<{}>} */ let helperNode1StaticSchedule1 = null
        /** @type {nodeRed.Node<{}>} */ let helperNode2StaticSchedule2 = null
        /** @type {nodeRed.Node<{}>} */ let helperNode3StaticSchedule3 = null
        /** @type {nodeRed.Node<{}>} */ let helperNode4StaticSchedule4 = null
        /** @type {nodeRed.Node<{}>} */ let helperNodeDynamicSchedules = null
        /** @type {nodeRed.Node<{}>} */ let helperNodeCommandResponses = null
        /** @type {nodeRed.Node<{}>} */ let testNode = null
        /** @type {nodeRed.Node<{}>} */ let catchNode1 = null
        /** @type {nodeRed.Node<{}>} */ let catchHelper = null
        /** @type {nodeRed.Node<{}>} */ let completeNode1 = null
        /** @type {nodeRed.Node<{}>} */ let completeHelper = null

        beforeEach(async () => {
            await helper.load(cronplusNode, flow)

            helperNode1StaticSchedule1 = helper.getNode('helperNode1')
            helperNode2StaticSchedule2 = helper.getNode('helperNode2')
            helperNode3StaticSchedule3 = helper.getNode('helperNode3')
            helperNode4StaticSchedule4 = helper.getNode('helperNode4')
            helperNodeDynamicSchedules = helper.getNode('helperNodeDynSchedules')
            helperNodeCommandResponses = helper.getNode('helperNodeCmdResponses')
            testNode = helper.getNode(cronNodeName)
            catchNode1 = helper.getNode('catchNode1')
            catchHelper = helper.getNode('catchHelper')
            completeNode1 = helper.getNode('completeNode1')
            completeHelper = helper.getNode('completeHelper')

            should(helperNode1StaticSchedule1).not.be.null()
            should(helperNode2StaticSchedule2).not.be.null()
            should(helperNode3StaticSchedule3).not.be.null()
            should(helperNode4StaticSchedule4).not.be.null()
            should(helperNodeDynamicSchedules).not.be.null()
            should(helperNodeCommandResponses).not.be.null()
            should(testNode).not.be.null()
            should(catchNode1).not.be.null()
            should(catchHelper).not.be.null()
            should(completeNode1).not.be.null()
            should(completeHelper).not.be.null()
            testNode.should.have.property('id', cronNodeName)
        })

        afterEach(async () => {
            helperNode1StaticSchedule1 = null
            helperNode2StaticSchedule2 = null
            helperNode3StaticSchedule3 = null
            helperNode4StaticSchedule4 = null
            helperNodeDynamicSchedules = null
            helperNodeCommandResponses = null
            testNode = null
            catchNode1 = null
            catchHelper = null
            completeNode1 = null
            completeHelper = null
        })

        function createAddScheduleMsg ({ name = 'dynCron', topic = 'dynCron', expression = '0 0 * * * * *', expressionType = 'cron', payloadType = 'default', limit = 1, count = undefined }) {
            return {
                payload: {
                    command: 'add',
                    name,
                    topic,
                    expression,
                    expressionType,
                    payloadType,
                    limit,
                    count
                }
            }
        }

        const configChecker = function (config) {
            should(config).not.be.Null()
            config.should.have.keys('topic', 'name', 'payload')
            config.should.have.property('payloadType', 'default')
            config.should.have.property('expressionType')
            if (config.expressionType === 'solar' || config.expressionType === 'lunar') {
                config.should.have.property('location')
            } else {
                config.should.have.property('expression')
            }
        }

        const statusChecker = function (status, expectedType) {
            /*
                count:1
                description:'Every minute'
                isRunning:true
                limit:0
                modified:false
                nextDate:Sat Apr 10 2021 14:59:00 GMT+0100 (British Summer Time)
                nextDateTZ:'Apr 10, 2021, 14:59:00 GMT+1'
                nextDescription:'in 38 seconds'
                serverTime:Sat Apr 10 2021 14:58:21 GMT+0100 (British Summer Time)
                serverTimeZone:'Europe/London'
                timeZone:'Europe/London'
                type:'static'
            */
            // it('should be a valid status object ', function (done) {
            //     try {
            status.should.have.property('count').which.is.a.Number()
            status.should.have.property('description').which.is.a.String()
            status.should.have.property('isRunning').which.is.a.Boolean()
            status.should.have.property('type').which.is.a.String()
            if (expectedType) {
                should(status.type).eql(expectedType)
            } else {
                should(status.type).be.oneOf('static', 'dynamic')
            }
        }
        const countChecker = (name, msg, limit, expectedCount, isRunning) => {
            msg.should.have.property('config').which.is.an.Object()
            msg.should.have.property('status').which.is.an.Object()
            msg.config.should.have.property('limit', limit)
            msg.config.should.have.property('name', name)
            msg.status.should.have.property('limit', limit)
            msg.status.should.have.property('count', expectedCount)
            msg.status.should.have.property('isRunning', isRunning)
        }
        const commandChecker = function (msg, test) {
            msg.should.have.property('payload').which.is.an.Object()
            const payload = msg.payload
            payload.should.have.property('command').which.is.an.Object()
            payload.should.have.property('result').which.is.an.Object()

            const command = payload.command
            const result = payload.result

            command.should.have.property('command').which.is.a.String()
            should(command.command).eql(test.expected.command)

            if (test.expected.propertyValues) {
                for (const propVal of test.expected.propertyValues) {
                    const prop = propVal[0]
                    const type = propVal[1]
                    const val = propVal[2]
                    const o = getObjectProperty(msg, prop)
                    should(o).not.be.null()
                    o.should.have.be.a.type(type)
                    if (typeof val !== 'undefined') o.should.eql(val)
                }
            }
            if (command.command === 'describe') {
                // .command
                command.should.have.property('expressionType').which.is.a.String()
                command.should.have.property('payloadType').which.is.a.String()
                if (command.expressionType === 'solar' || command.expressionType === 'lunar') {
                    command.should.have.property('location')
                } else {
                    command.should.have.property('expression')
                }

                // .result
                result.should.have.property('description').which.is.a.String()
                result.should.have.property('nextDate')
                if (command.expressionType === 'cron') {
                    result.should.have.property('prettyNext').which.is.a.String()
                }
                if (command.expressionType === 'solar') {
                    result.should.have.property('nextEventTime')
                    result.should.have.property('solarState').which.is.an.Object()
                    result.should.have.property('eventTimes').which.is.an.Object()
                }
                if (command.expressionType === 'lunar') {
                    result.should.have.property('nextEventTime')
                    result.should.have.property('lunarState').which.is.an.Object()
                    result.should.have.property('eventTimes').which.is.an.Object()
                }
            } else if (command.command === 'export') {
                configChecker(result)
            } else if (command.command === 'status' || command.command === 'list') {
                result.should.have.property('config').which.is.an.Object()
                result.should.have.property('status').which.is.an.Object()
                configChecker(result.config)
                statusChecker(result.status)
            } else if (command.command.startsWith('status-') || command.command.startsWith('list-')) {
                should(Array.isArray(result)).be.true('check result should be an array')
                if (Object.prototype.hasOwnProperty.call(test.expected, 'scheduleCount')) {
                    result.should.be.an.Array()
                    should(result.length).eql(test.expected.scheduleCount, 'Check number of schedules in response')
                }
                for (const r of result) {
                    r.should.have.property('config').which.is.an.Object()
                    r.should.have.property('status').which.is.an.Object()
                    configChecker(r.config)
                    statusChecker(r.status)
                }
            }
        }

        const staticScheduleTest = (msg) => {
            msg.should.have.property('payload')
            msg.payload.should.have.property('triggerTimestamp')
            msg.payload.should.have.property('config')
            configChecker(msg.payload.config)
            msg.payload.should.have.property('status')
            statusChecker(msg.payload.status, 'static')
        }

        const dynamicScheduleTest = (msg) => {
            msg.should.have.property('payload')
            msg.payload.should.have.property('triggerTimestamp')
            msg.payload.should.have.property('config')
            configChecker(msg.payload.config)
            msg.payload.should.have.property('status')
            statusChecker(msg.payload.status, 'dynamic')
        }

        it('should trigger static cron schedule', async function () {
            const resultPromise = new Promise(resolve => {
                helperNode1StaticSchedule1.on('input', resolve)
            })
            testNode.receive({ topic: 'trigger', payload: 'schedule1' }) // fire input of testNode
            const result = await resultPromise // wait for the first message to be processed
            staticScheduleTest(result)
        })
        it('should trigger static dates schedule', async function () {
            const resultPromise = new Promise(resolve => {
                helperNode2StaticSchedule2.on('input', resolve)
            })
            testNode.receive({ topic: 'trigger', payload: 'schedule2' }) // fire input of testNode
            const result = await resultPromise // wait for the second message to be processed
            staticScheduleTest(result)
        })
        it('should trigger static solar schedule', async function () {
            const resultPromise = new Promise(resolve => {
                helperNode3StaticSchedule3.on('input', resolve)
            })
            testNode.receive({ topic: 'trigger', payload: 'schedule3' }) // fire input of testNode
            const result = await resultPromise // wait for the third message to be processed
            staticScheduleTest(result)
        })
        it('should trigger static lunar schedule', async function () {
            const resultPromise = new Promise(resolve => {
                helperNode4StaticSchedule4.on('input', resolve)
            })
            testNode.receive({ topic: 'trigger', payload: 'schedule4' }) // fire input of testNode
            const result = await resultPromise // wait for the third message to be processed
            staticScheduleTest(result)
        })
        it("should 'trigger-all' by topic", async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'trigger-all', payload: '' },
                expected: { command: 'trigger-all', scheduleCount: 6 } // 4 static + 2 dynamic
            }
            await alignToSecondBoundary()
            // add 2 dynamic schedules
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 3, expression: '* * * * * * *' })) // every 1 seconds
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2' }))
            await sleep(50) // let it unwind
            const messages = []
            const addMessage = (msg, resolver) => {
                messages.push(msg)
                if (messages.length >= 6) {
                    resolver(messages)
                }
            }
            const resultPromise = new Promise(resolve => {
                helperNode1StaticSchedule1.on('input', (msg) => {
                    addMessage(msg, resolve)
                })
                helperNode2StaticSchedule2.on('input', (msg) => {
                    addMessage(msg, resolve)
                })
                helperNode3StaticSchedule3.on('input', (msg) => {
                    addMessage(msg, resolve)
                })
                helperNode4StaticSchedule4.on('input', (msg) => {
                    addMessage(msg, resolve)
                })
                helperNodeDynamicSchedules.on('input', (msg) => {
                    addMessage(msg, resolve)
                })
                helperNodeCommandResponses.on('input', (msg) => {
                    addMessage(msg, resolve)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            result.should.have.length(6)
            statusChecker(result[0].payload.status, 'static')
            statusChecker(result[1].payload.status, 'static')
            statusChecker(result[2].payload.status, 'static')
            statusChecker(result[3].payload.status, 'static')
            statusChecker(result[4].payload.status, 'dynamic')
            statusChecker(result[5].payload.status, 'dynamic')
            configChecker(result[0].payload.config)
            configChecker(result[1].payload.config)
            configChecker(result[2].payload.config)
            configChecker(result[3].payload.config)
            configChecker(result[4].payload.config)
            configChecker(result[5].payload.config)
        })
        it('should add a dynamic cron schedule', async function () {
            const resultPromise = new Promise(resolve => {
                helperNodeDynamicSchedules.on('input', resolve)
            })
            testNode.receive(createAddScheduleMsg({ name: 'dynCron1', topic: 'xxx' })) // add a dynamic cron schedule
            testNode.receive({ topic: 'trigger', payload: 'dynCron1' }) // fire input of testNode
            const result = await resultPromise
            dynamicScheduleTest(result)
            result.topic.should.eql('xxx')
        })

        it('describe solar events for a location', async function (t) {
            const test = {
                description: t.name,
                send: { payload: { command: 'describe', expressionType: 'solar', location: '54.9992500,-1.4170300', solarType: 'all', timeZone: 'Europe/London' } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', 'All Solar Events']] }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('describe a custom rising solar angle (-4 degrees)', async function (t) {
            const test = {
                description: t.name,
                send: { payload: { command: 'describe', expressionType: 'solar', location: '54.9992500,-1.4170300', solarType: 'customRising', solarEvents: '-4', timeZone: 'Europe/London' } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', "Solar Events: 'sun rising 4° below the horizon'"]] }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
            result.payload.result.should.have.property('nextEvent', 'customAngleRise')
            result.payload.result.should.have.property('nextEventTimeOffset').which.is.a.Date()
        })
        it('describe a custom setting solar angle (6.5 degrees)', async function (t) {
            const test = {
                description: t.name,
                send: { payload: { command: 'describe', expressionType: 'solar', location: '54.9992500,-1.4170300', solarType: 'customSetting', solarEvents: '6.5', timeZone: 'Europe/London' } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', "Solar Events: 'sun setting 6.5° above the horizon'"]] }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
            result.payload.result.should.have.property('nextEvent', 'customAngleSet')
        })
        it('should reject adding a schedule with an out-of-range custom solar angle', async function () {
            testNode.receive({
                payload: {
                    command: 'add',
                    name: 'dynBadAngle',
                    topic: 'dynBadAngle',
                    expressionType: 'solar',
                    location: '54.9992500,-1.4170300',
                    solarType: 'customRising',
                    solarEvents: '120',
                    payloadType: 'default',
                    limit: 1
                }
            })
            await sleep(50) // let it unwind
            const warnCall = testNode.warn.getCalls().find(c => c.args[0] && String(c.args[0].message || c.args[0]).includes('degrees between -90 and 90'))
            should(warnCall).not.be.undefined()
        })
        it('should reject adding a schedule with a non-numeric custom solar angle', async function () {
            testNode.receive({
                payload: {
                    command: 'add',
                    name: 'dynBadAngle2',
                    topic: 'dynBadAngle2',
                    expressionType: 'solar',
                    location: '54.9992500,-1.4170300',
                    solarType: 'customSetting',
                    solarEvents: 'not-a-number',
                    payloadType: 'default',
                    limit: 1
                }
            })
            await sleep(50)
            const warnCall = testNode.warn.getCalls().find(c => c.args[0] && String(c.args[0].message || c.args[0]).includes('degrees between -90 and 90'))
            should(warnCall).not.be.undefined()
        })
        it('describe lunar events for a location', async function (t) {
            const test = {
                description: t.name,
                send: { payload: { command: 'describe', expressionType: 'lunar', location: '54.9992500,-1.4170300', lunarType: 'all', timeZone: 'Europe/London' } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', 'All Lunar Events']] }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should describe cron expression 0 * * * * * *', async function (t) {
            const test = {
                description: t.name,
                send: { payload: { command: 'describe', expressionType: 'cron', expression: '0 * * * * * *' } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', 'Every minute']] }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should describe dates expression now+2s', async function (t) {
            const test = {
                description: t.name,
                send: { payload: { command: 'describe', expressionType: 'dates', expression: [Date.now() + 2000] } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string']] }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should export schedule1 by topic', async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'export', payload: 'schedule1' },
                expected: { command: 'export', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should export static schedule1 by payload', async function (t) {
            const test = {
                description: t.name,
                send: { topic: '', payload: { command: 'export', name: 'schedule1' } },
                expected: { command: 'export', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should export static schedule1 by topic', async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'export', payload: 'schedule1' },
                expected: { command: 'export', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            result.payload.should.have.property('command').which.is.an.Object()
            result.payload.should.have.property('result').which.is.an.Object()
            result.payload.should.not.have.property('status')
            result.payload.result.should.not.have.property('status')
            commandChecker(result, test)
        })
        it('should list static schedule1 by topic', async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'list', payload: 'schedule1' },
                expected: { command: 'list', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            result.payload.should.have.property('command').which.is.an.Object()
            result.payload.should.have.property('result').which.is.an.Object()
            result.payload.result.should.have.property('config').which.is.an.Object()
            result.payload.result.should.have.property('status').which.is.an.Object()
            commandChecker(result, test)
        })
        it('should list static schedule1 by payload', async function (t) {
            const test = {
                description: t.name,
                send: { topic: '', payload: { command: 'list', name: 'schedule1' } },
                expected: { command: 'list', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status' of one schedule 'dynCron'", async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'status', payload: 'dyn-cron' },
                expected: { command: 'status', scheduleCount: 1 }
            }
            testNode.receive(createAddScheduleMsg({ name: 'dyn-cron' })) // add a dynamic cron schedule
            await sleep(50) // let it unwind

            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-all' by topic", async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'status-all', payload: '' },
                expected: { command: 'status-all', scheduleCount: 5 } // 4 static + 1 dynamic
            }
            testNode.receive(createAddScheduleMsg({ name: 'dyn' }))
            await sleep(50) // let it unwind

            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-all' by command", async function (t) {
            const test = {
                description: t.name,
                send: { topic: '', payload: { command: 'status-all' } },
                expected: { command: 'status-all', scheduleCount: 4 } // 4 static schedules
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-all-dynamic' by topic (no dynamic schedules)", async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'status-all-dynamic', payload: '' },
                expected: { command: 'status-all-dynamic', scheduleCount: 0 }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-all-dynamic' by topic (2 dynamic schedules)", async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'status-all-dynamic', payload: '' },
                expected: { command: 'status-all-dynamic', scheduleCount: 2 }
            }
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1' }))
            await sleep(20) // let it unwind
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2' }))
            await sleep(30) // let it unwind

            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)

            result.payload.should.have.property('result').which.is.an.Array()
            result.payload.result.should.have.length(2)
            result.payload.result[0].config.should.have.property('name').which.is.a.String()
            result.payload.result[0].config.name.should.eql('dyn-1')
            result.payload.result[1].config.should.have.property('name').which.is.a.String()
            result.payload.result[1].config.name.should.eql('dyn-2')
        })
        it("should get 'status-all-static' by topic", async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'status-all-static', payload: '' },
                expected: { command: 'status-all-static', scheduleCount: 4 }
            }
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-inactive' by topic", async function (t) {
            const test = {
                description: t.name,
                send: { topic: 'status-inactive', payload: '' },
                expected: { command: 'status-inactive', scheduleCount: 1 }
            }
            // pause schedule3
            testNode.receive({ topic: 'pause', payload: 'schedule3' })
            await sleep(50) // let it unwind

            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
            result.should.have.property('payload').which.is.an.Object()
            result.payload.should.have.property('result').which.is.an.Array()
            result.payload.result.should.have.length(1)
            result.payload.result[0].should.have.keys('config', 'status')
            result.payload.result[0].config.should.have.property('name', 'schedule3')
        })

        it("should 'stop' by topic (should reset counter)", { timeout: 6000 }, async function () {
            await alignToSecondBoundary()
            // setup add dyn-1 and dyn-2
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 3, expression: '* * * * * * *' })) // every 1 seconds
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2' }))
            await sleep(2100) // wait 2 seconds - should only 2 should be triggered

            const messages = []
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    messages.push(msg)
                    if (messages.length >= 11) {
                        resolve()
                    }
                })
            })

            testNode.receive({ topic: 'status-active', payload: '' }) // check status of active schedules before stopping
            testNode.receive({ topic: 'status-active-static', payload: '' }) // check status of active schedules before stopping
            testNode.receive({ topic: 'status-active-dynamic', payload: '' }) // check status of active schedules before stopping
            await sleep(1100) // wait 1 more second for dyn-1 to be triggered another time
            testNode.receive({ topic: 'status-inactive', payload: '' }) // now that dyn-1 was triggered 3 times, it should be inactive due to its limit
            testNode.receive({ topic: 'stop', payload: 'schedule2' }) // stop schedule2 (no output expected)
            testNode.receive({ topic: 'stop', payload: 'dyn-1' }) // stop dyn-1 (no output expected)
            testNode.receive({ topic: 'status-inactive', payload: '' }) // check status of inactive schedules
            testNode.receive({ topic: 'status-inactive-static', payload: '' }) // check status of inactive schedules
            testNode.receive({ topic: 'status-inactive-dynamic', payload: '' }) // check status of inactive schedules
            testNode.receive({ topic: 'status-active', payload: '' }) // check status of active schedules
            testNode.receive({ topic: 'status-active-static', payload: '' }) // check status of active schedules
            testNode.receive({ topic: 'status-active-dynamic', payload: '' }) // check status of active schedules
            testNode.receive({ topic: 'start-all', payload: '' }) // start all schedules (no output expected)
            sleep(100)
            testNode.receive({ topic: 'status-active', payload: '' })
            await resultPromise
            messages.should.have.length(11)
            // before stopping 2 schedules (1 static and 1 dynamic)
            commandChecker(messages[0], { description: 'check status of active schedules should be 6', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 6 } })
            countChecker('dyn-1', messages[0].payload.result[4], 3, 2, true) // dyn-1 should have triggered 2 times & still be running
            commandChecker(messages[1], { description: 'check status of active-static schedules should be 4', send: { topic: 'status-active-static', payload: '' }, expected: { command: 'status-active-static', scheduleCount: 4 } })
            commandChecker(messages[2], { description: 'check status of active-dynamic schedules should be 2', send: { topic: 'status-active-dynamic', payload: '' }, expected: { command: 'status-active-dynamic', scheduleCount: 2 } })
            // after waiting another second
            commandChecker(messages[3], { description: 'check status of active inactive should be 1', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 1 } })
            countChecker('dyn-1', messages[3].payload.result[0], 3, 3, false) // dyn-1 should have triggered 3 times and should NOT be running

            // after stopping 2 schedules
            commandChecker(messages[4], { description: 'check status of inactive schedules should be 2', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 2 } })
            commandChecker(messages[5], { description: 'check status of inactive-static schedules should be 1', send: { topic: 'status-inactive-static', payload: '' }, expected: { command: 'status-inactive-static', scheduleCount: 1 } })
            commandChecker(messages[6], { description: 'check status of inactive-dynamic schedules should be 1', send: { topic: 'status-inactive-dynamic', payload: '' }, expected: { command: 'status-inactive-dynamic', scheduleCount: 1 } })
            commandChecker(messages[7], { description: 'check status of active schedules should be 4', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 4 } })
            commandChecker(messages[8], { description: 'check status of active-static schedules should be 3', send: { topic: 'status-active-static', payload: '' }, expected: { command: 'status-active-static', scheduleCount: 3 } })
            commandChecker(messages[9], { description: 'check status of active-dynamic schedules should be 1', send: { topic: 'status-active-dynamic', payload: '' }, expected: { command: 'status-active-dynamic', scheduleCount: 1 } })
            // after starting all schedules
            commandChecker(messages[10], { description: 'check status of active schedules should be 6', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 6 } })
            countChecker('dyn-1', messages[10].payload.result[4], 3, 0, true) // since schedules were stopped, the counter should be reset to 0
        })
        it("should 'pause' by topic (should not reset counter)", { timeout: 8000 }, async function () {
            await alignToSecondBoundary()
            // start flow for test has 3 static schedules, below we add 2 dynamic schedules
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 3, expression: '* * * * * * *' })) // every 1 seconds
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2' }))
            await sleep(2050) // wait 2 seconds - should only 2 should be triggered

            const messages = []
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    messages.push(msg)
                    if (messages.length >= 4) {
                        resolve()
                    }
                })
            })

            testNode.receive({ topic: 'status-active', payload: '' }) // check status of active schedules before stopping
            testNode.receive({ topic: 'pause', payload: 'dyn-1' }) // stop dyn-1 (no output expected)
            await sleep(2050) // wait 2 seconds - for dyn-1 should not increase
            testNode.receive({ topic: 'status-inactive', payload: '' })
            testNode.receive({ topic: 'start', payload: 'dyn-1' }) // start dyn-1 (no output expected)
            await sleep(10)
            testNode.receive({ topic: 'status-active', payload: '' })
            await sleep(1050) // wait 1 seconds for dyn-1 to trigger again
            testNode.receive({ topic: 'status-inactive', payload: '' })
            await resultPromise
            messages.should.have.length(4)
            // status-active, before pausing, dyn-1 should have triggered 2 times & still be running
            commandChecker(messages[0], { description: 'check status of active schedules should be 6', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 6 } })
            countChecker('dyn-1', messages[0].payload.result[4], 3, 2, true) // dyn-1 should have triggered 2 times & still be running
            // after pausing & waiting 2 seconds, dyn-1 should still be running and count should still be 2
            commandChecker(messages[1], { description: 'check status of active schedules should be 1', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 1 } })
            countChecker('dyn-1', messages[1].payload.result[0], 3, 2, false) // dyn-1 should still have only triggered 2 times
            // after starting all, active count should be 6 again
            commandChecker(messages[2], { description: 'check status of active schedules should be 6', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 6 } })
            countChecker('dyn-1', messages[2].payload.result[4], 3, 2, true) // dyn-1 should still have triggered 2 times & still be running
            // after waiting another second, dyn-1 should have triggered 3 times and should have reached its limit & stopped
            commandChecker(messages[3], { description: 'check status of inactive schedules should be 1', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 1 } })
            countChecker('dyn-1', messages[3].payload.result[0], 3, 3, false) // dyn-1 should have triggered 3 times and should NOT be running
        })
        it('should not reset count when finished schedule is updated (default behaviour)', { timeout: 7000 }, async function () {
            await alignToSecondBoundary()
            // setup add dyn-1
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 1, expression: '* * * * * * *' })) // every 1 seconds

            const messages = []
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    messages.push(msg)
                    if (messages.length >= 3) {
                        resolve()
                    }
                })
            })

            testNode.receive({ topic: 'status-active', payload: '' }) // check status of active schedules before stopping
            await sleep(1100) // wait 1
            testNode.receive({ topic: 'status-inactive', payload: '' }) // check status of inactive schedules before stopping
            // replace dyn-1 with a new one
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 1, expression: '* * * * * * *', topic: 'dyn-1-update' })) // every 1 seconds
            testNode.receive({ topic: 'status-all', payload: '' }) // check status of all schedules before stopping

            await resultPromise
            messages.should.have.length(3)
            // at first, dyn-1 should be active
            commandChecker(messages[0], { description: 'check status of active schedules should be 5', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 5 } })
            countChecker('dyn-1', messages[0].payload.result[4], 1, 0, true) // dyn-1 should have triggered 0 times
            // after waiting 1 second, dyn-1 should have triggered 1 time and should be no longer be running
            commandChecker(messages[1], { description: 'check status of inactive schedules should be 1', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 1 } })
            countChecker('dyn-1', messages[1].payload.result[0], 1, 1, false) // dyn-1 should have triggered 1 time and should NOT be running
            // after replacing dyn-1, it should be active again
            const dyn1 = messages[2].payload.result.find(s => s.config.name === 'dyn-1')
            should.exist(dyn1, 'dyn-1 should be in the result')
            dyn1.should.have.property('status').which.is.an.Object()
            dyn1.status.should.have.property('count', 1)
            dyn1.status.should.have.property('isRunning', false)
        })
        it('should apply provided count when updating a task', { timeout: 7000 }, async function () {
            await alignToSecondBoundary()
            // setup add dyn-1
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 1, expression: '* * * * * * *' })) // every 1 seconds

            const messages = []
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    messages.push(msg)
                    if (messages.length >= 3) {
                        resolve()
                    }
                })
            })

            testNode.receive({ topic: 'status-active', payload: '' }) // check status of active schedules before stopping
            await sleep(1100) // wait 1
            testNode.receive({ topic: 'status-inactive', payload: '' }) // check status of inactive schedules before stopping
            // replace dyn-1 with a new one
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 1, expression: '* * * * * * *', count: 0, topic: 'dyn-1-update' })) // every 1 seconds
            testNode.receive({ topic: 'status-all', payload: '' }) // check status of all schedules before stopping

            await resultPromise
            messages.should.have.length(3)
            // at first, dyn-1 should be active
            commandChecker(messages[0], { description: 'check status of active schedules should be 5', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 5 } })
            countChecker('dyn-1', messages[0].payload.result[4], 1, 0, true) // dyn-1 should have triggered 0 times
            // after waiting 1 second, dyn-1 should have triggered 1 time and should be no longer be running
            commandChecker(messages[1], { description: 'check status of inactive schedules should be 1', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 1 } })
            countChecker('dyn-1', messages[1].payload.result[0], 1, 1, false) // dyn-1 should have triggered 1 time and should NOT be running
            // after replacing dyn-1, it should be active again
            const dyn1 = messages[2].payload.result.find(s => s.config.name === 'dyn-1')
            should.exist(dyn1, 'dyn-1 should be in the result')
            dyn1.should.have.property('status').which.is.an.Object()
            dyn1.status.should.have.property('count', 0)
            dyn1.status.should.have.property('isRunning', true)
        })
        it('should apply provided count when creating a task (clamped by limit)', { timeout: 7000 }, async function () {
            // setup add dyn-1
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2', limit: 1, count: 2, expression: '* * * * * * *' })) // every 1 seconds

            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })

            testNode.receive({ topic: 'status-all', payload: '' })

            const msg = await resultPromise

            commandChecker(msg, { description: 'check count of schedules should be 5', send: { topic: 'status-all', payload: '' }, expected: { command: 'status-all', scheduleCount: 5 } })

            const dyn1 = msg.payload.result.find(s => s.config.name === 'dyn-2')
            should.exist(dyn1, 'dyn-2 should be in the result')
            dyn1.should.have.property('status').which.is.an.Object()
            dyn1.status.should.have.property('count', 1) // because the limit is 1, but the count is set to 2, it should be 1
            dyn1.status.should.have.property('isRunning', false)
        })
        // test dynamic capabilities
        it('should add a schedule dynamically', async function () {
            const msg = createAddScheduleMsg({ name: 'dynamic1', topic: 'dynamic1', expression: '0 0 * * * * *', expressionType: 'cron', payloadType: 'default', limit: 1 })
            testNode.receive(msg)
            sleep(50) // let it unwind
            const resultPromise = new Promise(resolve => {
                helperNodeDynamicSchedules.on('input', (msg) => {
                    resolve(msg)
                })
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            // trigger the dynamic schedule
            testNode.receive({ topic: 'trigger', payload: 'dynamic1' }) // fire input of testNode
            const result = await resultPromise
            dynamicScheduleTest(result)
            result.should.have.property('scheduledEvent', false) // because it was manually triggered
            result.topic.should.eql('dynamic1')
        })
        it('should remove a static schedule dynamically', async function (t) {
            const msg = { topic: 'remove', payload: 'schedule1' }
            testNode.receive(msg)
            sleep(50) // let it unwind
            const resultPromise = new Promise(resolve => {
                helperNodeCommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            const test = {
                description: t.name,
                send: { topic: 'status-all', payload: '' },
                expected: { command: 'status-all', scheduleCount: 3 }
            }
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should throw catchable error when triggering non-existing schedule', async function () {
            const resultPromise = new Promise(resolve => {
                catchHelper.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive({ topic: 'trigger', payload: 'schedule-non-existing' }) // fire input of testNode
            const result = await resultPromise
            result.should.have.property('payload', 'schedule-non-existing')
            result.should.have.property('topic', 'trigger')
            result.should.have.property('error').which.is.an.Object()
            result.error.should.have.property('message', 'Error: Manual Trigger failed. Cannot find schedule named \'schedule-non-existing\'')
        })
        it('should trigger complete node when triggering existing schedule', async function () {
            const resultPromise = new Promise(resolve => {
                completeHelper.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive({ topic: 'trigger', payload: 'schedule1' }) // fire input of testNode
            const result = await resultPromise
            result.should.have.property('payload', 'schedule1')
            result.should.have.property('topic', 'trigger')
        })
    })

    describe('custom solar angle schedules - end to end regression', function () {
        // this describe block deliberately does NOT nest inside 'extended tests' - it needs its
        // own isolated flow (rather than the large shared testNode flow used above) so this
        // schedule is the *only* task on the node and node.status() always reflects it, with no
        // risk of another schedule elsewhere in the shared flow racing to be "next" and masking
        // the result. Nesting inside 'extended tests' would double-load the shared flow (which
        // its own beforeEach already loaded) and fail with a "already wrapped" sinon error.
        it('correctly runs a dynamically added custom-angle solar schedule end to end', async function () {
            const flow = [
                { id: 'helperCmd2', type: 'helper' },
                {
                    id: 'angleEndToEndNode',
                    type: 'cronplus',
                    name: 'angle-end-to-end',
                    outputField: 'payload',
                    timeZone: '',
                    persistDynamic: false,
                    commandResponseMsgOutput: 'output1',
                    outputs: 1,
                    options: [],
                    wires: [['helperCmd2']]
                }
            ]
            await helper.load(cronplusNode, flow)
            const node = helper.getNode('angleEndToEndNode')
            const helperCmd = helper.getNode('helperCmd2')

            node.receive({
                payload: {
                    command: 'add',
                    name: 'dynGoodAngle',
                    topic: 'dynGoodAngle',
                    expressionType: 'solar',
                    location: '54.9992500,-1.4170300',
                    solarType: 'customRising',
                    solarEvents: '-4',
                    offset: 0,
                    payloadType: 'default'
                }
            })
            await sleep(50)

            const noWarnings = node.warn.getCalls().filter(c => c.args[0] && String(c.args[0].message || c.args[0]).includes('degrees between -90 and 90'))
            noWarnings.should.have.length(0)

            // 'status' forces an immediate (non-debounced) node.status() update - this is the
            // real regression check: parseSolarTimes() (the function that builds the *actual*
            // scheduled date sequence used to fire the schedule) must pass solarType through to
            // getSolarTimes(), otherwise the custom angle is silently treated as an empty/invalid
            // "selected events" CSV, the task ends up with no future date, and node.status()
            // never reports a valid (fill: 'blue') next-fire status - the schedule never fires.
            // Checking the 'list'/'describe' command output is NOT sufficient here: those
            // independently recompute the description fresh each time and would report a
            // plausible result even when the actual scheduled task itself is broken.
            node.status.resetHistory()
            node.receive({ payload: { command: 'status', name: 'dynGoodAngle' } })
            await sleep(50)
            const matchingStatus = node.status.getCalls().find(c => c.args[0] && c.args[0].fill === 'blue' &&
                typeof c.args[0].text === 'string' && /below the horizon/.test(c.args[0].text))
            should(matchingStatus).not.be.undefined()

            const resultPromise = new Promise(resolve => {
                helperCmd.once('input', (msg) => resolve(msg))
            })
            node.receive({ payload: { command: 'list', name: 'dynGoodAngle' } })
            const result = await resultPromise
            result.payload.result.should.have.property('config').which.is.an.Object()
            result.payload.result.config.should.have.property('solarType', 'customRising')
            result.payload.result.config.should.have.property('solarEvents', '-4')
            result.payload.result.should.have.property('status').which.is.an.Object()
            result.payload.result.status.should.have.property('nextDescription').which.is.a.String()
            result.payload.result.status.nextDescription.should.match(/below the horizon/)
            result.payload.result.status.should.have.property('nextDate').which.is.not.null()
        })

        it("accepts a dynamic custom-angle schedule with no location when the node's default location is 'fixed'", async function () {
            // regression test: a dynamic add is validated before the node's own "Default
            // Location" (fixed/env) setting is applied to it - this was already fixed once for
            // preset solarType ('selected'/'all') schedules, but this codebase was rebuilt from a
            // fresh main branch upload rather than branched from that fix, so it silently
            // regressed for the new customRising/customSetting types too. Guarding both here.
            const flow = [
                { id: 'helperCmd3', type: 'helper' },
                {
                    id: 'defLocAngleNode',
                    type: 'cronplus',
                    name: 'default-location-angle-test',
                    outputField: 'payload',
                    timeZone: '',
                    defaultLocationType: 'fixed',
                    defaultLocation: '54.9992500,-1.4170300',
                    persistDynamic: false,
                    commandResponseMsgOutput: 'output1',
                    outputs: 1,
                    options: [],
                    wires: [['helperCmd3']]
                }
            ]
            await helper.load(cronplusNode, flow)
            const node = helper.getNode('defLocAngleNode')
            const helperCmd = helper.getNode('helperCmd3')

            node.receive({
                payload: {
                    command: 'add',
                    name: 'customDawn',
                    topic: 'customDawn',
                    expressionType: 'solar',
                    solarType: 'customRising',
                    solarEvents: '-4',
                    payloadType: 'default'
                    // no `location` - the node-level default must supply it
                }
            })
            await sleep(50)

            const locationWarnings = node.warn.getCalls().filter(c => c.args[0] && String(c.args[0].message || c.args[0]).includes('location property missing'))
            locationWarnings.should.have.length(0)

            const resultPromise = new Promise(resolve => helperCmd.once('input', resolve))
            node.receive({ payload: { command: 'list', name: 'customDawn' } })
            const result = await resultPromise
            result.payload.result.should.have.property('config').which.is.an.Object()
            result.payload.result.config.should.have.property('location', '54.9992500,-1.4170300')
            result.payload.result.config.should.have.property('solarType', 'customRising')
            result.payload.result.config.should.have.property('solarEvents', '-4')
            result.payload.result.status.nextDescription.should.match(/below the horizon/)
        })
    })

    describe('dynamic schedules and the node-level default location', function () {
        // Bug: a dynamic solar/lunar schedule added/updated via msg is validated *before* the
        // node's own "Default Location" (fixed/env) setting is applied to it - that only
        // happened for static schedules, via createTask() -> applyOptionDefaults(). A dynamic
        // schedule that omits `location` - expecting the node-level default to supply it, exactly
        // as static schedules already do - was incorrectly rejected with
        // "location property missing", even though the node has a perfectly valid default
        // location configured. Fixed in updateTask() by applying the same node-level
        // defaultLocationType check before validateOpt() runs.
        //
        // Uses its own isolated flow (rather than the large shared flow used by 'extended tests')
        // so each node config here is deliberately minimal and the location behaviour under test
        // isn't obscured by unrelated schedules.
        const makeNode = (id, defaultLocationType, defaultLocation) => ([
            { id: id + 'Cmd', type: 'helper' },
            {
                id,
                type: 'cronplus',
                name: 'default-location-test',
                outputField: 'payload',
                timeZone: '',
                defaultLocationType,
                defaultLocation,
                persistDynamic: false,
                commandResponseMsgOutput: 'output1',
                outputs: 1,
                options: [],
                wires: [[id + 'Cmd']]
            }
        ])

        it("accepts a dynamic solar schedule with no location when the node's default location is 'fixed'", async function () {
            await helper.load(cronplusNode, makeNode('defLocFixed', 'fixed', '54.9992500,-1.4170300'))
            const node = helper.getNode('defLocFixed')
            const helperCmd = helper.getNode('defLocFixedCmd')

            node.receive({
                payload: {
                    command: 'add',
                    name: 'testAlarm',
                    topic: 'testAlarm',
                    expressionType: 'solar',
                    solarType: 'selected',
                    solarEvents: 'sunrise,sunset',
                    offset: 0,
                    payloadType: 'default'
                    // no `location` - the node-level default must supply it
                }
            })
            await sleep(50)

            const locationWarnings = node.warn.getCalls().filter(c => c.args[0] && String(c.args[0].message || c.args[0]).includes('location property missing'))
            locationWarnings.should.have.length(0)

            const resultPromise = new Promise(resolve => helperCmd.once('input', resolve))
            node.receive({ payload: { command: 'list', name: 'testAlarm' } })
            const result = await resultPromise
            result.payload.result.should.have.property('config').which.is.an.Object()
            result.payload.result.config.should.have.property('location', '54.9992500,-1.4170300')
            result.payload.result.config.should.have.property('solarEvents', 'sunrise,sunset')
        })

        it("accepts a dynamic lunar schedule with no location when the node's default location is 'fixed'", async function () {
            await helper.load(cronplusNode, makeNode('defLocFixedLunar', 'fixed', '54.9992500,-1.4170300'))
            const node = helper.getNode('defLocFixedLunar')
            const helperCmd = helper.getNode('defLocFixedLunarCmd')

            node.receive({
                payload: {
                    command: 'add',
                    name: 'testMoon',
                    topic: 'testMoon',
                    expressionType: 'lunar',
                    lunarType: 'all',
                    offset: 0,
                    payloadType: 'default'
                    // no `location` - the node-level default must supply it
                }
            })
            await sleep(50)

            const locationWarnings = node.warn.getCalls().filter(c => c.args[0] && String(c.args[0].message || c.args[0]).includes('location property missing'))
            locationWarnings.should.have.length(0)

            const resultPromise = new Promise(resolve => helperCmd.once('input', resolve))
            node.receive({ payload: { command: 'list', name: 'testMoon' } })
            const result = await resultPromise
            result.payload.result.should.have.property('config').which.is.an.Object()
            result.payload.result.config.should.have.property('location', '54.9992500,-1.4170300')
        })

        it("still requires a location on a dynamic schedule when the node's default location is 'per schedule'", async function () {
            // sanity check the fix doesn't over-relax validation for the normal case
            await helper.load(cronplusNode, makeNode('defLocPerSchedule', 'default', ''))
            const node = helper.getNode('defLocPerSchedule')

            node.receive({
                payload: {
                    command: 'add',
                    name: 'noLocation',
                    topic: 'noLocation',
                    expressionType: 'solar',
                    solarType: 'all',
                    offset: 0,
                    payloadType: 'default'
                    // no `location`, and no node-level default either - this must still fail
                }
            })
            await sleep(50)

            const locationWarnings = node.warn.getCalls().filter(c => c.args[0] && String(c.args[0].message || c.args[0]).includes('location property missing'))
            locationWarnings.should.have.length(1)
        })
    })
})
