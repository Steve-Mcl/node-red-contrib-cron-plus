/// <reference types="should" />
const should = require('should')
const helper = require('node-red-node-test-helper')
const cronplusNode = require('../cronplus.js')
const { describe, it, beforeEach, afterEach } = require('mocha')

helper.init(require.resolve('node-red'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

describe('cron-plus Node', function () {
    'use strict'

    beforeEach(done => { helper.startServer(done) })

    afterEach((done) => {
        helper.unload().then(() => {
            helper.stopServer(done)
        })
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

    describe('extended tests', function () {
        const cronNodeName = 't3n1'

        const getTestFlow = (nodeName = 'testNode') => {
            return [
                { id: 'helperNode1', type: 'helper' },
                { id: 'helperNode2', type: 'helper' },
                { id: 'helperNode3', type: 'helper' },
                { id: 'helperNode4', type: 'helper' },
                { id: 'helperNode5', type: 'helper' },
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
                    outputs: 5,
                    options: [
                        { name: 'schedule1', topic: 'schedule1', payloadType: 'default', payload: '', expressionType: 'cron', expression: '0 * * * * * *', location: '', offset: '0' },
                        { name: 'schedule2', topic: 'schedule2', payloadType: 'default', payload: '', expressionType: 'dates', expression: [Date.now() + 60000, Date.now() + 120000], location: '', offset: '0' },
                        { name: 'schedule3', topic: 'schedule3', payloadType: 'default', payload: '', expressionType: 'solar', expression: '0 * * * * * *', location: '55.0 -1.418', offset: '0', solarType: 'all', solarEvents: 'sunrise,sunset' }
                    ],
                    wires: [['helperNode1'], ['helperNode2'], ['helperNode3'], ['helperNode4'], ['helperNode5']]
                },
                { id: 'catchNode1', type: 'catch', name: '', scope: [nodeName], uncaught: false, wires: [['catchHelper']] },
                { id: 'completeNode1', type: 'complete', name: '', scope: [nodeName], wires: [['completeHelper']] }
            ]
        }
        const flow = getTestFlow(cronNodeName)
        /** @type {nodeRed.Node<{}>} */ let helperNode1StaticSchedule1 = null
        /** @type {nodeRed.Node<{}>} */ let helperNode2StaticSchedule2 = null
        /** @type {nodeRed.Node<{}>} */ let helperNode3StaticSchedule3 = null
        /** @type {nodeRed.Node<{}>} */ let helperNode4DynamicSchedules = null
        /** @type {nodeRed.Node<{}>} */ let helperNode5CommandResponses = null
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
            helperNode4DynamicSchedules = helper.getNode('helperNode4')
            helperNode5CommandResponses = helper.getNode('helperNode5')
            testNode = helper.getNode(cronNodeName)
            catchNode1 = helper.getNode('catchNode1')
            catchHelper = helper.getNode('catchHelper')
            completeNode1 = helper.getNode('completeNode1')
            completeHelper = helper.getNode('completeHelper')

            should(helperNode1StaticSchedule1).not.be.null()
            should(helperNode2StaticSchedule2).not.be.null()
            should(helperNode3StaticSchedule3).not.be.null()
            should(helperNode4DynamicSchedules).not.be.null()
            should(helperNode5CommandResponses).not.be.null()
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
            helperNode4DynamicSchedules = null
            helperNode5CommandResponses = null
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
            if (config.expressionType === 'solar') {
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
        it("should 'trigger-all' by topic", async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'trigger-all', payload: '' },
                expected: { command: 'trigger-all', scheduleCount: 5 }
            }
            // add 2 dynamic schedules
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 3, expression: '* * * * * * *' })) // every 1 seconds
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2' }))
            await sleep(50) // let it unwind
            const messages = []
            const addMessage = (msg, resolver) => {
                messages.push(msg)
                if (messages.length >= 5) {
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
                helperNode4DynamicSchedules.on('input', (msg) => {
                    addMessage(msg, resolve)
                })
                helperNode5CommandResponses.on('input', (msg) => {
                    addMessage(msg, resolve)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            result.should.have.length(5)
            statusChecker(result[0].payload.status, 'static')
            statusChecker(result[1].payload.status, 'static')
            statusChecker(result[2].payload.status, 'static')
            statusChecker(result[3].payload.status, 'dynamic')
            statusChecker(result[4].payload.status, 'dynamic')
            configChecker(result[0].payload.config)
            configChecker(result[1].payload.config)
            configChecker(result[2].payload.config)
            configChecker(result[3].payload.config)
            configChecker(result[4].payload.config)
        })
        it('should add a dynamic cron schedule', async function () {
            const resultPromise = new Promise(resolve => {
                helperNode4DynamicSchedules.on('input', resolve)
            })
            testNode.receive(createAddScheduleMsg({ name: 'dynCron1', topic: 'xxx' })) // add a dynamic cron schedule
            testNode.receive({ topic: 'trigger', payload: 'dynCron1' }) // fire input of testNode
            const result = await resultPromise
            dynamicScheduleTest(result)
            result.topic.should.eql('xxx')
        })

        it('describe solar events for a location', async function () {
            const test = {
                description: this.test.title,
                send: { payload: { command: 'describe', expressionType: 'solar', location: '54.9992500,-1.4170300', solarType: 'all', timeZone: 'Europe/London' } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', 'All Solar Events']] }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should describe cron expression 0 * * * * * *', async function () {
            const test = {
                description: this.test.title,
                send: { payload: { command: 'describe', expressionType: 'cron', expression: '0 * * * * * *' } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string', 'Every minute']] }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should describe dates expression now+2s', async function () {
            const test = {
                description: this.test.title,
                send: { payload: { command: 'describe', expressionType: 'dates', expression: [Date.now() + 2000] } },
                expected: { command: 'describe', propertyValues: [['payload.result.description', 'string']] }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should export schedule1 by topic', async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'export', payload: 'schedule1' },
                expected: { command: 'export', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should export static schedule1 by payload', async function () {
            const test = {
                description: this.test.title,
                send: { topic: '', payload: { command: 'export', name: 'schedule1' } },
                expected: { command: 'export', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it('should export static schedule1 by topic', async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'export', payload: 'schedule1' },
                expected: { command: 'export', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
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
        it('should list static schedule1 by topic', async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'list', payload: 'schedule1' },
                expected: { command: 'list', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
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
        it('should list static schedule1 by payload', async function () {
            const test = {
                description: this.test.title,
                send: { topic: '', payload: { command: 'list', name: 'schedule1' } },
                expected: { command: 'list', scheduleCount: 1 }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status' of one schedule 'dynCron'", async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'status', payload: 'dyn-cron' },
                expected: { command: 'status', scheduleCount: 1 }
            }
            testNode.receive(createAddScheduleMsg({ name: 'dyn-cron' })) // add a dynamic cron schedule
            await sleep(50) // let it unwind

            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-all' by topic", async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'status-all', payload: '' },
                expected: { command: 'status-all', scheduleCount: 4 } // 3 + 1 dynamic
            }
            testNode.receive(createAddScheduleMsg({ name: 'dyn' }))
            await sleep(50) // let it unwind

            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-all' by command", async function () {
            const test = {
                description: this.test.title,
                send: { topic: '', payload: { command: 'status-all' } },
                expected: { command: 'status-all', scheduleCount: 3 } // 3 static schedules
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-all-dynamic' by topic (no dynamic schedules)", async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'status-all-dynamic', payload: '' },
                expected: { command: 'status-all-dynamic', scheduleCount: 0 }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-all-dynamic' by topic (2 dynamic schedules)", async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'status-all-dynamic', payload: '' },
                expected: { command: 'status-all-dynamic', scheduleCount: 2 }
            }
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1' }))
            await sleep(20) // let it unwind
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2' }))
            await sleep(30) // let it unwind

            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
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
        it("should get 'status-all-static' by topic", async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'status-all-static', payload: '' },
                expected: { command: 'status-all-static', scheduleCount: 3 }
            }
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            testNode.receive(test.send)
            const result = await resultPromise
            commandChecker(result, test)
        })
        it("should get 'status-inactive' by topic", async function () {
            const test = {
                description: this.test.title,
                send: { topic: 'status-inactive', payload: '' },
                expected: { command: 'status-inactive', scheduleCount: 1 }
            }
            // pause schedule3
            testNode.receive({ topic: 'pause', payload: 'schedule3' })
            await sleep(50) // let it unwind

            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
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

        it("should 'stop' by topic (should reset counter)", async function () {
            this.timeout(555000)
            // setup add dyn-1 and dyn-2
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 3, expression: '* * * * * * *' })) // every 1 seconds
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2' }))
            await sleep(2100) // wait 2 seconds - should only 2 should be triggered

            const messages = []
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
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
            // before stopping 2 schedules
            commandChecker(messages[0], { description: 'check status of active schedules should be 5', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 5 } })
            countChecker('dyn-1', messages[0].payload.result[3], 3, 2, true) // dyn-1 should have triggered 2 times & still be running
            commandChecker(messages[1], { description: 'check status of active-static schedules should be 3', send: { topic: 'status-active-static', payload: '' }, expected: { command: 'status-active-static', scheduleCount: 3 } })
            commandChecker(messages[2], { description: 'check status of active-dynamic schedules should be 2', send: { topic: 'status-active-dynamic', payload: '' }, expected: { command: 'status-active-dynamic', scheduleCount: 2 } })
            // after waiting another second
            commandChecker(messages[3], { description: 'check status of active inactive should be 1', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 1 } })
            countChecker('dyn-1', messages[3].payload.result[0], 3, 3, false) // dyn-1 should have triggered 3 times and should NOT be running

            // after stopping 2 schedules
            commandChecker(messages[4], { description: 'check status of inactive schedules should be 2', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 2 } })
            commandChecker(messages[5], { description: 'check status of inactive-static schedules should be 1', send: { topic: 'status-inactive-static', payload: '' }, expected: { command: 'status-inactive-static', scheduleCount: 1 } })
            commandChecker(messages[6], { description: 'check status of inactive-dynamic schedules should be 1', send: { topic: 'status-inactive-dynamic', payload: '' }, expected: { command: 'status-inactive-dynamic', scheduleCount: 1 } })
            commandChecker(messages[7], { description: 'check status of active schedules should be 3', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 3 } })
            commandChecker(messages[8], { description: 'check status of active-static schedules should be 2', send: { topic: 'status-active-static', payload: '' }, expected: { command: 'status-active-static', scheduleCount: 2 } })
            commandChecker(messages[9], { description: 'check status of active-dynamic schedules should be 1', send: { topic: 'status-active-dynamic', payload: '' }, expected: { command: 'status-active-dynamic', scheduleCount: 1 } })
            // after starting all schedules
            commandChecker(messages[10], { description: 'check status of active schedules should be 5', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 5 } })
            countChecker('dyn-1', messages[10].payload.result[3], 3, 0, true) // since schedules were stopped, the counter should be reset to 0
        })
        it("should 'pause' by topic (should not reset counter)", async function () {
            this.timeout(7000)
            // start flow for test has 3 static schedules, below we add 2 dynamic schedules
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 3, expression: '* * * * * * *' })) // every 1 seconds
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2' }))
            await sleep(2050) // wait 2 seconds - should only 2 should be triggered

            const messages = []
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
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
            commandChecker(messages[0], { description: 'check status of active schedules should be 5', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 5 } })
            countChecker('dyn-1', messages[0].payload.result[3], 3, 2, true) // dyn-1 should have triggered 2 times & still be running
            // after pausing & waiting 2 seconds, dyn-1 should still be running and count should still be 2
            commandChecker(messages[1], { description: 'check status of active schedules should be 1', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 1 } })
            countChecker('dyn-1', messages[1].payload.result[0], 3, 2, false) // dyn-1 should still have only triggered 2 times
            // after starting all, active count should be 5 again
            commandChecker(messages[2], { description: 'check status of active schedules should be 5', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 5 } })
            countChecker('dyn-1', messages[2].payload.result[3], 3, 2, true) // dyn-1 should still have triggered 2 times & still be running
            // after waiting another second, dyn-1 should have triggered 3 times and should have reached its limit & stopped
            commandChecker(messages[3], { description: 'check status of inactive schedules should be 1', send: { topic: 'status-inactive', payload: '' }, expected: { command: 'status-inactive', scheduleCount: 1 } })
            countChecker('dyn-1', messages[3].payload.result[0], 3, 3, false) // dyn-1 should have triggered 3 times and should NOT be running
        })
        it('should not reset count when finished schedule is updated (default behaviour)', async function () {
            this.timeout(7000)
            // setup add dyn-1
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 1, expression: '* * * * * * *' })) // every 1 seconds

            const messages = []
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
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
            commandChecker(messages[0], { description: 'check status of active schedules should be 4', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 4 } })
            countChecker('dyn-1', messages[0].payload.result[3], 1, 0, true) // dyn-1 should have triggered 0 times
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
        it('should apply provided count when updating a task', async function () {
            this.timeout(7000)
            // setup add dyn-1
            testNode.receive(createAddScheduleMsg({ name: 'dyn-1', limit: 1, expression: '* * * * * * *' })) // every 1 seconds

            const messages = []
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
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
            commandChecker(messages[0], { description: 'check status of active schedules should be 4', send: { topic: 'status-active', payload: '' }, expected: { command: 'status-active', scheduleCount: 4 } })
            countChecker('dyn-1', messages[0].payload.result[3], 1, 0, true) // dyn-1 should have triggered 0 times
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
        it('should apply provided count when creating a task (clamped by limit)', async function () {
            this.timeout(7000)
            // setup add dyn-1
            testNode.receive(createAddScheduleMsg({ name: 'dyn-2', limit: 1, count: 2, expression: '* * * * * * *' })) // every 1 seconds

            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })

            testNode.receive({ topic: 'status-all', payload: '' })

            const msg = await resultPromise

            commandChecker(msg, { description: 'check count of schedules should be 4', send: { topic: 'status-all', payload: '' }, expected: { command: 'status-all', scheduleCount: 4 } })

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
                helperNode4DynamicSchedules.on('input', (msg) => {
                    resolve(msg)
                })
                helperNode5CommandResponses.on('input', (msg) => {
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
        it('should remove a static schedule dynamically', async function () {
            const msg = { topic: 'remove', payload: 'schedule1' }
            testNode.receive(msg)
            sleep(50) // let it unwind
            const resultPromise = new Promise(resolve => {
                helperNode5CommandResponses.on('input', (msg) => {
                    resolve(msg)
                })
            })
            const test = {
                description: this.test.title,
                send: { topic: 'status-all', payload: '' },
                expected: { command: 'status-all', scheduleCount: 2 }
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
})
