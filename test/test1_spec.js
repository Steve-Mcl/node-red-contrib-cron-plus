var should = require("should");
var helper = require("node-red-node-test-helper");
var cronplusNode = require("../cronplus.js");

helper.init(require.resolve('node-red'));

describe('cron-plus Node', function(){
    "use strict";

    beforeEach(done => { helper.startServer(done); });

    afterEach(done => { helper.unload().then(() => helper.stopServer(done)); });

    
    it('should inject from cron expression', function(done) {
        var flow = [
            { "id": "t1n1", "type": "cronplus", "name": "every1sec", "outputField": "payload", "timeZone": "", "persistDynamic": false, "commandResponseMsgOutput": "output1", "outputs": 1, "options": [{ "name": "schedule1", "topic": "schedule1", "payloadType": "num", "payload": "100", "expressionType": "cron", "expression": "* * * * * * *", "location": "", "offset": "0", "solarType": "all", "solarEvents": "sunrise,sunset" }], "wires": [["t1n2"]] },
            { "id": "t1n2", "type": "helper" }
        ];
        helper.load(cronplusNode, flow, function() {
            var t1n2 = helper.getNode("t1n2");
            t1n2.on("input", function(msg) {
                msg.should.have.property('topic', 'schedule1');
                msg.should.have.property('cronplus').which.is.an.Object();
                msg.should.have.property('payload').which.is.a.Number();
                helper.clearFlows().then(function() {
                    done();
                });
            });
        });
    });

    const getObjectProperty = function(object, path, defaultValue) {
        return path
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
     function basicTest(topic, outputField, payloadType, payloadValue, returnType, returnVal) {
        it('should inject value of type '+payloadType, function (done) {
            this.timeout(1000); //timeout with an error if done() isn't called in time

            var flow = [
                { "id": "t2n1", "type": "cronplus", "name": "every1sec", "outputField": outputField, "timeZone": "", "persistDynamic": false, "commandResponseMsgOutput": "output1", "outputs": 1, "options": [
                    { "name": "schedule1", "topic": topic, "payloadType": payloadType, "payload": payloadValue, "expressionType": "cron", "expression": "0 0 * * * * 2000", "location": "", "offset": "0", "solarType": "all", "solarEvents": "sunrise,sunset" }
                ], "wires": [["t2n2"]] },
                { id: "t2n2", type: "helper" }
            ];
            helper.load(cronplusNode, flow, function () {
                var t2n1 = helper.getNode("t2n1");
                var t2n2 = helper.getNode("t2n2");
                t2n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("topic", topic);
                        msg.should.have.propertyByPath(...outputField.split("."));
                        if (returnVal) {
                            var result = getObjectProperty(msg, outputField);
                            should(result).be.of.type(returnType);
                            should.deepEqual(result, returnVal);
                        }
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                t2n1.receive({ topic: "trigger", payload: "schedule1" }); //trigger schedule1 
            });
        });
    }

    describe('basic tests', function () {
        basicTest("topic1", "payload", "num", 10, "number", 10 );
        basicTest("topic2", "result", "str", "10", "string", "10");
        basicTest("topic3", "payload.value", "bool", true, "boolean", true);
        var val_json = '{"x":"vx","n":1,"o":{}}';
        basicTest("topic4", "my.nested.payload", "json", val_json, "object", JSON.parse(val_json));
        var val_buf = "[1,2,3,4,5]";
        basicTest("topic5", "payload", "bin", val_buf, "object", Buffer.from(JSON.parse(val_buf)));
    });
   

    //test set 3 - test dynamic capabilities
    const getTestFlow = (nodeName = "testNode") => {
        return [
            { id: 'helperNode1', type: 'helper' },
            { id: 'helperNode2', type: 'helper' },
            { id: 'helperNode3', type: 'helper' },
            { id: 'helperNode4', type: 'helper' },
            { id: 'helperNode5', type: 'helper' },
            { "id": nodeName, "type": "cronplus", "name": "", "outputField": "payload", "timeZone": "", "persistDynamic": false, "commandResponseMsgOutput": "fanOut", "outputs": 5, "options": [
                { "name": "schedule1", "topic": "schedule1", "payloadType": "default", "payload": "", "expressionType": "cron", "expression": "0 * * * * * *", "location": "", "offset": "0", "solarType": "all", "solarEvents": "sunrise,sunset" }, 
                { "name": "schedule2", "topic": "schedule2", "payloadType": "default", "payload": "", "expressionType": "dates", "expression": "2020-01-01 00:00", "location": "", "offset": "0", "solarType": "all", "solarEvents": "sunrise,sunset" }, 
                { "name": "schedule3", "topic": "schedule3", "payloadType": "default", "payload": "", "expressionType": "solar", "expression": "0 * * * * * *", "location": "55.0 -1.418", "offset": "0", "solarType": "all", "solarEvents": "sunrise,sunset" }
            ], "wires": [["helperNode1"], ["helperNode2"], ["helperNode3"], ["helperNode4"], ["helperNode5"]] }
        ];
    };

    it('should generate various values to 5 outputs (fan out test)', done => {
        const cronNodeName = "t3n1"
        const flow = getTestFlow(cronNodeName);
        this.timeout(2000); //timeout with an error if done() isn't called within one second

        helper.load(cronplusNode, flow, function() {
            try {
                var helperNode1 = helper.getNode("helperNode1");
                var helperNode2 = helper.getNode("helperNode2");
                var helperNode3 = helper.getNode("helperNode3");
                var helperNode4 = helper.getNode("helperNode4");
                var helperNode5 = helper.getNode("helperNode5");
                var testNode = helper.getNode(cronNodeName);

                should(helperNode1).not.be.null();
                should(helperNode2).not.be.null();
                should(helperNode3).not.be.null();
                should(helperNode4).not.be.null();
                should(helperNode5).not.be.null();
                should(testNode).not.be.null();
                testNode.should.have.property('id', cronNodeName);

                const configChecker = function(config) {
                    it('should be a valid config object ', function (done) {
                        try {
                            should(config).not.be.Null();
                            config.should.have.keys('topic', 'name', 'payload')
                            config.should.have.property("payloadType", 'default');
                            config.should.have.property("expressionType");
                            if(config.expressionType == "solar") {
                                config.should.have.property("location");
                            } else {
                                config.should.have.property("expression");
                            }
                            done();
                        } catch (error) {
                            done(error);
                        }
                    });
                }
                const statusChecker = function(status, expectedType) {
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
                        it('should be a valid status object ', function (done) {
                            try {
                                status.should.have.property("count").which.is.a.Number();
                                status.should.have.property("description").which.is.a.String();
                                status.should.have.property("isRunning").which.is.a.Boolean();
                                status.should.have.property("type").which.is.a.String();
                                if(expectedType) {
                                    should(status.type).eql(expectedType);
                                } else {
                                    should(status.type).be.oneOf("static", "dynamic");
                                }
                                done();
                            } catch (error) {
                                done(error);
                            }
                        })
                   
                }
                
                const dynamicOpChecker = function(payload, expectedCommand) {
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
                    it('should be a valid dynamic operation result', function (done) {
                        try {
                            payload.should.have.property("command").which.is.an.Object();
                            payload.should.have.property("result").which.is.an.Object();
        
                            var command = payload.command;
                            var result = payload.result;
        
                            command.should.have.property("command").which.is.a.String();
                            should(command.command).eql(expectedCommand);
        
                            
                            if(command.command == "describe") {
                                command.should.have.property("expressionType").which.is.a.String();
                                if(command.expressionType == "solar") {
                                    command.should.have.property("location");
                                } else {
                                    command.should.have.property("expression");
                                }
                                command.should.have.property("payloadType").which.is.a.String();
                                if(command.expressionType == "solar") {
                                    result.should.have.property("solarState").which.is.an.Object();
                                    result.should.have.property("description").which.is.a.String();
                                    result.should.have.property("eventTimes").which.is.an.Object();
                                    result.should.have.property("nextEventTime");
                                    result.should.have.property("nextDate");
                                }
                            } else if(command.command == "export") {
                                configChecker(result);
                            } else if(command.command == "status") {
                                result.should.have.property("config").which.is.an.Object();
                                result.should.have.property("status").which.is.an.Object();
                                configChecker(result.config);
                                statusChecker(result.status);
                            } else if(command.command == "status-all" || command.command == "status-all-dynamic" || command.command == "status-all-static") {
                                should(Array.isArray(result)).be.true("check result should be an array");
                                for (const r of result) {
                                    r.should.have.property("config").which.is.an.Object();
                                    r.should.have.property("status").which.is.an.Object();
                                    configChecker(r.config);
                                    statusChecker(r.status);
                                }
                            }
                            done();
                        } catch (error) {
                            done(error);
                        }
                    })                    
                }

                var results = {commandResponseOutput: []};
                setTimeout(function () {    
                    try {
                        results.should.have.properties(["resultOutput1","resultOutput2","resultOutput3","dynamicOutput","commandResponseOutput"]);
                        describe('check static schedules', function () {
                            results.resultOutput1.should.have.propertyByPath("payload", "triggerTimestamp");
                            results.resultOutput1.should.have.propertyByPath("payload", "config");
                            configChecker(results.resultOutput1.payload.config);
                            results.resultOutput1.should.have.propertyByPath("payload", "status");
                            statusChecker(results.resultOutput1.payload.status, "static");
    
                            results.resultOutput2.should.have.propertyByPath("payload", "triggerTimestamp");
                            results.resultOutput2.should.have.propertyByPath("payload", "config");
                            configChecker(results.resultOutput2.payload.config);
                            results.resultOutput2.should.have.propertyByPath("payload", "status");
                            statusChecker(results.resultOutput2.payload.status, "static");
                            
    
                            results.resultOutput3.should.have.propertyByPath("payload", "triggerTimestamp");
                            results.resultOutput3.should.have.propertyByPath("payload", "config");
                            configChecker(results.resultOutput3.payload.config);
                            results.resultOutput3.should.have.propertyByPath("payload", "status");
                            statusChecker(results.resultOutput3.payload.status, "static");
                            
                            results.dynamicOutput.should.have.propertyByPath("payload", "triggerTimestamp");
                            results.dynamicOutput.should.have.propertyByPath("payload", "config");
                            configChecker(results.dynamicOutput.payload.config);
                            results.dynamicOutput.should.have.propertyByPath("payload", "status");
                            statusChecker(results.dynamicOutput.payload.status, "dynamic");
                        });
                        describe('check dynamic schedules', function () {
                            results.dynamicOutput.should.have.propertyByPath("payload", "triggerTimestamp");
                            results.dynamicOutput.should.have.propertyByPath("payload", "config");
                            configChecker(results.dynamicOutput.payload.config);
                            results.dynamicOutput.should.have.propertyByPath("payload", "status");
                            statusChecker(results.dynamicOutput.payload.status, "dynamic");
                        });

                      
                        describe('check command responses', function () {
                            results.commandResponseOutput.should.have.property("length", 6);
                            
                            var msg5 = results.commandResponseOutput[0];
                            msg5.should.have.property("payload");
                            dynamicOpChecker(msg5.payload, "describe");

                            var msg6 = results.commandResponseOutput[1];
                            msg6.should.have.property("payload");
                            dynamicOpChecker(msg6.payload, "export");

                            var msg7 = results.commandResponseOutput[2];
                            msg7.should.have.property("payload");
                            dynamicOpChecker(msg7.payload, "status");

                            var msg8 = results.commandResponseOutput[3];
                            msg8.should.have.property("payload");
                            dynamicOpChecker(msg8.payload, "status-all");

                            var msg9 = results.commandResponseOutput[4];
                            msg9.should.have.property("payload");
                            dynamicOpChecker(msg9.payload, "status-all-dynamic");

                            var msg10 = results.commandResponseOutput[5];
                            msg10.should.have.property("payload");
                            dynamicOpChecker(msg10.payload, "status-all-static");
                        });

                        done();
                        return;
                    } catch (error) {
                        done(error);
                    }
                }, 2000); 

                helperNode1.on("input", function (msg) { results.resultOutput1 = msg; });
                helperNode2.on("input", function (msg) { results.resultOutput2 = msg; });
                helperNode3.on("input", function (msg) { results.resultOutput3 = msg; });
                helperNode4.on("input", function (msg) { results.dynamicOutput = msg; });
                helperNode5.on("input", function (msg) { results.commandResponseOutput.push(msg); });

                //fire 5 messages into the cron node
                testNode.receive({ topic: "trigger", payload: "schedule1" }); //fire input of testNode
                testNode.receive({ topic: "trigger", payload: "schedule2" }); //fire input of testNode
                testNode.receive({ topic: "trigger", payload: "schedule3" }); //fire input of testNode
                
                //add a dynamic cron schedule
                testNode.receive({ payload: {
                    "command": "add",
                    "name": "dynCron",
                    "topic": "dynCron",
                    "expression": "* * * * * * *",
                    "expressionType": "cron",
                    "payloadType": "default",
                    "limit": 1 
                  } }); 
                //testNode.receive({ topic: "trigger", payload: "dynCron" }); //fire input of testNode

                testNode.receive({ payload: {
                    "command": "describe",
                    "expressionType": "solar",
                    "location": "54.9992500,-1.4170300",
                    "solarType": "all",
                    "timeZone": "Europe/London"
                    } 
                }); //fire input of testNode

                testNode.receive({ topic: "export", payload: "schedule1" });
                testNode.receive({ topic: "status", payload: "dynCron" });
                testNode.receive({ topic: "status-all", payload: "" });
                testNode.receive({ topic: "status-all-dynamic", payload: "" });
                testNode.receive({ topic: "status-all-static", payload: "" });
 

            } catch (error) {
                done(error);
            }
        });        
    });

    //TODO: Test the following...
    /*
    * all functions
    * all output types
    * byteswaps
    * scalling operators
    * dynamic spec
    */
});
