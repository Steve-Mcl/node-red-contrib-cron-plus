const should = require('should')
const helper = require('node-red-node-test-helper')
const cronplusNode = require('../cronplus.js')

/* global describe, it, beforeEach, afterEach */

helper.init(require.resolve('node-red'))

describe('cron-plus Node', function () {
    'use strict'

    beforeEach(done => { helper.startServer(done) })

    afterEach(async () => {
        if (helper) {
            await helper.clearFlows()
            await helper.unload()
            helper.stopServer()
        }
    })

    it('should inject within 1 sec from cron expression * * * * * * *', function (done) {
        this.timeout(1100) // timeout with an error if done() isn't called in time
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
        it('should inject value of type ' + payloadType + ' in msg.' + outputField, function (done) {
            this.timeout(2000) // timeout with an error if done() isn't called in time
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

    const getTestFlow = (nodeName = 'testNode') => {
        return [
            { id: 'helperNode1', type: 'helper' },
            { id: 'helperNode2', type: 'helper' },
            { id: 'helperNode3', type: 'helper' },
            { id: 'helperNode4', type: 'helper' },
            { id: 'helperNode5', type: 'helper' },
            {
                id: nodeName,
                type: 'cronplus',
                name: '',
                outputField: 'payload',
                timeZone: '',
                persistDynamic: false,
                commandResponseMsgOutput: 'fanOut',
                outputs: 5,
                options: [
                    { name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0 * * * * * *', location: '', offset: '0' },
                    { name: 'schedule2', topic: 'schedule2', payloadType: 'default', payload: '', expressionType: 'dates', expression: [Date.now() + 60000, Date.now() + 120000], location: '', offset: '0' },
                    { name: 'schedule3', topic: 'schedule3', payloadType: 'default', payload: '', expressionType: 'solar', expression: '0 * * * * * *', location: '55.0 -1.418', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' }
                ],
                wires: [['helperNode1'], ['helperNode2'], ['helperNode3'], ['helperNode4'], ['helperNode5']]
            }
        ]
    }

    it('should generate various values to 5 outputs (fan out test)', done => {
        const cronNodeName = 't3n1'
        const flow = getTestFlow(cronNodeName)
        this.timeout(2000) // timeout with an error if done() isn't called within one second

        helper.load(cronplusNode, flow, function () {
            try {
                const helperNode1 = helper.getNode('helperNode1')
                const helperNode2 = helper.getNode('helperNode2')
                const helperNode3 = helper.getNode('helperNode3')
                const helperNode4 = helper.getNode('helperNode4')
                const helperNode5 = helper.getNode('helperNode5')
                const testNode = helper.getNode(cronNodeName)

                should(helperNode1).not.be.null()
                should(helperNode2).not.be.null()
                should(helperNode3).not.be.null()
                should(helperNode4).not.be.null()
                should(helperNode5).not.be.null()
                should(testNode).not.be.null()
                testNode.should.have.property('id', cronNodeName)

                const configChecker = function (config) {
                    // it('should be a valid config object ', function (done) {
                    //     try {
                    should(config).not.be.Null()
                    config.should.have.keys('topic', 'name', 'payload')
                    config.should.have.property('payloadType', 'default')
                    config.should.have.property('expressionType')
                    if (config.expressionType === 'solar') {
                        config.should.have.property('location')
                    } else {
                        config.should.have.property('expression')
                    }
                    //        done();
                    //     } catch (error) {
                    //         done(error);
                    //     }
                    // });
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
                    //        done();
                    //     } catch (error) {
                    //         done(error);
                    //     }
                    // });
                }

                const commandChecker = function (msg, test) {
                    /*
                        topic:'schedule1'
                        timeZone:'Europe/London'
                        solarType:'all'
                        solarEvents:'sunrise,sunset'
                        payloadType:'default'
                        name:'schedule1'
                        location:'54.9992500,-1.4170300' - or - expression
                        expressionType:'solar'
                        command:'describe'
                    */
                    // context("cron-plus command check", function () {

                    it('should ' + test.description, function (done) {
                        try {
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
                                if (command.expressionType === 'solar') {
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
                            } else if (command.command === 'export') {
                                configChecker(result)
                            } else if (command.command === 'status') {
                                result.should.have.property('config').which.is.an.Object()
                                result.should.have.property('status').which.is.an.Object()
                                configChecker(result.config)
                                statusChecker(result.status)
                            } else if (command.command.indexOf('status-') === 0) {
                                should(Array.isArray(result)).be.true('check result should be an array')
                                if (Object.prototype.hasOwnProperty.call(test.expected, 'scheduleCount')) {
                                    result.should.have.property('length')
                                    should(result.length).eql(test.expected.scheduleCount, 'Check number of schedules in response')
                                }
                                for (const r of result) {
                                    r.should.have.property('config').which.is.an.Object()
                                    r.should.have.property('status').which.is.an.Object()
                                    configChecker(r.config)
                                    statusChecker(r.status)
                                }
                            }
                            done()
                        } catch (error) {
                            done(error)
                        }
                    })
                    // });
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

                const commandTests = [
                    {
                        description: 'describe solar events for a location',
                        send: { payload: { command: 'describe', expressionType: 'solar', location: '54.9992500,-1.4170300', solarType: 'all', timeZone: 'Europe/London' } },
                        expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', 'All Solar Events']] }
                    },
                    {
                        description: 'describe cron expression 0 * * * * * *',
                        send: { payload: { command: 'describe', expressionType: 'cron', expression: '0 * * * * * *' } },
                        expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', 'Every minute']] }
                    },
                    {
                        description: 'describe dates expression now+2s',
                        send: { payload: { command: 'describe', expressionType: 'dates', expression: [Date.now() + 2000] } },
                        expected: { command: 'describe', propertyValues: [['payload.result.description', 'string']] }
                    },
                    {
                        description: 'Export schedule1',
                        send: { topic: 'export', payload: 'schedule1' },
                        expected: { command: 'export', scheduleCount: 1 }
                    },
                    {
                        description: "test 'status' of one schedule 'dynCron'",
                        send: { topic: 'status', payload: 'dynCron' },
                        expected: { command: 'status', scheduleCount: 1 }
                    },
                    {
                        description: "test 'status-all' command",
                        send: { topic: 'status-all', payload: '' },
                        expected: { command: 'status-all', scheduleCount: 5 }
                    },
                    {
                        description: "test 'status-all' command",
                        send: { topic: 'status-all-dynamic', payload: '' },
                        expected: { command: 'status-all-dynamic', scheduleCount: 2 }
                    },
                    {
                        description: "test 'status-all' command",
                        send: { topic: 'status-all-static', payload: '' },
                        expected: { command: 'status-all-static', scheduleCount: 3 }
                    },
                    {
                        description: "test 'status-inactive' command",
                        send: { topic: 'status-inactive', payload: '' },
                        expected: { command: 'status-inactive', scheduleCount: 1 }
                    },
                    {
                        description: "test 'stop' command",
                        send: { topic: 'stop', payload: 'schedule3' },
                        expected: null
                    },
                    {
                        description: "test 'status-inactive' command",
                        send: { topic: 'status-inactive', payload: '' },
                        expected: { command: 'status-inactive', scheduleCount: 2 }
                    },
                    {
                        description: "test 'status-active' command",
                        send: { topic: 'status-active', payload: '' },
                        expected: { command: 'status-active', scheduleCount: 3 }
                    },
                    {
                        description: "test 'status-inactive-static' command",
                        send: { topic: 'status-inactive-static', payload: '' },
                        expected: { command: 'status-inactive-static', scheduleCount: 1 }
                    },
                    {
                        description: "test 'status-active-static' command",
                        send: { topic: 'status-active-static', payload: '' },
                        expected: { command: 'status-active-static', scheduleCount: 2 }
                    },
                    {
                        description: "test 'remove' schedule3",
                        send: { topic: 'remove', payload: 'schedule3' },
                        expected: null
                    },
                    {
                        description: "test 'status-all-static' command",
                        send: { topic: 'status-all-static', payload: '' },
                        expected: { command: 'status-all-static', scheduleCount: 2 }
                    },
                    {
                        description: "test 'status-active-dynamic' command",
                        send: { topic: 'status-active-dynamic', payload: '' },
                        expected: { command: 'status-active-dynamic', scheduleCount: 1 }
                    },
                    {
                        description: "test 'status-inactive-dynamic' command",
                        send: { topic: 'status-inactive-dynamic', payload: '' },
                        expected: { command: 'status-inactive-dynamic', scheduleCount: 1 }
                    },
                    {
                        description: "test 'remove-inactive-dynamic' command",
                        send: { topic: 'remove-inactive-dynamic', payload: '' },
                        expected: null
                    },
                    {
                        description: "test 'status-all' command",
                        send: { topic: 'status-all', payload: '' },
                        expected: { command: 'status-all', scheduleCount: 3 }
                    },
                    {
                        description: "test 'remove-active-dynamic' command",
                        send: { topic: 'remove-active-dynamic', payload: '' },
                        expected: null
                    },
                    {
                        description: "test 'status-all' command",
                        send: { topic: 'status-all', payload: '' },
                        expected: { command: 'status-all', scheduleCount: 2 }
                    }
                ]

                const commandResults = []
                helperNode1.on('input', function (msg) {
                    staticScheduleTest(msg)
                })
                helperNode2.on('input', function (msg) {
                    staticScheduleTest(msg)
                })
                helperNode3.on('input', function (msg) {
                    staticScheduleTest(msg)
                })
                helperNode4.on('input', function (msg) {
                    dynamicScheduleTest(msg)
                })
                helperNode5.on('input', function (msg) {
                    commandResults.push(msg)
                    if (msg._testIndex >= (commandTests.length - 1)) {
                        describe('cron-plus command checks', function () {
                            for (const m of commandResults) {
                                const test = commandTests[m._testIndex]
                                if (test && test.expected) {
                                    commandChecker(m, test)
                                }
                            }
                        })
                        done()
                    }
                })

                // fire messages into the cron node
                testNode.receive({ topic: 'trigger', payload: 'schedule1' }) // fire input of testNode
                testNode.receive({ topic: 'trigger', payload: 'schedule2' }) // fire input of testNode
                testNode.receive({ topic: 'trigger', payload: 'schedule3' }) // fire input of testNode

                // add a dynamic cron schedule
                testNode.receive({
                    payload: {
                        command: 'add',
                        name: 'dynCron',
                        topic: 'dynCron',
                        expression: '0 0 * * * * *',
                        expressionType: 'cron',
                        payloadType: 'default',
                        limit: 1
                    }
                })

                // add an old inactive dynamic cron schedule
                testNode.receive({
                    payload: {
                        command: 'add',
                        name: 'dynCron2',
                        topic: 'dynCron2',
                        expression: '0 0 2 2 FEB * 2020',
                        expressionType: 'cron',
                        payloadType: 'default',
                        limit: 1
                    }
                })
                testNode.receive({ topic: 'trigger', payload: 'dynCron' }) // fire input of testNode

                for (let index = 0; index < commandTests.length; index++) {
                    const test = commandTests[index]
                    testNode.receive({ ...test.send, _testIndex: index })
                }
            } catch (error) {
                done(error)
            }
        })
    })

    // test dynamic capabilities
    it('should add a schedule dynamically', function (done) {
        this.timeout(2000) // timeout with an error if done() isn't called in time
        // flow: tab1, cronplus --> helper
        const flow = [
            { id: 'tab1', type: 'tab', label: 'Flow 1', env: [{ name: 'tabpos', value: '51.1, 1.1', type: 'str' }] },
            { id: 'cron.node', type: 'cronplus', name: 'test1', outputField: 'payload', commandResponseMsgOutput: 'output1', outputs: 1, options: [], wires: [['helper.node']], z: 'tab1' },
            { id: 'helper.node', type: 'helper', z: 'tab1' }
        ]

        helper.load(cronplusNode, flow, function () {
            const cronNode = helper.getNode('cron.node')
            const helperNode = helper.getNode('helper.node')

            helperNode.on('input', function (msg) {
                try {
                    msg.should.have.property('topic', 'dynamic1')
                    msg.should.have.property('payload')
                    done()
                } catch (err) {
                    done(err)
                }
            })
            // inject a cronplus schedule named dynamic1
            cronNode.receive({ payload: { command: 'add', name: 'dynamic1', topic: 'dynamic1', expressionType: 'cron', expression: '0 * * * * * *', payloadType: 'default', limit: 1 } })
            cronNode.receive({ topic: 'trigger', payload: 'dynamic1' }) // trigger schedule
        })
    })
    it('should remove a schedule dynamically', function (done) {
        this.timeout(2000) // timeout with an error if done() isn't called in time
        // static cron schedules
        const options = [
            { name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0 * * * * * *', location: '', offset: '0' },
            { name: 'schedule2', topic: 'schedule2', payloadType: 'default', payload: '', expressionType: 'dates', expression: [Date.now() + 60000, Date.now() + 120000], location: '', offset: '0' },
            { name: 'schedule3', topic: 'schedule3', payloadType: 'default', payload: '', expressionType: 'solar', expression: '0 * * * * * *', location: '55.0 -1.418', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' }
        ]

        // flow: tab1, cronplus --> helper
        const flow = [
            { id: 'tab1', type: 'tab', label: 'Flow 1', env: [{ name: 'tabpos', value: '51.1, 1.1', type: 'str' }] },
            { id: 'cron.node', type: 'cronplus', name: 'test1', outputField: 'payload', commandResponseMsgOutput: 'output1', outputs: 1, options, wires: [['helper.node']], z: 'tab1' },
            { id: 'helper.node', type: 'helper', z: 'tab1' }
        ]
        helper.load(cronplusNode, flow, function () {
            const cronNode = helper.getNode('cron.node')
            const helperNode = helper.getNode('helper.node')

            helperNode.on('input', function (msg) {
                try {
                    console.log(msg)
                    msg.should.have.property('topic', 'schedule2')
                    msg.should.have.property('payload')
                    helper.clearFlows().then(function () {
                        done()
                    })
                } catch (err) {
                    done(err)
                }
            })
            // inject a cronplus schedule named dynamic1
            cronNode.receive({ topic: 'remove', payload: 'schedule1' })
            cronNode.receive({ topic: 'trigger', payload: 'schedule1' }) // trigger schedule 1 - should not fire
            cronNode.receive({ topic: 'trigger', payload: 'schedule2' }) // trigger schedule 2 - should fire
        })
    })
})
