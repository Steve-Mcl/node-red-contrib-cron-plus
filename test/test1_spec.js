var should = require("should");
var helper = require("node-red-node-test-helper");
var cronplus = require("../cronplus.js");

const getTestFlow = (nodeName = "testNode") => {
    return [
        { id: 'helperNode1', type: 'helper' },
        { id: 'helperNode2', type: 'helper' },
        { id: 'helperNode3', type: 'helper' },
        { id: 'helperNode4', type: 'helper' },
        { id: 'helperNode5', type: 'helper' },
        {"id":nodeName,"type":"cronplus","name":"","outputField":"payload","timeZone":"","persistDynamic":false,"commandResponseMsgOutput":"fanOut","outputs":5,"options":[{"name":"schedule1","topic":"schedule1","payloadType":"default","payload":"","expressionType":"cron","expression":"0 * * * * * *","location":"","offset":"0","solarType":"all","solarEvents":"sunrise,sunset"},{"name":"schedule2","topic":"schedule2","payloadType":"default","payload":"","expressionType":"dates","expression":"2020-01-01 00:00","location":"","offset":"0","solarType":"all","solarEvents":"sunrise,sunset"},{"name":"schedule3","topic":"schedule3","payloadType":"default","payload":"","expressionType":"solar","expression":"0 * * * * * *","location":"55.0 -1.418","offset":"0","solarType":"all","solarEvents":"sunrise,sunset"}],"wires":[ ["helperNode1"],["helperNode2"],["helperNode3"],["helperNode4"],["helperNode5"] ]} 
    ];
};

helper.init(require.resolve('node-red'));

describe('cron-plus Node', function(){
    "use strict";

    beforeEach(done => { helper.startServer(done); });

    afterEach(done => { helper.unload().then(() => helper.stopServer(done)); });

    // it('should be loaded', done => {
    //     // const flow = [{ id: 'testNode', type: 'buffer-parser', name: 'test--buffer-parser' }];
    //     const flow = getTestFlow("testNode")
    //     helper.load(bufferParser, flow, () => {
    //         try {
    //             const n = helper.getNode('testNode');
    //             n.should.have.property('name', 'test--buffer-parser');
    //             done();  
    //         } catch (error) {
    //             done(error);
    //         }
            
    //     });
    // });
    
    it('should generate 5 values (fan out test)', done => {
        
        const flow = getTestFlow();
        this.timeout(2000); //timeout with an error if done() isn't called within one second

        helper.load(cronplus, flow, function() {
            try {
                var helperNode1 = helper.getNode("helperNode1");
                var helperNode2 = helper.getNode("helperNode2");
                var helperNode3 = helper.getNode("helperNode3");
                var helperNode4 = helper.getNode("helperNode4");
                var helperNode5 = helper.getNode("helperNode5");
                var testNode = helper.getNode("testNode");

                should(helperNode1).not.be.null();
                should(helperNode2).not.be.null();
                should(helperNode3).not.be.null();
                should(helperNode4).not.be.null();
                should(helperNode5).not.be.null();
                should(testNode).not.be.null();
                testNode.should.have.property('name', "testNode");

                var results = {};
                setTimeout(function () {

    
                    try {
                        debugger
                        results.should.have.properties(["resultMsg1","resultMsg2","resultMsg3","resultMsg4","resultMsg5"])
 
                        done();
                        return;
                    } catch (error) {
                        done(error);
                    }
                }, 1000); 

                helperNode1.on("input", function (msg) { results.resultMsg1 = msg; });
                helperNode2.on("input", function (msg) { results.resultMsg2 = msg; });
                helperNode3.on("input", function (msg) { results.resultMsg3 = msg; });
                helperNode4.on("input", function (msg) { results.resultMsg4 = msg; });
                helperNode5.on("input", function (msg) { results.resultMsg5 = msg; });

                //fire 5 messages into the cron node
                testNode.receive({ topic: "trigger", payload: "schedule1" }); //fire input of testNode
                testNode.receive({ topic: "trigger", payload: "schedule2" }); //fire input of testNode
                testNode.receive({ topic: "trigger", payload: "schedule3" }); //fire input of testNode
                
                //add a dynamic cron schedule
                testNode.receive({ payload: {
                    "command": "add",
                    "name": "dynCron",
                    "topic": "dynCron",
                    "expression": "0 0/6 * * * * *",
                    "expressionType": "cron",
                    "payloadType": "default",
                    "limit": 3 
                  } }); 
                testNode.receive({ topic: "trigger", payload: "dynCron" }); //fire input of testNode

                testNode.receive({ payload: {
                    "command": "describe",
                    "expressionType": "solar",
                    "location": "54.9992500,-1.4170300",
                    "solarType": "all",
                    "timeZone": "Europe/London"
                    } 
                }); //fire input of testNode


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
