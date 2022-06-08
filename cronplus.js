/*
MIT License

Copyright (c) 2019, 2020, 2021 Steve-Mcl

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
*/

const cronstrue = require('cronstrue');
const cronosjs = require("cronosjs");
const prettyMs = require('pretty-ms');
const coordParser = require("coord-parser");
const SunCalc = require('suncalc2');
const path = require('path');
const fs = require('fs');

SunCalc.addTime(-18, "nightEnd", "nightStart");
SunCalc.addTime(-6, "civilDawn", "civilDusk");
SunCalc.addTime(6, "morningGoldenHourEnd", "eveningGoldenHourStart");

const PERMITTED_SOLAR_EVENTS = [
    "nightEnd",
    // "astronomicalDawn",
    "nauticalDawn",
    "civilDawn",
    // "morningGoldenHourStart",
    "sunrise",
    "sunriseEnd",
    "morningGoldenHourEnd",
    "solarNoon",
    "eveningGoldenHourStart",
    "sunsetStart",
    "sunset",
    // "eveningGoldenHourEnd",
    "civilDusk",
    "nauticalDusk",
    // "astronomicalDusk",
    "nightStart",
    "nadir"
];

//accepted commands using topic as the command & (in compatible cases, the payload is the schedule name)
//commands not supported by topic are : add/update & describe
const control_topics = [
    { command: "trigger", payloadIsName: true },
    { command: "status", payloadIsName: true },
    { command: "list", payloadIsName: true },
    { command: "export", payloadIsName: true },
    { command: "stop", payloadIsName: true },
    { command: "stop-all", payloadIsName: false },
    { command: "stop-all-dynamic", payloadIsName: false },
    { command: "stop-all-static", payloadIsName: false },
    { command: "pause", payloadIsName: true },
    { command: "pause-all", payloadIsName: false },
    { command: "pause-all-dynamic", payloadIsName: false },
    { command: "pause-all-static", payloadIsName: false },
    { command: "start", payloadIsName: true },
    { command: "start-all", payloadIsName: false },
    { command: "start-all-dynamic", payloadIsName: false },
    { command: "start-all-static", payloadIsName: false },
    { command: "clear", payloadIsName: false },
    { command: "remove", payloadIsName: true },
    { command: "delete", payloadIsName: true },
    { command: "debug", payloadIsName: true },
];
var addExtended_control_topics = function(baseCommand) {
    control_topics.push({ command: `${baseCommand}-all`, payloadIsName: false });
    control_topics.push({ command: `${baseCommand}-all-dynamic`, payloadIsName: false });
    control_topics.push({ command: `${baseCommand}-all-static`, payloadIsName: false });
    control_topics.push({ command: `${baseCommand}-active`, payloadIsName: false });
    control_topics.push({ command: `${baseCommand}-active-dynamic`, payloadIsName: false });
    control_topics.push({ command: `${baseCommand}-active-static`, payloadIsName: false });
    control_topics.push({ command: `${baseCommand}-inactive`, payloadIsName: false });
    control_topics.push({ command: `${baseCommand}-inactive-dynamic`, payloadIsName: false });
    control_topics.push({ command: `${baseCommand}-inactive-static`, payloadIsName: false });
};
addExtended_control_topics("trigger"); 
addExtended_control_topics("status"); 
addExtended_control_topics("export"); 
addExtended_control_topics("list"); 
addExtended_control_topics("remove"); 
addExtended_control_topics("delete"); 
addExtended_control_topics("debug"); 

/**
 * Humanize a cron express
 * @param {string} expression the CRON expression to humanize
 * @returns {string}
 * A human readable version of the expression 
 */
var humanizeCron = function (expression, locale) {
    try {
        var opt = { use24HourTimeFormat: true };
        if(locale) opt.locale = locale;
        return cronstrue.toString(expression, opt);
    } catch (error) {
        return `Cannot parse expression '${expression}'`;
    }
};

/**
 * Validate a schedule options. Returns true if OK otherwise throws an appropriate error
 * @param {object} opt the options object to validate
 * @param {boolean} permitDefaults allow certain items to be a default (missing value)
 * @returns {boolean}
 */
function validateOpt(opt, permitDefaults = true) {
    if (!opt) {
        throw new Error(`Schedule options are undefined`);
    }
    if (!opt.name) {
        throw new Error(`Schedule name property missing`);
    }
    if(!opt.expressionType || opt.expressionType === "cron" || opt.expressionType === "dates"){//cron
        if (!opt.expression) {
            throw new Error(`Schedule '${opt.name}' - expression property missing`);
        }    
        let valid = false;
        try {
            valid = cronosjs.validate(opt.expression);    
            if(valid)
                opt.expressionType = "cron";
        } catch (error) {
            console.debug(error);
        }
        try {
            if(!valid){
                valid = isDateSequence(opt.expression);
                if(valid)
                    opt.expressionType = "dates";
            }    
        } catch (error) {
            console.debug(error);
        }

        if(!valid){
            throw new Error(`Schedule '${opt.name}' - expression '${opt.expression}' must be either a cron expression, a date, an a array of dates or a CSV of dates`);
        }                    

    } else if(opt.expressionType === "solar") {
        if (!opt.offset) {
            opt.offset = 0;
        }    
        if (!opt.location) {
            throw new Error(`Schedule '${opt.name}' - location property missing`);
        }    
        if(opt.solarType !== "selected" && opt.solarType !== "all"){
            throw new Error(`Schedule '${opt.name}' - solarType property invalid or mising. Must be either "all" or "selected"`);
        }
        if(opt.solarType == "selected"){                    
            if (!opt.solarEvents) {
                throw new Error(`Schedule '${opt.name}' - solarEvents property missing`);
            }   

            var solarEvents; 
            if(typeof opt.solarEvents === "string"){
                solarEvents = opt.solarEvents.split(",");
            } else if(Array.isArray(opt.solarEvents)){
                solarEvents = opt.solarEvents;
            } else {
                throw new Error(`Schedule '${opt.name}' - solarEvents property is invalid`);
            }
            if(!solarEvents.length){
                throw new Error(`Schedule '${opt.name}' - solarEvents property is empty`);
            }
            for (let index = 0; index < solarEvents.length; index++) {
                const element = solarEvents[index].trim();
                if(!PERMITTED_SOLAR_EVENTS.includes(element)){
                    throw new Error(`Schedule '${opt.name}' - solarEvents entry '${element}' is invalid`);
                }                    
            }
        }
    } else {
        throw new Error(`Schedule '${opt.name}' - invalid schedule type '${opt.expressionType}'. Expected expressionType to be 'cron', 'dates' or 'solar'`);
    }
    if(permitDefaults) {
        opt.payload = ((opt.payload == null || opt.payload == "") && opt.payloadType == "num") ? 0 : opt.payload;
        opt.payload = ((opt.payload == null || opt.payload == "") && opt.payloadType == "str") ? "" : opt.payload;
        opt.payload = ((opt.payload == null || opt.payload == "") && opt.payloadType == "bool") ? false : opt.payload;
    }
    if (!opt.payloadType == "default" && opt.payload == null) {
        throw new Error(`Schedule '${opt.name}' - payload property missing`);
    }
    opt.type = permitDefaults ? opt.type || "date" : opt.type;
    if (!opt.type) {
        throw new Error(`Schedule '${opt.name}' - type property missing`);
    }
    let okTypes = ['default', 'flow', 'global', 'str', 'num', 'bool', 'json', 'bin', 'date', 'env'];
    let typeOK = okTypes.find( el => {return el == opt.type;});
    if (!typeOK) {
        throw new Error(`Schedule '${opt.name}' - type property '${opt.type}' is not valid. Must be one of the following... ${okTypes.join(",")}`);
    }
    return true;
}

/**
 * Tests if a string or array of date like items are a date or date sequence
 * @param {String|Array} data An array of date like entries or a CSV string of dates
 */
function isDateSequence(data){
    try {
        let ds = parseDateSequence(data);
        return (ds && ds.isDateSequence);    
    // eslint-disable-next-line no-empty
    } catch (error) { }
    return false;
}

/**
 * Returns an object describing the parameters.
 * @param {string} expression The expressions or coordinates to use
 * @param {string} expressionType The expression type ("cron" | "solar" | "dates")
 * @param {string} timeZone An optional timezone to use
 * @param {number} offset An optional offset to apply
 * @param {string} solarType Specifies either "all" or "selected" - related to solarEvents property
 * @param {string} solarEvents a CSV of solar events to be included
 * @param {date} time Optional time to use (defaults to Date.now() if excluded)
 */
function _describeExpression(expression, expressionType, timeZone, offset, solarType, solarEvents, time, opts){
    let now = time ? new Date(time) : new Date();
    opts = opts || {};
    let result = { description: undefined, nextDate: undefined, nextDescription: undefined, prettyNext: "Never" };
    let cronOpts = timeZone ? { timezone: timeZone } : undefined;
    let ds = null;
    let dsOk = false;
    let exOk = false;
    //let now = new Date();

    if(solarType == "all"){
        solarEvents = PERMITTED_SOLAR_EVENTS.join(",");
    }

    if(expressionType == "solar"){
        let opt = {
            expressionType: expressionType,
            location: expression,
            offset: offset || 0,
            name: "dummy",
            solarType: solarType,
            solarEvents: solarEvents,
            payloadType: "default",
            payload: ""
        };
        
        if(validateOpt(opt)){
            let pos = coordParser(opt.location);
            let offset = isNumber(opt.offset) ? parseInt(opt.offset) : 0;
            let nowOffset =  new Date(now.getTime() - offset * 60000);
            result = getSolarTimes(pos.lat, pos.lon, 0, solarEvents, now, offset);
            if(opts.includeSolarStateOffset && offset != 0){
                let ssOffset = getSolarTimes(pos.lat, pos.lon, 0, solarEvents, nowOffset, 0);
                result.solarStateOffset = ssOffset.solarState;
            }
            result.offset = offset;
            result.now = now;
            result.nowOffset = nowOffset;
            ds = parseDateSequence(result.eventTimes.map((event)=>event.timeOffset));
            dsOk = ds && ds.isDateSequence;
        }
    } else {
        if(expressionType == "cron" || expressionType == ""){
            exOk = cronosjs.validate(expression);
        } else {
            ds = parseDateSequence(expression);
            dsOk = ds.isDateSequence;
        }
        if(!exOk && !dsOk){
            result.description = "Invalid expression";
            return result;
        }
    }

    if(dsOk){
        let task = ds.task;
        let dates = ds.dates;
        let dsFutureDates = dates.filter( d => d >= now );
        let count = dsFutureDates ? dsFutureDates.length : 0;        
        result.description = "Date sequence with fixed dates";
        if(task && task._sequence && count){
            result.nextDate = dsFutureDates[0];
            let ms = result.nextDate.valueOf() - now.valueOf();
            result.prettyNext = (result.nextEvent ? result.nextEvent + " " : "") +  `in ${prettyMs(ms, { secondsDecimalDigits: 0, verbose: true })}`;
            if(expressionType === "solar"){ 
                if(solarType === "all"){
                    result.description = "All Solar Events"; 
                } else {
                    result.description = "Solar Events: '" + solarEvents.split(",").join(", ") + "'"; 
                }
            } else {
                if(count == 1){
                    result.description = "One time at " + formatShortDateTimeWithTZ(result.nextDate, timeZone) ;
                } else {
                    result.description = count + " Date Sequences starting at " + formatShortDateTimeWithTZ(result.nextDate, timeZone) ;
                }
                result.nextDates = dsFutureDates.slice(0, 5);
            }            
        }
    } 
    
    if(exOk){
        let ex = cronosjs.CronosExpression.parse(expression, cronOpts);
        let next = ex.nextDate();
        if (next) {
            let ms = next.valueOf() - now.valueOf();
            result.prettyNext = `in ${prettyMs(ms, { secondsDecimalDigits: 0, verbose: true })}`;
            try {
                result.nextDates = ex.nextNDates(now, 5);
            } catch (error) {
                console.debug(error);
            }
        }
        result.description = humanizeCron(expression);
        result.nextDate = next;
    }
    return result;
}

/**
 * Returns a formatted string based on the provided tz.
 * If tz is not specified, then Date.toString() is used
 * @param {Date | string | number} date The date to format
 * @param {string} [tz] Timezone to use (exclude to use system)
 * @returns {string}
 * The formatted date or empty string if `date` is null|undefined
 */
function formatShortDateTimeWithTZ(date, tz) {
    if (!date) {
        return "";
    }
    let dateString;
    let o = {
        timeZone: tz ? tz : undefined,
        timeZoneName: "short",
        hourCycle: 'h23',
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    };
    try {
        dateString = new Intl.DateTimeFormat('default', o).format(new Date(date));    
    } catch (error) {
        dateString = "Error. Check timezone setting";
    }
        
    return dateString;
}

/**
 * Determine if a variable is a number
 * @param {string|number} n The string or number to test
 * @returns {boolean}
 */
function isNumber(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

/**
 * Determine if a variable is a valid object
 * NOTE: Arrays are also objects - be sure to use Array.isArray if you need to know the difference
 * @param {*} o The variable to test
 * @returns {boolean}
 */
function isObject(o){
    return (typeof o === 'object' && o !== null);
}

/**
 * Determine if a variable is a valid date
 * @param {*} d The variable to test
 * @returns {boolean}
 */
function isValidDateObject(d) {
    return d instanceof Date && !isNaN(d);
}

/**
 * Determine if a variable is a cron like string
 * @param {string} expression The variable to test
 * @returns {boolean}
 */
function isCronLike(expression){
    if(typeof expression !== "string") return false;
    if(expression.includes("*")) return true;
    let cleaned = expression.replace(/\s\s+/g, ' ');
    let spaces = cleaned.split(" ");
    return spaces.length >= 4 && spaces.length <= 6 ; 
}

/** 
 * Apply defaults to the cron schedule object
 * @param {integer} optionIndex An index number to use for defaults
 * @param {object} option The option object to update
*/         
function applyOptionDefaults(option, optionIndex) {
    if(isObject(option) == false){
        return;//no point in continuing
    }
    optionIndex = optionIndex == null ? 0 : optionIndex;
    if (option.expressionType == "") {
        if(isDateSequence(option.expression)){
            option.expressionType = "dates";
        } else {
            option.expressionType = "cron";//if empty, default to cron
        }
    } else if (["cron", "dates", "solar"].indexOf(option.expressionType) < 0) {
        //if expressionType is not cron or solar - it might be sunrise or sunset from an older version
        if (option.expressionType == "sunrise") {
            option.solarEvents = option.solarEvents || "sunrise";
            option.expressionType = "solar";
        } else if (option.expressionType == "sunset") {
            option.solarEvents = option.solarEvents || "sunset";
            option.expressionType = "solar";
        } else {
            option.expressionType = "cron";
        }
    }
    option.name = option.name || "schedule" + (optionIndex + 1);
    option.topic = option.topic || option.name;
    option.payloadType = option.payloadType || option.type || "default";
    delete option.type;
    if (option.expressionType == "cron" && !option.expression) option.expression = "0 * * * * * *";
    if (!option.solarType) option.solarType =  option.solarEvents ? "selected" : "all";
    if (!option.solarEvents) option.solarEvents = "sunrise,sunset";
    if (!option.location) option.location = "";
}
function parseDateSequence(expression){
    let result = { isDateSequence: false, expression: expression };
    let dates = expression;
    if(typeof expression == "string"){
        let spl = expression.split(",");
        for (let index = 0; index < spl.length; index++) {
            spl[index] = spl[index].trim();
            if(isCronLike(spl[index])){
                return result;//fail
            }
        }
        dates = spl.map(x => {
            if(isNumber(x)){
                x = parseInt(x);
            }
            let d = new Date(x); 
            return d;
        });
    }            
    let ds = new cronosjs.CronosTask(dates);
    if(ds && ds._sequence){
        result.dates = ds._sequence._dates;
        result.task = ds;
        result.isDateSequence = true;
    }
    return result;    
}

function parseSolarTimes(opt){
    let pos = coordParser(opt.location || "0.0,0.0" );
    let offset = opt.offset ? parseInt(opt.offset) : 0;
    let date = opt.date ? new Date(opt.date) : new Date();
    let events = opt.solarType == "all" ? PERMITTED_SOLAR_EVENTS : opt.solarEvents;
    let result = getSolarTimes(pos.lat, pos.lon, 0, events, date, offset);
    let task = parseDateSequence(result.eventTimes.map((o) => o.timeOffset));
    task.solarEventTimes = result;
    return task;
}

function getSolarTimes(lat, lng, elevation, solarEvents, startDate = null, offset = 0){
    // performance.mark('Start');
    var solarEventsPast = [...PERMITTED_SOLAR_EVENTS];
    var solarEventsFuture = [...PERMITTED_SOLAR_EVENTS];
    var solarEventsArr = [];

    //get list of usable solar events into solarEventsArr
    var solarEventsArrTemp = [];
    if(typeof solarEvents === "string"){
        solarEventsArrTemp = solarEvents.split(",");
    } else if(Array.isArray(solarEvents)) {
        solarEventsArrTemp = [...solarEvents];
    } else {
        throw new Error("solarEvents must be a CSV or Array");
    }
    for (let index = 0; index < solarEventsArrTemp.length; index++) {
        var se = solarEventsArrTemp[index].trim();
        if(PERMITTED_SOLAR_EVENTS.includes(se)){
            solarEventsArr.push(se);
        } 
    }

    offset = isNumber(offset) ? parseInt(offset) : 0;
    elevation = isNumber(elevation) ? parseInt(elevation) : 0;//not used for now
    startDate = startDate ? new Date(startDate) : new Date();

    var scanDate = new Date(startDate.toDateString()); //new Date(startDate); //scanDate = new Date(startDate.toDateString())
    scanDate.setDate(scanDate.getDate() + 1);//fwd one day to catch times behind of scan day
    var loopMonitor = 0;
    var result = [];

    // performance.mark('initEnd')
    // performance.measure('Start to Now', 'Start', 'initEnd')
    // performance.mark('FirstScanStart');

    //first scan backwards to get prior solar events
    while (loopMonitor < 3 && solarEventsPast.length) {
        loopMonitor++;
        let timesIteration1 = SunCalc.getTimes(scanDate, lat, lng);
        // timesIteration1 = new SolarCalc(scanDate,lat,lng);

        for (let index = 0; index < solarEventsPast.length; index++) {
            const se = solarEventsPast[index];
            let seTime = timesIteration1[se]; 
            let seTimeOffset = new Date(seTime.getTime() + offset * 60000);
            if (isValidDateObject(seTimeOffset) && seTimeOffset <= startDate) {
                result.push({ event: se, time: seTime, timeOffset: seTimeOffset });
                solarEventsPast.splice(index, 1);//remove that item
                index--;
            }
        }
        scanDate.setDate(scanDate.getDate() - 1);
    }

    scanDate = new Date(startDate.toDateString());
    scanDate.setDate(scanDate.getDate() - 1);//back one day to catch times ahead of current day
    loopMonitor = 0;
    //now scan forwards to get future events
    while (loopMonitor < 183 && solarEventsFuture.length) {
        loopMonitor++;
        let timesIteration2 = SunCalc.getTimes(scanDate, lat, lng);
        // timesIteration2 = new SolarCalc(scanDate,lat,lng);
        for (let index = 0; index < solarEventsFuture.length; index++) {
            const se = solarEventsFuture[index];
            let seTime = timesIteration2[se];
            let seTimeOffset = new Date(seTime.getTime() + offset * 60000);
            if (isValidDateObject(seTimeOffset) && seTimeOffset > startDate) {
                result.push({ event: se, time: seTime, timeOffset: seTimeOffset });
                solarEventsFuture.splice(index, 1);//remove that item
                index--;
            }
        }
        scanDate.setDate(scanDate.getDate() + 1);
    }
    // performance.mark('SecondScanEnd');
    // performance.measure('FirstScanEnd to SecondScanEnd', 'FirstScanEnd', 'SecondScanEnd');

    //sort the results to get a timeline
    var sorted = result.sort((a, b) => {
        if(a.time < b.time){
            return -1;
        }else if(a.time > b.time){
            return 1;
        }else{
            return 0;
        }
    });

    //now scan through sorted solar events to determine day/night/twilight etc
    var state = "", solarState = {};
    for (let index = 0; index < sorted.length; index++) {
        const event = sorted[index];
        if(event.time < startDate){
            switch(event.event){
                case "nightEnd":
                    state = "Astronomical Twilight";//todo: i18n
                    updateSolarState(solarState, state, "rise", false, false, true, false, false, false, false);
                    break;
                // case "astronomicalDawn":
                //     state = "Astronomical Twilight";//todo: i18n
                //     updateSolarState(solarState,state,"rise",false,false,true,false,false,false,false);
                //     break;                    
                case "nauticalDawn":
                    state = "Nautical Twilight";
                    updateSolarState(solarState, state, "rise", false, false, false, true, false, false, false);
                    break;
                case "civilDawn":
                    state = "Civil Twilight";
                    updateSolarState(solarState, state, "rise", false, false, false, false, true, true, false);
                    break;
                // case "morningGoldenHourStart":
                //     updateSolarState(solarState,null,"rise",false,false,false,false,true,true,false);
                //     break;                    
                case "sunrise":
                    state = "Civil Twilight";
                    updateSolarState(solarState, state, "rise", false, false, false, false, true, true, false);
                    break;
                case "sunriseEnd":
                    state = "Day";
                    updateSolarState(solarState, state, "rise", true, false, false, false, false, true, false);
                    break;
                case "morningGoldenHourEnd":
                    state = "Day";
                    updateSolarState(solarState, state, "rise", true, false, false, false, false, false, false);
                    break;
                case "solarNoon":
                    updateSolarState(solarState, null, "fall");
                    break;
                case "eveningGoldenHourStart":
                    state = "Day";
                    updateSolarState(solarState, state, "fall", true, false, false, false, false, false, true);
                    break;
                case "sunsetStart":
                    state = "Day";
                    updateSolarState(solarState, state, "fall", true, false, false, false, false, false, true);
                    break;
                case "sunset":
                    state = "Civil Twilight";
                    updateSolarState(solarState, state, "fall", false, false, false, false, true, false, true);
                    break;
                // case "eveningGoldenHourEnd":
                //     state = "Nautical Twilight";
                //     updateSolarState(solarState,state,"fall",false,false,false,false,true,false,false);
                //     break;
                case "civilDusk":
                    state = "Nautical Twilight";
                    updateSolarState(solarState, state, "fall", false, false, false, true, false, false, false);
                    break;
                case "nauticalDusk":
                    state = "Astronomical Twilight";
                    updateSolarState(solarState, state, "fall", false, false, true, false, false, false, false);
                    break;
                // case "astronomicalDusk":
                case "night":
                case "nightStart":
                    state = "Night";
                    updateSolarState(solarState, state, "fall", false, true, false, false, false, false, false);
                    break;
                case "nadir":
                    updateSolarState(solarState, null, "rise");
                    break;
            }
        } else {
            break;
        }
        
    }
    //update final states
    updateSolarState(solarState);//only sending `stateObject` makes updateSolarState() compute dawn/dusk etc
    
    //now filter to only events of interest
    var futureEvents = sorted.filter( (e) => e && e.timeOffset >= startDate );
    var wantedFutureEvents = [];
    for (let index = 0; index < futureEvents.length; index++) {
        const fe = futureEvents[index];
        if(solarEventsArr.includes(fe.event)){
            wantedFutureEvents.push(fe);
        }
    }
    var nextType = wantedFutureEvents[0].event;
    var nextTime = wantedFutureEvents[0].time;
    var nextTimeOffset = wantedFutureEvents[0].timeOffset;
    // performance.mark('End')
    // performance.measure('SecondScanEnd to End', 'SecondScanEnd', 'End')
    // performance.measure('Start to End', 'Start', 'End')

    return {
        solarState: solarState,
        nextEvent: nextType,
        nextEventTime: nextTime,
        nextEventTimeOffset: nextTimeOffset,
        eventTimes: wantedFutureEvents,
        //allTimes: sorted,
        //eventTimesByType: resultCategories
    };


    function updateSolarState(stateObject, state, direction, day, night,
                            astrologicalTwilight, nauticalTwilight, civilTwilight,
                            morningGoldenHour, eveningGoldenHour) {
        if(arguments.length > 1){
            if(state) stateObject.state = state;
            stateObject.direction = direction;
            if(arguments.length > 3){
                stateObject.day = day;
                stateObject.night = night;
                stateObject.astrologicalTwilight = astrologicalTwilight;
                stateObject.nauticalTwilight = nauticalTwilight;
                stateObject.civilTwilight = civilTwilight;
                stateObject.goldenHour = morningGoldenHour || eveningGoldenHour;
                stateObject.twilight = stateObject.astrologicalTwilight || stateObject.nauticalTwilight || stateObject.civilTwilight;
            }
            return;
        }
        stateObject.morningTwilight = stateObject.direction == "rise" && stateObject.twilight;
        stateObject.eveningTwilight = stateObject.direction == "fall" && stateObject.twilight;
        stateObject.dawn =  stateObject.direction == "rise" && stateObject.civilTwilight;
        stateObject.dusk =  stateObject.direction == "fall" && stateObject.civilTwilight;
        stateObject.morningGoldenHour =  stateObject.direction == "rise" && stateObject.goldenHour;
        stateObject.eveningGoldenHour =  stateObject.direction == "fall" && stateObject.goldenHour;              
    }
}

function exportTask(task, includeStatus) {
    var o = {
        topic: task.node_topic || task.name,
        name: task.name || task.node_topic,
        payloadType: task.node_payloadType,
        payload: task.node_payload,
        limit: task.node_limit || null,
        expressionType: task.node_expressionType,
    };
    if(o.expressionType === "solar"){
        o.solarType = task.node_solarType;
        o.solarEvents = task.node_solarEvents;
        o.location = task.node_location;
        o.offset = task.node_offset;
    } else {
        o.expression = task.node_expression;
    }
    if(includeStatus){
        o.isDynamic = task.isDynamic === true;
        o.modified = task.node_modified === true;
    }

    return o;
}

var userDir = '', persistPath = '', persistAvailable = false;
const cronplusDir = "cronplusdata";


module.exports = function (RED) {
    //when running tests, RED.settings.userDir & RED.settings.settingsFile (amongst others) are undefined 
    var testMode = typeof RED.settings.userDir === "undefined" && typeof RED.settings.settingsFile === "undefined"; 
    if(testMode) {
        persistAvailable = false;
    } else {
        userDir = RED.settings.userDir || "";
        persistPath = path.join(userDir, cronplusDir);
        try {
            if (!fs.existsSync(persistPath)){
                fs.mkdirSync(persistPath);
            }
            persistAvailable = fs.existsSync(persistPath);
        } catch (e) {
            if ( e.code !== 'EEXIST' ) { 
                RED.log.error(`cron-plus: Error creating persistence folder '${persistPath}'. ${e.message}`);
                persistAvailable = false;
            }
        }
    }
    
    function CronPlus(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.name = config.name;
        node.payloadType = config.payloadType || config.type || "default";
        delete config.type;
        node.payload = config.payload;
        node.crontab = config.crontab;
        node.outputField = config.outputField || "payload";
        node.timeZone = config.timeZone;
        node.persistDynamic = config.persistDynamic || false;
        node.options = config.options;
        node.commandResponseMsgOutput = config.commandResponseMsgOutput || "output1";
        node.outputs = 1;
        node.fanOut = false;
        if (config.commandResponseMsgOutput === "output2") {
            node.outputs = 2; //1 output pins (all messages), 2 outputs (schedules out of pin1, command responses out of pin2)
        } else if (config.commandResponseMsgOutput === "fanOut") {
            node.outputs = 2 + (node.options ? node.options.length : 0);
            node.fanOut = true;
        } else {
            config.commandResponseMsgOutput = "output1";
        }
        node.statusUpdatePending = false;

        const MAX_CLOCK_DIFF = 5000;
        var clockMonitor = setInterval(function timeChecker() {
            var oldTime = timeChecker.oldTime || new Date();
            var newTime = new Date();
            var timeDiff = newTime - oldTime;
            timeChecker.oldTime = newTime;
            if (Math.abs(timeDiff) >= MAX_CLOCK_DIFF) {
                node.log("System Time Change Detected!");
                refreshTasks(node);
            }
        }, 1000);

        const setProperty = function (msg, field, value) {
            const set = (obj, path, val) => {
                const keys = path.split('.');
                const lastKey = keys.pop();
                const lastObj = keys.reduce((obj, key) =>
                    obj[key] = obj[key] || {},
                    obj);
                lastObj[lastKey] = val;
            };
            set(msg, field, value);
        };

        const updateNodeNextInfo = (node, now) => {
            let t = getNextTask(node.tasks);
            if(t){
                let indicator = t.isDynamic ? "ring" : "dot";
                let nx = (t._expression || t._sequence);
                node.nextDate = nx.nextDate(now);
                node.nextEvent = t.name;
                node.nextIndicator = indicator;
                if(t.node_solarEventTimes && t.node_solarEventTimes.nextEvent){
                    node.nextEvent = t.node_solarEventTimes.nextEvent;
                }
            } else {
                node.nextDate = null;
                node.nextEvent = "";
                node.nextIndicator = "";
            }
        };

        const updateDoneStatus = (node, task) => {
            let indicator = "dot";
            if(task){
                indicator = node.nextIndicator || "dot";
            }
            node.status({ fill: "green", shape: indicator, text: "Done: " + formatShortDateTimeWithTZ(Date.now(), node.timeZone) });
            // node.nextDate = getNextTask(node.tasks);
            let now = new Date();
            updateNodeNextInfo(node, now);
            let next = node.nextDate ? new Date(node.nextDate).valueOf() : (Date.now() + 5001);
            let msTillNext = next - now;
            if (msTillNext > 5000){
                node.statusUpdatePending = true;
                setTimeout(function() {
                    node.statusUpdatePending = false;
                    updateNextStatus(node, true);
                }, 4000);
            }
        };

        const sendMsg = (node, task, cronTimestamp, manualTrigger) => {
            var msg = { cronplus: {} };
            msg.topic = task.node_topic;
            msg.cronplus.triggerTimestamp = cronTimestamp;
            let se = task.node_expressionType == "solar" ? node.nextEvent : "";
            msg.cronplus.status = getTaskStatus(node, task, { includeSolarStateOffset: true });
            if(se) msg.cronplus.status.solarEvent = se;
            msg.cronplus.config = exportTask(task);
            if(manualTrigger) msg.manualTrigger = true;
            msg.scheduledEvent = !msg.manualTrigger;
            let indicator = node.nextIndicator || "dot";
            let taskType = task.isDynamic ? "dynamic" : "static";
            let index = task.node_index || 0;
            node.status({ fill: "green", shape: indicator, text: "Schedule Started" });
            try {
                if (task.node_payloadType !== 'flow' && task.node_payloadType !== 'global') {
                    let pl;
                    if ((task.node_payloadType == null && task.node_payload === "") || task.node_payloadType === "date") {
                        pl = Date.now();
                    } else if (task.node_payloadType == null) {
                        pl = task.node_payload;
                    } else if (task.node_payloadType === 'none') {
                        pl = "";
                    } else if(task.node_payloadType === 'json' && isObject(task.node_payload)){
                        pl = task.node_payload;
                    } else if(task.node_payloadType === 'bin' && Array.isArray(task.node_payload)){
                        pl = Buffer.from(task.node_payload);
                    } else if(task.node_payloadType === 'default'){
                        pl = msg.cronplus;
                        delete msg.cronplus; //To delete or not?
                    } else {                        
                        pl = RED.util.evaluateNodeProperty(task.node_payload, task.node_payloadType, node, msg);    
                    }
                    setProperty(msg, node.outputField, pl);
                    node.send(generateSendMsg(node, msg, taskType, index));
                    updateDoneStatus(node, task);
                } else {
                    RED.util.evaluateNodeProperty(task.node_payload, task.node_payloadType, node, msg, function (err, res) {
                        if (err) {
                            node.error(err, msg);
                        } else {
                            setProperty(msg, node.outputField, res);
                            node.send(generateSendMsg(node, msg, taskType, index));
                            updateDoneStatus(node, task);
                        }
                    });
                }
            } catch (err) {
                node.error(err, msg);
            }
        };

        function getTask(node, name){
            let task = node.tasks.find(function(task){
                return task.name == name;
            });
            return task;
        }

        function getTaskStatus(node, task, opts){
            opts = opts || {};
            let sol = task.node_expressionType === "solar";
            let exp = sol ? task.node_location : task.node_expression;
            let h = _describeExpression(exp, task.node_expressionType, node.timeZone, task.node_offset, task.node_solarType, task.node_solarEvents, null, opts);
            let nextDescription = null;
            let nextDate = null;
            let running = !isTaskFinished(task);
            if(running){
                //nextDescription = h.nextDescription;
                nextDescription = h.prettyNext;
                nextDate = sol ? h.nextEventTimeOffset : h.nextDate;
            }
            let tz = node.timeZone;
            let localTZ = "";
            try {
                localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if(!tz) tz = localTZ;
            // eslint-disable-next-line no-empty
            } catch (error) { }

            let r = {
                type: task.isDynamic ? "dynamic" : "static",
                modified: task.modified ? true : false,
                isRunning: running && task.isRunning,
                count: task.node_count,
                limit: task.node_limit,
                nextDescription: nextDescription,
                nextDate: running ? nextDate : null,
                nextDateTZ: running ? formatShortDateTimeWithTZ(nextDate, tz) : null,
                timeZone: tz,
                serverTime: new Date(),
                serverTimeZone: localTZ,
                description: h.description
            };
            if(sol) {
                r.solarState = h.solarState;
                if(h.offset) r.solarStateOffset = h.solarStateOffset;
                r.solarTimes = running ? h.eventTimes : null;
                r.nextDescription = running ? nextDescription : null;//r.solarTimes && (r.solarTimes[0].event + " " + r.nextDescription);
            }
            return r;
        }
        function refreshTasks(node) {
            let tasks = node.tasks;
            node.log("Refreshing running schedules");
            if(tasks){
                try {
                    // let now = new Date();
                    if(!tasks || !tasks.length)
                        return null;
                    let tasksToRefresh = tasks.filter(function(task) {
                        return task._sequence || (task.isRunning && task._expression  && !isTaskFinished(task));
                    });
                    if(!tasksToRefresh || !tasksToRefresh.length){
                        return null;
                    }
                    for (let index = 0; index < node.tasks.length; index++) {
                        let task = node.tasks[index];
                        if(task.node_expressionType == "cron") {
                            task.stop();
                            task.start();
                        } else {
                            updateTask(node, task.node_opt, null);
                        }
                        //task.runScheduledTasks();
                        //index--;
                    }
                }
                // eslint-disable-next-line no-empty
                catch(e){ }
                updateNextStatus(node);
            }
        }
        function taskFilterMatch(task, filter) {
            if(!task) return false;
            const isActive = function(task) { return isTaskFinished(task) == false && task.isRunning == true; };
            const isInactive = function(task) { return isTaskFinished(task) || task.isRunning == false; };
            const isStatic = function(task) { return (task.isStatic == true || task.isDynamic == false); };
            const isDynamic = function(task) { return (task.isDynamic == true || task.isStatic == false); };
            switch (filter) {
                case "all":
                    return true;
                case "static":
                    return isStatic(task);
                case "dynamic":
                    return isDynamic(task);
                case "active":
                    return isActive(task);
                case "inactive":
                    return isInactive(task);
                case "active-dynamic":
                    return isActive(task) && isDynamic(task);
                case "active-static":
                    return isActive(task) && isStatic(task);
                case "inactive-dynamic":
                    return isInactive(task) && isDynamic(task);
                case "inactive-static":
                    return isInactive(task) && isStatic(task);
            }
            return false;
        }
        function stopTask(node, name, resetCounter){
            let task = getTask(node, name);
            if(task){
                task.stop();
                if(resetCounter){ task.node_count = 0; }
            }
            return task;
        }
        function stopAllTasks(node, resetCounter, filter){
            if(node.tasks){
                for (let index = 0; index < node.tasks.length; index++) {
                    let task = node.tasks[index];
                    if(task){
                        let skip = false;
                        if(filter) skip = (taskFilterMatch(task, filter) === false);         
                        if(!skip){
                            task.stop();
                            if(resetCounter){ task.node_count = 0; }
                        }              
                    }    
                }
            }
        }
        function startTask(node, name){
            let task = getTask(node, name);
            if(task){
                if(isTaskFinished(task)){
                    task.node_count = 0;
                }
                task.stop();//prevent bug where calling start without first calling stop causes events to bunch up
                task.start();
            }
            return task;
        }
        function startAllTasks(node, filter){
            if(node.tasks){
                for (let index = 0; index < node.tasks.length; index++) {
                    let task = node.tasks[index];
                    let skip = false;
                    if(filter) skip = (taskFilterMatch(task, filter) === false);
                    if(!skip && task){
                        if(isTaskFinished(task)){
                            task.node_count = 0;
                        }
                        task.stop();//prevent bug where calling start without first calling stop causes events to bunch up
                        task.start();
                    }    
                }
            }
        }
        function deleteAllTasks(node, filter){
            if(node.tasks){
                for (let index = 0; index < node.tasks.length; index++) {
                    try {
                        let task = node.tasks[index];
                        if(task){
                            let skip = false;
                            if(filter) skip = (taskFilterMatch(task, filter) === false);
                            if(!skip){
                                _deleteTask(task);
                                node.tasks[index] = null;
                                node.tasks.splice(index, 1);
                                index--;
                            }
                        }             
                    // eslint-disable-next-line no-empty
                    } catch (error) { } 
                }
            }
        }
        function deleteTask(node, name){
            let task = getTask(node, name);
            if(task){
                _deleteTask(task);
                node.tasks = node.tasks.filter(t => t && t.name != name);
                task = null;
            }
        }
        function _deleteTask(task) {
            try {
                task.off('run');
                task.off('ended');
                task.off('started');
                task.off('stopped');
                task.stop();
                task = null;
            // eslint-disable-next-line no-empty
            } catch (error) {}
        }        
        function updateTask(node, options, msg){
            if(!options || typeof options != "object"){
                node.warn("schedule settings are not valid", msg);
                return null;
            }

            if(Array.isArray(options) == false){
                options = [options];
            }

            for (let index = 0; index < options.length; index++) {
                let opt = options[index];
                try {
                    validateOpt(opt);                    
                } catch (error) {
                    node.warn(error, msg);
                    return;
                }
            }

            for (let index = 0; index < options.length; index++) {
                let opt = options[index];
                let task = getTask(node, opt.name);
                let isDynamic = !task || task.isDynamic;
                // let isStatic = task && task.isStatic;
                let opCount = 0, modified = false;
                if(task){
                    modified = true;
                    opCount  = task.node_count || 0; 
                    deleteTask(node, opt.name);
                }
                let taskCount = node.tasks ? node.tasks.length : 0;
                let taskIndex = task && node.fanOut ? (task.node_index || 0) : taskCount;
                let t = createTask(node, opt, taskIndex, !isDynamic);  
                if(t){
                    if(modified) t.node_modified = true;
                    t.node_count = opCount;
                    t.isDynamic = isDynamic;
                }
            }
        }
        
        function createTask(node, opt, index, static) {
            opt = opt || {};
            try {
                node.log(`createTask - index: ${index}, static: ${static}, opt: ${JSON.stringify(opt)}`);
            } catch (error) {
                node.error(error);
            }
            applyOptionDefaults(opt, index);
            try {
                validateOpt(opt);                    
            } catch (error) {
                node.warn(error);
                let indicator = static ? "dot" : "ring";
                node.status({ fill: "red", shape: indicator, text: error.message });
                return null;
            }
            let cronOpts = node.timeZone ? { timezone: node.timeZone } : undefined;
            let task;
            if(opt.expressionType == "cron"){
                let expression = cronosjs.CronosExpression.parse(opt.expression, cronOpts);
                task = new cronosjs.CronosTask(expression);
            } else if(opt.expressionType === "solar") {
                let ds = parseSolarTimes(opt); 
                task = ds.task;
                task.node_solarEventTimes = ds.solarEventTimes;
            } else {
                let ds = parseDateSequence(opt.expression);            
                task = ds.task;
            }
            task.isDynamic = !static;
            task.isStatic = static;
            task.name = "" + opt.name;
            task.node_topic = opt.topic;
            task.node_expressionType = opt.expressionType;
            task.node_expression = opt.expression;
            task.node_payloadType = opt.payloadType;
            task.node_payload = opt.payload;
            task.node_count = 0;
            task.node_location = opt.location;
            task.node_solarType = opt.solarType;
            task.node_solarEvents = opt.solarEvents;
            task.node_offset = opt.offset;
            task.node_index = index;
            task.node_opt = opt;
            task.node_limit = opt.limit || 0;
            task.stop();
            task.on('run', (timestamp) => {
                node.debug(`running '${task.name}' ~ '${task.node_topic}'\n now time ${new Date()}\n crontime ${new Date(timestamp)}`);
                let indicator = task.isDynamic ? "ring" : "dot";
                node.status({ fill: "green", shape: indicator, text: "Running " + formatShortDateTimeWithTZ(timestamp, node.timeZone) });
                if(isTaskFinished(task)){
                    process.nextTick(function(){
                        //using nextTick is a work around for an issue (#3) in cronosjs where the job restarts itself after this event handler has exited
                        task.stop();
                        updateNextStatus(node);
                    });
                    return;
                } 
                task.node_count = task.node_count + 1;//++ stops at 2147483647
                sendMsg(node, task, timestamp);
                process.nextTick(function(){
                    if( task.node_expressionType === "solar" ){
                        updateTask(node, task.node_opt, null);
                    }
                });
            })
            .on('ended', () => {
                node.debug(`ended '${task.name}' ~ '${task.node_topic}'`);
                updateNextStatus(node);
            })
            .on('started', () => {
                node.debug(`started '${task.name}' ~ '${task.node_topic}'`);
                process.nextTick(function(){
                    updateNextStatus(node);
                });
            })
            .on('stopped', () => {
                node.debug(`stopped '${task.name}' ~ '${task.node_topic}'`);
                updateNextStatus(node);
            });
            task.stop();//prevent bug where calling start without first calling stop causes events to bunch up
            task.start();
            node.tasks.push(task);
            return task;
        }

        function serialise(){
            let filePath = "";
            try {
                if(!persistAvailable || !node.persistDynamic){
                    return;
                }  
                filePath = getPersistFilePath();
                let dynNodes = node.tasks.filter((e)=>e && e.isDynamic);
                let exp = (t) => exportTask(t, false);
                let dynNodesExp = dynNodes.map(exp);
                /*if(!dynNodesExp || !dynNodesExp.length){
                    //FUTURE TODO: Sanity check before deletion
                    //and only if someone asks for it :)
                    //other wise, file clean up is a manual task
                    fs.unlinkSync(filePath);
                    return;
                } */
                let data = {
                    version: 1,
                    schedules: dynNodesExp
                };
                let fileData = JSON.stringify(data);
                fs.writeFileSync(filePath, fileData);
            } catch (e) {
                RED.log.error(`cron-plus: Error saving persistence data '${filePath}'. ${e.message}`);
            }
        }

        function deserialise(){
            let filePath = "";
            try {
                if(!persistAvailable || !node.persistDynamic){
                    return;
                }
                filePath = getPersistFilePath();
                if(fs.existsSync(filePath)){
                    let fileData = fs.readFileSync(filePath);
                    let data = JSON.parse(fileData);
                    if(!data){
                        return; //nothing to add
                    }
                    if(data.version != 1){
                        throw new Error("Invalid version - cannot load dynamic schedules");
                    }
                    if(!data.schedules || !data.schedules.length){
                        return; //nothing to add
                    }
                    for(let iOpt = 0; iOpt < data.schedules.length; iOpt++){
                        let opt = data.schedules[iOpt];
                        opt.name = opt.name || opt.topic;
                        createTask(node, opt, iOpt, false);
                    }
                } else {
                    RED.log.log(`cron-plus: no persistence data found for node '${node.id}'.`);
                }        
            } catch (error) {
                RED.log.error(`cron-plus: Error loading persistence data '${filePath}'. ${error.message}`);
            }            
        }

        function getPersistFilePath(){
            let fileName = `node-${node.id}.json`;
            return path.join(persistPath, fileName);
        }

        try {
            node.status({});
            node.nextDate = null;

            if(!node.options){
                node.status({ fill: "grey", shape: "dot", text: "Nothing set" });
                return;
            } 

            node.tasks = [];
            for(let iOpt = 0; iOpt < node.options.length; iOpt++){
                let opt = node.options[iOpt];
                opt.name = opt.name || opt.topic;
                node.statusUpdatePending = true;//prevent unnecessary status updates while loading
                createTask(node, opt, iOpt, true);
            }

            //now load dynamic schedules from file
            deserialise();

            setTimeout(() => {
                updateNextStatus(node, true);    
            }, 200);
            

        } catch (err) {
            if (node.tasks) {
                node.tasks.forEach(task => task.stop());
            }
            node.status({ fill: "red", shape: "dot", text: "Error creating schedule" });
            node.error(err);
        }
        
        function updateNextStatus(node, force) {
            let now = new Date();
            updateNodeNextInfo(node, now);
            if(node.statusUpdatePending == true){
                if(force){
                    node.statusUpdatePending = false;
                } else {
                    return;
                }
            }
            
            if (node.tasks) {
                let indicator = node.nextIndicator || "dot";
                if (node.nextDate) {
                    let d = formatShortDateTimeWithTZ(node.nextDate, node.timeZone) || "Never";
                    node.status({ fill: "blue", shape: indicator, text: (node.nextEvent || "Next") + ": " + d });
                } else if (node.tasks && node.tasks.length ) {
                    node.status({ fill: "grey", shape: indicator, text: "All stopped" });
                } else {
                    node.status({ }); //no tasks
                }
            } else {
                node.status({});
            }
        }

        function isTaskFinished(_task){
            if(!_task) return true;
            return _task.node_limit ? _task.node_count >= _task.node_limit : false;
        }
        function getNextTask(tasks) {
            try {
                let now = new Date();
                if(!tasks || !tasks.length)
                    return null;
                let runningTasks = tasks.filter(function(task){
                    let finished = isTaskFinished(task);
                    return task.isRunning && (task._expression || task._sequence) && !finished;
                });
                if(!runningTasks || !runningTasks.length){
                    return null;
                }

                let nextToRunTask;
                if(runningTasks.length == 1){
                    // let x = (runningTasks[0]._expression || runningTasks[0]._sequence)
                    nextToRunTask = runningTasks[0];
                    // d = x.nextDate(now);
                } else {
                    nextToRunTask = runningTasks.reduce(function (prev, current) {
                        // let p, c; 
                        if(!prev) return current;
                        if(!current) return prev;
                        let px = (prev._expression || prev._sequence);
                        let cx = (current._expression || current._sequence);
                        return (px.nextDate(now) < cx.nextDate(now)) ? prev : current;
                    });
                }
                return nextToRunTask;

            } catch (error) {
                node.debug(error);
            }
            return null;
        }
        function generateSendMsg(node, msg, type, index) {
            var outputCount = node.outputs;
            var fanOut = node.fanOut;
            var hasCommandOutputPin = (node.commandResponseMsgOutput === "output2" || fanOut) ? true : false;
            var optionCount = node.options ? node.options.length : 0;
            var staticOutputPinIndex = 0;
            var dynOutputPinIndex = 0;
            var cmdOutputPin = 0;
            if (fanOut) {
                dynOutputPinIndex = optionCount;
                cmdOutputPin = optionCount + 1;
                staticOutputPinIndex = index || 0;
            }
            if (!fanOut && hasCommandOutputPin) {
                cmdOutputPin = 1;  
            }

            let idx = 0;
            switch (type) {
                case "static":
                    idx = staticOutputPinIndex;
                    break;
                case "dynamic":
                    idx = dynOutputPinIndex;
                    break;
                case "command-response":
                    idx = cmdOutputPin;
                    break;
            }
            var arr = Array(outputCount || (idx + 1));
            arr.fill(null);
            arr[idx] = msg;
            return arr;
        }

        node.on('close', function (done) {
            try {
                serialise();
            } catch (error) {
                node.error(error);
            }
            deleteAllTasks(this);
            if(clockMonitor) clearInterval(clockMonitor);
            if(done && typeof done == "function") done();
        });

        this.on("input", function (msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            done = done || function(err) {
                if(err){
                    node.error(err, msg);
                }
            };
            //is this an button press?...
            if(!msg.payload && !msg.topic){//TODO: better method of differentiating between bad input and button press
                sendMsg(node, node.tasks[0], Date.now(), true);
                done();
                return;
            }

            let controlTopic = control_topics.find(ct => ct.command == msg.topic);
            var payload = msg.payload;
            if(controlTopic){
                if(controlTopic.payloadIsName){
                    if(!payload || typeof payload != "string"){
                        node.error(`Invalid payload! Control topic '${msg.topic}' expects the name of the schedule to be in msg.payload`, msg);
                        return;
                    } 
                    //emulate the cmd object
                    payload = {
                        command: controlTopic.command,
                        name: payload
                    };
                } else {
                    payload = {
                        command: controlTopic.command
                    };
                }
            }

            if(typeof payload != "object"){
                return;
            }

            try {
                let input = payload;
                if(Array.isArray(payload) == false){
                    input = [input];
                }
                var sendCommandResponse = function(msg){
                    send(generateSendMsg(node, msg, "command-response"));
                };
                for (let i = 0; i < input.length; i++) {
                    let cmd = input[i];
                    let action = cmd.command || "";
                    // let newMsg = {topic: msg.topic, payload:{command:cmd, result:{}}};
                    let newMsg = RED.util.cloneMessage(msg);
                    newMsg.payload = { command: cmd, result: {} };
                    let cmd_all = action.endsWith("-all");
                    let cmd_all_static = action.endsWith("-all-static");
                    let cmd_all_dynamic = action.endsWith("-all-dynamic");
                    let cmd_active = action.endsWith("-active");
                    let cmd_inactive = action.endsWith("-inactive");
                    let cmd_active_dynamic = action.includes("-active-dynamic");
                    let cmd_active_static = action.includes("-active-static");
                    let cmd_inactive_dynamic = action.includes("-inactive-dynamic");
                    let cmd_inactive_static = action.includes("-inactive-static");

                    let cmd_filter = null;
                    var actionParts = action.split("-");
                    var mainAction = actionParts[0];
                    if(actionParts.length > 1) mainAction += "-";
                    
                    if(cmd_all_dynamic){
                        cmd_filter = "dynamic";
                    } else if(cmd_all_static) {
                        cmd_filter = "static";
                    } else if(cmd_active) {
                        cmd_filter = "active";
                    } else if(cmd_inactive) {
                        cmd_filter = "inactive";
                    } else if(cmd_active_dynamic) {
                        cmd_filter = "active-dynamic";
                    } else if(cmd_active_static) {
                        cmd_filter = "active-static";
                    } else if(cmd_inactive_dynamic) {
                        cmd_filter = "inactive-dynamic";
                    } else if(cmd_inactive_static) {
                        cmd_filter = "inactive-static";
                    }

                    switch (mainAction) {
                        case "trigger": //single
                            {
                                let tt = getTask(node, cmd.name);
                                if(!tt) throw new Error(`Manual Trigger failed. Cannot find schedule named '${cmd.name}'`);
                                sendMsg(node, tt, Date.now(), true);
                            }
                            break;
                        case "trigger-": //multiple
                            {    
                                if(node.tasks){
                                    for (let index = 0; index < node.tasks.length; index++) {
                                        const task = node.tasks[index];
                                        if( task && (cmd_all || taskFilterMatch(task, cmd_filter)) ) {
                                            sendMsg(node, task, Date.now(), true);   
                                        }
                                    }
                                }
                            }
                            break;
                        case "describe": //single
                            {
                                let exp = (cmd.expressionType === "solar") ? cmd.location : cmd.expression;
                                applyOptionDefaults(cmd);
                                newMsg.payload.result = _describeExpression(exp, cmd.expressionType, cmd.timeZone || node.timeZone, cmd.offset, cmd.solarType, cmd.solarEvents, cmd.time, { includeSolarStateOffset: true });
                                sendCommandResponse(newMsg);
                            }
                            break;
                        case "status": //single
                            {
                                let task = getTask(node, cmd.name);
                                if(task){
                                    newMsg.payload.result.config = exportTask(task, true);
                                    newMsg.payload.result.status = getTaskStatus(node, task, { includeSolarStateOffset: true });
                                } else {
                                    newMsg.error = `${cmd.name} not found`;
                                }
                                sendCommandResponse(newMsg);
                            }
                            updateNextStatus(node, true);
                            break;
                        case "export": //single
                            {
                                let task = getTask(node, cmd.name);
                                if(task){
                                    newMsg.payload.result = exportTask(task, false);
                                } else {
                                    newMsg.error = `${cmd.name} not found`;
                                }
                                sendCommandResponse(newMsg);
                            }
                            break;                            
                        case "list-": //multiple
                        case "status-": //multiple
                            {    
                                let results = [];
                                if(node.tasks){
                                    for (let index = 0; index < node.tasks.length; index++) {
                                        const task = node.tasks[index];
                                        if( task && (cmd_all || taskFilterMatch(task, cmd_filter)) ) {
                                            let result = {};
                                            result.config = exportTask(task, true);
                                            result.status = getTaskStatus(node, task, { includeSolarStateOffset: true });
                                            results.push(result);    
                                        }
                                    }
                                }
                                newMsg.payload.result = results;
                                sendCommandResponse(newMsg);
                            }
                            break;
                        case "export-": //multiple
                            {
                                let results = [];
                                if(node.tasks){
                                    for (let index = 0; index < node.tasks.length; index++) {
                                        const task = node.tasks[index];
                                        if( cmd_all || taskFilterMatch(task, cmd_filter) ) {
                                            results.push(exportTask(task, false)); 
                                        }
                                    }
                                }
                                newMsg.payload.result = results;
                                sendCommandResponse(newMsg);
                            }
                            break;                            
                        case "add": //single
                        case "update": //single
                            updateTask(node, cmd, msg);
                            updateNextStatus(node, true);
                            serialise();//update persistent
                            break;
                        case "clear":
                        case "remove-": //multiple
                        case "delete-": //multiple
                            deleteAllTasks(node, cmd_filter);
                            updateNextStatus(node, true);
                            serialise();//update persistent
                            break;
                        case "remove": //single
                        case "delete": //single
                            deleteTask(node, cmd.name);
                            updateNextStatus(node, true);
                            serialise();//update persistent
                            break;
                        case "start": //single
                            startTask(node, cmd.name);
                            updateNextStatus(node, true);
                            break;
                        case "start-": //multiple
                            startAllTasks(node, cmd_filter);
                            updateNextStatus(node, true);
                            break;
                        case "stop": //single
                        case "pause": //single
                            stopTask(node, cmd.name, cmd.command == "stop");
                            updateNextStatus(node, true);
                            break;
                        case "stop-": //multiple
                        case "pause-":{
                                let resetCounter = cmd.command.startsWith("stop-");
                                stopAllTasks(node, resetCounter, cmd_filter);
                                updateNextStatus(node, true);
                            }
                            break;
                        case "debug":{
                                let task = getTask(node, cmd.name);
                                let thisDebug = getTaskStatus(node, task, { includeSolarStateOffset: true });
                                thisDebug.name = task.name;
                                thisDebug.topic = task.node_topic;
                                thisDebug.expressionType = task.node_expressionType;
                                thisDebug.expression = task.node_expression;
                                thisDebug.location = task.node_location;
                                thisDebug.offset = task.node_offset;
                                thisDebug.solarType = task.node_solarType;
                                thisDebug.solarEvents = task.node_solarEvents;
                                newMsg.payload = thisDebug;
                                sendCommandResponse(newMsg);
                            }
                            break;
                        case "debug-":{     //multiple
                                let results = [];
                                if(node.tasks){
                                    for (let index = 0; index < node.tasks.length; index++) {
                                        const task = node.tasks[index];
                                        if( cmd_all || taskFilterMatch(task, cmd_filter) ) {
                                            let thisDebug = getTaskStatus(node, task, { includeSolarStateOffset: true });
                                            thisDebug.name = task.name;
                                            thisDebug.topic = task.node_topic;
                                            thisDebug.expressionType = task.node_expressionType;
                                            thisDebug.expression = task.node_expression;
                                            thisDebug.location = task.node_location;
                                            thisDebug.offset = task.node_offset;
                                            thisDebug.solarType = task.node_solarType;
                                            thisDebug.solarEvents = task.node_solarEvents;
                                            results.push(thisDebug);
                                        }
                                    }
                                }
                                newMsg.payload = results;
                                sendCommandResponse(newMsg);
                            }
                            break;    
                    }
                }
            } catch (error) {
                done(error);
                //node.error(error,msg);
            }            
        });

    }
    RED.nodes.registerType("cronplus", CronPlus);

    RED.httpAdmin.post("/cronplusinject/:id", RED.auth.needsPermission("cronplus.write"), function (req, res) {
        var node = RED.nodes.getNode(req.params.id);
        if (node != null) {
            try {
                node.receive();
                res.sendStatus(200);
            } catch (err) {
                res.sendStatus(500);
                node.error(RED._("inject.failed", { error: err.toString() }));
            }
        } else {
            res.sendStatus(404);
        }
    });

    RED.httpAdmin.post("/cronplus/:id/:operation", RED.auth.needsPermission("cronplus.read"), function (req, res) {
        // console.log("/cronplus", req.body);       
        try {
            let operation = req.params.operation; 
            if(operation == "expressionTip"){
                let timeZone = req.body.timeZone ? req.body.timeZone : undefined;
                let expressionType = req.body.expressionType ? req.body.expressionType : undefined;
                var opts = { expression: req.body.expression };
                if(timeZone) opts.timezone = timeZone;
                if(expressionType) {
                    opts.expressionType = expressionType;
                    if(opts.expressionType === "solar"){
                        opts.solarType = req.body.solarType || "";
                        opts.solarEvents = req.body.solarEvents || "";
                        opts.location = req.body.location || "";
                        opts.offset = req.body.offset || 0;
                    }
                }
                let exp = (opts.expressionType === "solar") ? opts.location : opts.expression;
                let h = _describeExpression(exp, opts.expressionType, opts.timezone, opts.offset, opts.solarType, opts.solarEvents, null);
                let r = null;
                if(opts.expressionType == "solar"){
                    let times = h.eventTimes && h.eventTimes.slice(1); 
                    r = { 
                        ...opts, 
                        // description: desc, 
                        description: h.description, 
                        // next: next,
                        next: h.nextEventTimeOffset,
                        // nextEventDesc: nextEventDesc, 
                        nextEventDesc: h.nextEvent, 
                        // prettyNext: prettyNext, 
                        prettyNext: h.prettyNext, 
                        // nextDates: nextDates 
                        nextDates: times 
                    };
                } else {
                    let times = h.nextDates && h.nextDates.slice(1);
                    r = { 
                        ...opts, 
                        description: h.description, 
                        // next: next,
                        next: h.nextDate,
                        // nextEventDesc: nextEventDesc, 
                        nextEventDesc: h.nextDescription, 
                        // prettyNext: prettyNext, 
                        prettyNext: h.prettyNext, 
                        // nextDates: nextDates 
                        nextDates: times 
                    };
                }
                
                res.json(r);
            } else if(operation == "getDynamic") {
                let node = RED.nodes.getNode(req.params.id); 
                if(!node){
                    res.json([]);
                    return;
                }
                let dynNodes = node.tasks.filter((e)=>e && e.isDynamic);
                let exp = (t) => exportTask(t, false);
                let dynNodesExp = dynNodes.map(exp);
                res.json(dynNodesExp);
            } else if(operation == "tz") {
                res.json(timeZones);
            }       
    
        } catch (err) {
            res.sendStatus(500);
            console.error(err);
        }
    });

};



/**
 * Array of timezones
 */
const timeZones = [
    { "code": "CI", "latLon": "+0519-00402", "tz": "Africa/Abidjan", "UTCOffset": "+00:00", "UTCDSTOffset": "+00:00" },
    { "code": "GH", "latLon": "+0533-00013", "tz": "Africa/Accra", "UTCOffset": "+00:00", "UTCDSTOffset": "+00:00" },
    { "code": "DZ", "latLon": "3950", "tz": "Africa/Algiers", "UTCOffset": "+01:00", "UTCDSTOffset": "+01:00" },
    { "code": "GW", "latLon": "+1151-01535", "tz": "Africa/Bissau", "UTCOffset": "+00:00", "UTCDSTOffset": "+00:00" },
    { "code": "EG", "latLon": "6118", "tz": "Africa/Cairo", "UTCOffset": "+02:00", "UTCDSTOffset": "+02:00" },
    { "code": "MA", "latLon": "+3339-00735", "tz": "Africa/Casablanca", "UTCOffset": "+01:00", "UTCDSTOffset": "+01:00" },
    { "code": "ES", "latLon": "+3553-00519", "tz": "Africa/Ceuta", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "EH", "latLon": "+2709-01312", "tz": "Africa/El_Aaiun", "UTCOffset": "+00:00", "UTCDSTOffset": "+01:00" },
    { "code": "ZA", "latLon": "-2615+02800", "tz": "Africa/Johannesburg", "UTCOffset": "+02:00", "UTCDSTOffset": "+02:00" },
    { "code": "SS", "latLon": "3587", "tz": "Africa/Juba", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "SD", "latLon": "4768", "tz": "Africa/Khartoum", "UTCOffset": "+02:00", "UTCDSTOffset": "+02:00" },
    { "code": "NG", "latLon": "951", "tz": "Africa/Lagos", "UTCOffset": "+01:00", "UTCDSTOffset": "+01:00" },
    { "code": "MZ", "latLon": "-2558+03235", "tz": "Africa/Maputo", "UTCOffset": "+02:00", "UTCDSTOffset": "+02:00" },
    { "code": "LR", "latLon": "+0618-01047", "tz": "Africa/Monrovia", "UTCOffset": "+00:00", "UTCDSTOffset": "+00:00" },
    { "code": "KE", "latLon": "-0117+03649", "tz": "Africa/Nairobi", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "TD", "latLon": "2710", "tz": "Africa/Ndjamena", "UTCOffset": "+01:00", "UTCDSTOffset": "+01:00" },
    { "code": "LY", "latLon": "4565", "tz": "Africa/Tripoli", "UTCOffset": "+02:00", "UTCDSTOffset": "+02:00" },
    { "code": "TN", "latLon": "4659", "tz": "Africa/Tunis", "UTCOffset": "+01:00", "UTCDSTOffset": "+01:00" },
    { "code": "NA", "latLon": "-2234+01706", "tz": "Africa/Windhoek", "UTCOffset": "+02:00", "UTCDSTOffset": "+02:00" },
    { "code": "US", "latLon": "+515248-1763929", "tz": "America/Adak", "UTCOffset": "-10:00", "UTCDSTOffset": "-09:00" },
    { "code": "US", "latLon": "+611305-1495401", "tz": "America/Anchorage", "UTCOffset": "-09:00", "UTCDSTOffset": "-08:00" },
    { "code": "BR", "latLon": "-0712-04812", "tz": "America/Araguaina", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-3436-05827", "tz": "America/Argentina/Buenos_Aires", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-2828-06547", "tz": "America/Argentina/Catamarca", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-3124-06411", "tz": "America/Argentina/Cordoba", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-2411-06518", "tz": "America/Argentina/Jujuy", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-2926-06651", "tz": "America/Argentina/La_Rioja", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-3253-06849", "tz": "America/Argentina/Mendoza", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-5138-06913", "tz": "America/Argentina/Rio_Gallegos", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-2447-06525", "tz": "America/Argentina/Salta", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-3132-06831", "tz": "America/Argentina/San_Juan", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-3319-06621", "tz": "America/Argentina/San_Luis", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-2649-06513", "tz": "America/Argentina/Tucuman", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AR", "latLon": "-5448-06818", "tz": "America/Argentina/Ushuaia", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "PY", "latLon": "-2516-05740", "tz": "America/Asuncion", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "CA", "latLon": "+484531-0913718", "tz": "America/Atikokan", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "BR", "latLon": "-1259-03831", "tz": "America/Bahia", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "MX", "latLon": "+2048-10515", "tz": "America/Bahia_Banderas", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "BB", "latLon": "+1306-05937", "tz": "America/Barbados", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "BR", "latLon": "-0127-04829", "tz": "America/Belem", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "BZ", "latLon": "+1730-08812", "tz": "America/Belize", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "CA", "latLon": "+5125-05707", "tz": "America/Blanc-Sablon", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "BR", "latLon": "+0249-06040", "tz": "America/Boa_Vista", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "CO", "latLon": "+0436-07405", "tz": "America/Bogota", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+433649-1161209", "tz": "America/Boise", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "CA", "latLon": "+690650-1050310", "tz": "America/Cambridge_Bay", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "BR", "latLon": "-2027-05437", "tz": "America/Campo_Grande", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "MX", "latLon": "+2105-08646", "tz": "America/Cancun", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "VE", "latLon": "+1030-06656", "tz": "America/Caracas", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "GF", "latLon": "+0456-05220", "tz": "America/Cayenne", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "US", "latLon": "+4151-08739", "tz": "America/Chicago", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "MX", "latLon": "+2838-10605", "tz": "America/Chihuahua", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "CR", "latLon": "+0956-08405", "tz": "America/Costa_Rica", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "CA", "latLon": "+4906-11631", "tz": "America/Creston", "UTCOffset": "-07:00", "UTCDSTOffset": "-07:00" },
    { "code": "BR", "latLon": "-1535-05605", "tz": "America/Cuiaba", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "CW", "latLon": "+1211-06900", "tz": "America/Curacao", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "GL", "latLon": "+7646-01840", "tz": "America/Danmarkshavn", "UTCOffset": "+00:00", "UTCDSTOffset": "+00:00" },
    { "code": "CA", "latLon": "+6404-13925", "tz": "America/Dawson", "UTCOffset": "-08:00", "UTCDSTOffset": "-07:00" },
    { "code": "CA", "latLon": "+5946-12014", "tz": "America/Dawson_Creek", "UTCOffset": "-07:00", "UTCDSTOffset": "-07:00" },
    { "code": "US", "latLon": "+394421-1045903", "tz": "America/Denver", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "US", "latLon": "+421953-0830245", "tz": "America/Detroit", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "CA", "latLon": "+5333-11328", "tz": "America/Edmonton", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "BR", "latLon": "-0640-06952", "tz": "America/Eirunepe", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "SV", "latLon": "+1342-08912", "tz": "America/El_Salvador", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "CA", "latLon": "+5848-12242", "tz": "America/Fort_Nelson", "UTCOffset": "-07:00", "UTCDSTOffset": "-07:00" },
    { "code": "BR", "latLon": "-0343-03830", "tz": "America/Fortaleza", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "CA", "latLon": "+4612-05957", "tz": "America/Glace_Bay", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "GL", "latLon": "+6411-05144", "tz": "America/Godthab", "UTCOffset": "-03:00", "UTCDSTOffset": "-02:00" },
    { "code": "CA", "latLon": "+5320-06025", "tz": "America/Goose_Bay", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "TC", "latLon": "+2128-07108", "tz": "America/Grand_Turk", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "GT", "latLon": "+1438-09031", "tz": "America/Guatemala", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "EC", "latLon": "-0210-07950", "tz": "America/Guayaquil", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "GY", "latLon": "+0648-05810", "tz": "America/Guyana", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "CA", "latLon": "+4439-06336", "tz": "America/Halifax", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "CU", "latLon": "+2308-08222", "tz": "America/Havana", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "MX", "latLon": "+2904-11058", "tz": "America/Hermosillo", "UTCOffset": "-07:00", "UTCDSTOffset": "-07:00" },
    { "code": "US", "latLon": "+394606-0860929", "tz": "America/Indiana/Indianapolis", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "US", "latLon": "+411745-0863730", "tz": "America/Indiana/Knox", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+382232-0862041", "tz": "America/Indiana/Marengo", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "US", "latLon": "+382931-0871643", "tz": "America/Indiana/Petersburg", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "US", "latLon": "+375711-0864541", "tz": "America/Indiana/Tell_City", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+384452-0850402", "tz": "America/Indiana/Vevay", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "US", "latLon": "+384038-0873143", "tz": "America/Indiana/Vincennes", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "US", "latLon": "+410305-0863611", "tz": "America/Indiana/Winamac", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "CA", "latLon": "+682059-13343", "tz": "America/Inuvik", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "CA", "latLon": "+6344-06828", "tz": "America/Iqaluit", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "JM", "latLon": "+175805-0764736", "tz": "America/Jamaica", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+581807-1342511", "tz": "America/Juneau", "UTCOffset": "-09:00", "UTCDSTOffset": "-08:00" },
    { "code": "US", "latLon": "+381515-0854534", "tz": "America/Kentucky/Louisville", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "US", "latLon": "+364947-0845057", "tz": "America/Kentucky/Monticello", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "BO", "latLon": "-1630-06809", "tz": "America/La_Paz", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "PE", "latLon": "-1203-07703", "tz": "America/Lima", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+340308-1181434", "tz": "America/Los_Angeles", "UTCOffset": "-08:00", "UTCDSTOffset": "-07:00" },
    { "code": "BR", "latLon": "-0940-03543", "tz": "America/Maceio", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "NI", "latLon": "+1209-08617", "tz": "America/Managua", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "BR", "latLon": "-0308-06001", "tz": "America/Manaus", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "MQ", "latLon": "+1436-06105", "tz": "America/Martinique", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "MX", "latLon": "+2550-09730", "tz": "America/Matamoros", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "MX", "latLon": "+2313-10625", "tz": "America/Mazatlan", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "US", "latLon": "+450628-0873651", "tz": "America/Menominee", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "MX", "latLon": "+2058-08937", "tz": "America/Merida", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+550737-1313435", "tz": "America/Metlakatla", "UTCOffset": "-09:00", "UTCDSTOffset": "-08:00" },
    { "code": "MX", "latLon": "+1924-09909", "tz": "America/Mexico_City", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "PM", "latLon": "+4703-05620", "tz": "America/Miquelon", "UTCOffset": "-03:00", "UTCDSTOffset": "-02:00" },
    { "code": "CA", "latLon": "+4606-06447", "tz": "America/Moncton", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "MX", "latLon": "+2540-10019", "tz": "America/Monterrey", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "UY", "latLon": "-3453-05611", "tz": "America/Montevideo", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "BS", "latLon": "+2505-07721", "tz": "America/Nassau", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "US", "latLon": "+404251-0740023", "tz": "America/New_York", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "CA", "latLon": "+4901-08816", "tz": "America/Nipigon", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "US", "latLon": "+643004-1652423", "tz": "America/Nome", "UTCOffset": "-09:00", "UTCDSTOffset": "-08:00" },
    { "code": "BR", "latLon": "-0351-03225", "tz": "America/Noronha", "UTCOffset": "-02:00", "UTCDSTOffset": "-02:00" },
    { "code": "US", "latLon": "+471551-1014640", "tz": "America/North_Dakota/Beulah", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+470659-1011757", "tz": "America/North_Dakota/Center", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+465042-1012439", "tz": "America/North_Dakota/New_Salem", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "MX", "latLon": "+2934-10425", "tz": "America/Ojinaga", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "PA", "latLon": "+0858-07932", "tz": "America/Panama", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "CA", "latLon": "+6608-06544", "tz": "America/Pangnirtung", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "SR", "latLon": "+0550-05510", "tz": "America/Paramaribo", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "US", "latLon": "+332654-1120424", "tz": "America/Phoenix", "UTCOffset": "-07:00", "UTCDSTOffset": "-07:00" },
    { "code": "TT", "latLon": "+1039-06131", "tz": "America/Port_of_Spain", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "HT", "latLon": "+1832-07220", "tz": "America/Port-au-Prince", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "BR", "latLon": "-0846-06354", "tz": "America/Porto_Velho", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "PR", "latLon": "+182806-0660622", "tz": "America/Puerto_Rico", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "CL", "latLon": "-5309-07055", "tz": "America/Punta_Arenas", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "CA", "latLon": "+4843-09434", "tz": "America/Rainy_River", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "CA", "latLon": "+6249-0920459", "tz": "America/Rankin_Inlet", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "BR", "latLon": "-0803-03454", "tz": "America/Recife", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "CA", "latLon": "+5024-10439", "tz": "America/Regina", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "CA", "latLon": "+744144-0944945", "tz": "America/Resolute", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "BR", "latLon": "-0958-06748", "tz": "America/Rio_Branco", "UTCOffset": "-05:00", "UTCDSTOffset": "-05:00" },
    { "code": "BR", "latLon": "-0226-05452", "tz": "America/Santarem", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "CL", "latLon": "-3327-07040", "tz": "America/Santiago", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "DO", "latLon": "+1828-06954", "tz": "America/Santo_Domingo", "UTCOffset": "-04:00", "UTCDSTOffset": "-04:00" },
    { "code": "BR", "latLon": "-2332-04637", "tz": "America/Sao_Paulo", "UTCOffset": "-03:00", "UTCDSTOffset": "-02:00" },
    { "code": "GL", "latLon": "+7029-02158", "tz": "America/Scoresbysund", "UTCOffset": "-01:00", "UTCDSTOffset": "+00:00" },
    { "code": "US", "latLon": "+571035-1351807", "tz": "America/Sitka", "UTCOffset": "-09:00", "UTCDSTOffset": "-08:00" },
    { "code": "CA", "latLon": "+4734-05243", "tz": "America/St_Johns", "UTCOffset": "-03:30", "UTCDSTOffset": "-02:30" },
    { "code": "CA", "latLon": "+5017-10750", "tz": "America/Swift_Current", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "HN", "latLon": "+1406-08713", "tz": "America/Tegucigalpa", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "GL", "latLon": "+7634-06847", "tz": "America/Thule", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "CA", "latLon": "+4823-08915", "tz": "America/Thunder_Bay", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "MX", "latLon": "+3232-11701", "tz": "America/Tijuana", "UTCOffset": "-08:00", "UTCDSTOffset": "-07:00" },
    { "code": "CA", "latLon": "+4339-07923", "tz": "America/Toronto", "UTCOffset": "-05:00", "UTCDSTOffset": "-04:00" },
    { "code": "CA", "latLon": "+4916-12307", "tz": "America/Vancouver", "UTCOffset": "-08:00", "UTCDSTOffset": "-07:00" },
    { "code": "CA", "latLon": "+6043-13503", "tz": "America/Whitehorse", "UTCOffset": "-08:00", "UTCDSTOffset": "-07:00" },
    { "code": "CA", "latLon": "+4953-09709", "tz": "America/Winnipeg", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "US", "latLon": "+593249-1394338", "tz": "America/Yakutat", "UTCOffset": "-09:00", "UTCDSTOffset": "-08:00" },
    { "code": "CA", "latLon": "+6227-11421", "tz": "America/Yellowknife", "UTCOffset": "-07:00", "UTCDSTOffset": "-06:00" },
    { "code": "AQ", "latLon": "-6617+11031", "tz": "Antarctica/Casey", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "AQ", "latLon": "-6835+07758", "tz": "Antarctica/Davis", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "AQ", "latLon": "-6640+14001", "tz": "Antarctica/DumontDUrville", "UTCOffset": "+10:00", "UTCDSTOffset": "+10:00" },
    { "code": "AU", "latLon": "-5430+15857", "tz": "Antarctica/Macquarie", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "AQ", "latLon": "-6736+06253", "tz": "Antarctica/Mawson", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "AQ", "latLon": "-6448-06406", "tz": "Antarctica/Palmer", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AQ", "latLon": "-6734-06808", "tz": "Antarctica/Rothera", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AQ", "latLon": "-690022+0393524", "tz": "Antarctica/Syowa", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "AQ", "latLon": "-720041+0023206", "tz": "Antarctica/Troll", "UTCOffset": "+00:00", "UTCDSTOffset": "+02:00" },
    { "code": "AQ", "latLon": "-7824+10654", "tz": "Antarctica/Vostok", "UTCOffset": "+06:00", "UTCDSTOffset": "+06:00" },
    { "code": "KZ", "latLon": "11972", "tz": "Asia/Almaty", "UTCOffset": "+06:00", "UTCDSTOffset": "+06:00" },
    { "code": "JO", "latLon": "6713", "tz": "Asia/Amman", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "RU", "latLon": "24174", "tz": "Asia/Anadyr", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
    { "code": "KZ", "latLon": "9447", "tz": "Asia/Aqtau", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "KZ", "latLon": "10727", "tz": "Asia/Aqtobe", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "TM", "latLon": "9580", "tz": "Asia/Ashgabat", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "KZ", "latLon": "9863", "tz": "Asia/Atyrau", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "IQ", "latLon": "7746", "tz": "Asia/Baghdad", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "AZ", "latLon": "8974", "tz": "Asia/Baku", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "TH", "latLon": "11376", "tz": "Asia/Bangkok", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "RU", "latLon": "13667", "tz": "Asia/Barnaul", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "LB", "latLon": "6883", "tz": "Asia/Beirut", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "KG", "latLon": "11690", "tz": "Asia/Bishkek", "UTCOffset": "+06:00", "UTCDSTOffset": "+06:00" },
    { "code": "BN", "latLon": "11911", "tz": "Asia/Brunei", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "RU", "latLon": "16531", "tz": "Asia/Chita", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "MN", "latLon": "16234", "tz": "Asia/Choibalsan", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "LK", "latLon": "8607", "tz": "Asia/Colombo", "UTCOffset": "+05:30", "UTCDSTOffset": "+05:30" },
    { "code": "SY", "latLon": "6948", "tz": "Asia/Damascus", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "BD", "latLon": "11368", "tz": "Asia/Dhaka", "UTCOffset": "+06:00", "UTCDSTOffset": "+06:00" },
    { "code": "TL", "latLon": "-0833+12535", "tz": "Asia/Dili", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "AE", "latLon": "8036", "tz": "Asia/Dubai", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "TJ", "latLon": "10683", "tz": "Asia/Dushanbe", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "CY", "latLon": "6864", "tz": "Asia/Famagusta", "UTCOffset": "+02:00", "UTCDSTOffset": "+02:00" },
    { "code": "PS", "latLon": "6558", "tz": "Asia/Gaza", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "PS", "latLon": "353674", "tz": "Asia/Hebron", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "VN", "latLon": "11685", "tz": "Asia/Ho_Chi_Minh", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "HK", "latLon": "13626", "tz": "Asia/Hong_Kong", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "MN", "latLon": "13940", "tz": "Asia/Hovd", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "RU", "latLon": "15636", "tz": "Asia/Irkutsk", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "ID", "latLon": "-0610+10648", "tz": "Asia/Jakarta", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "ID", "latLon": "-0232+14042", "tz": "Asia/Jayapura", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "IL", "latLon": "665976", "tz": "Asia/Jerusalem", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "AF", "latLon": "10343", "tz": "Asia/Kabul", "UTCOffset": "+04:30", "UTCDSTOffset": "+04:30" },
    { "code": "RU", "latLon": "21140", "tz": "Asia/Kamchatka", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
    { "code": "PK", "latLon": "9155", "tz": "Asia/Karachi", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "NP", "latLon": "11262", "tz": "Asia/Kathmandu", "UTCOffset": "+05:45", "UTCDSTOffset": "+05:45" },
    { "code": "RU", "latLon": "1977237", "tz": "Asia/Khandyga", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "IN", "latLon": "11054", "tz": "Asia/Kolkata", "UTCOffset": "+05:30", "UTCDSTOffset": "+05:30" },
    { "code": "RU", "latLon": "14851", "tz": "Asia/Krasnoyarsk", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "MY", "latLon": "10452", "tz": "Asia/Kuala_Lumpur", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "MY", "latLon": "11153", "tz": "Asia/Kuching", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "MO", "latLon": "13549", "tz": "Asia/Macau", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "RU", "latLon": "20982", "tz": "Asia/Magadan", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "ID", "latLon": "-0507+11924", "tz": "Asia/Makassar", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "PH", "latLon": "13535", "tz": "Asia/Manila", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "RU", "latLon": "14052", "tz": "Asia/Novokuznetsk", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "RU", "latLon": "13757", "tz": "Asia/Novosibirsk", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "RU", "latLon": "12824", "tz": "Asia/Omsk", "UTCOffset": "+06:00", "UTCDSTOffset": "+06:00" },
    { "code": "KZ", "latLon": "10234", "tz": "Asia/Oral", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "ID", "latLon": "-0002+10920", "tz": "Asia/Pontianak", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "KP", "latLon": "16446", "tz": "Asia/Pyongyang", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "QA", "latLon": "7649", "tz": "Asia/Qatar", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "KZ", "latLon": "10976", "tz": "Asia/Qyzylorda", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "SA", "latLon": "7081", "tz": "Asia/Riyadh", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "RU", "latLon": "18900", "tz": "Asia/Sakhalin", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "UZ", "latLon": "10588", "tz": "Asia/Samarkand", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "KR", "latLon": "16391", "tz": "Asia/Seoul", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "CN", "latLon": "15242", "tz": "Asia/Shanghai", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "SG", "latLon": "10468", "tz": "Asia/Singapore", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "RU", "latLon": "22071", "tz": "Asia/Srednekolymsk", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "TW", "latLon": "14633", "tz": "Asia/Taipei", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "UZ", "latLon": "11038", "tz": "Asia/Tashkent", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "GE", "latLon": "8592", "tz": "Asia/Tbilisi", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "IR", "latLon": "8666", "tz": "Asia/Tehran", "UTCOffset": "+03:30", "UTCDSTOffset": "+04:30" },
    { "code": "BT", "latLon": "11667", "tz": "Asia/Thimphu", "UTCOffset": "+06:00", "UTCDSTOffset": "+06:00" },
    { "code": "JP", "latLon": "1748357", "tz": "Asia/Tokyo", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "RU", "latLon": "14088", "tz": "Asia/Tomsk", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "MN", "latLon": "15408", "tz": "Asia/Ulaanbaatar", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "CN", "latLon": "13083", "tz": "Asia/Urumqi", "UTCOffset": "+06:00", "UTCDSTOffset": "+06:00" },
    { "code": "RU", "latLon": "2074673", "tz": "Asia/Ust-Nera", "UTCOffset": "+10:00", "UTCDSTOffset": "+10:00" },
    { "code": "RU", "latLon": "17466", "tz": "Asia/Vladivostok", "UTCOffset": "+10:00", "UTCDSTOffset": "+10:00" },
    { "code": "RU", "latLon": "19140", "tz": "Asia/Yakutsk", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "MM", "latLon": "11257", "tz": "Asia/Yangon", "UTCOffset": "+06:30", "UTCDSTOffset": "+06:30" },
    { "code": "RU", "latLon": "11687", "tz": "Asia/Yekaterinburg", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "AM", "latLon": "8441", "tz": "Asia/Yerevan", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "PT", "latLon": "+3744-02540", "tz": "Atlantic/Azores", "UTCOffset": "-01:00", "UTCDSTOffset": "+00:00" },
    { "code": "BM", "latLon": "+3217-06446", "tz": "Atlantic/Bermuda", "UTCOffset": "-04:00", "UTCDSTOffset": "-03:00" },
    { "code": "ES", "latLon": "+2806-01524", "tz": "Atlantic/Canary", "UTCOffset": "+00:00", "UTCDSTOffset": "+01:00" },
    { "code": "CV", "latLon": "+1455-02331", "tz": "Atlantic/Cape_Verde", "UTCOffset": "-01:00", "UTCDSTOffset": "-01:00" },
    { "code": "FO", "latLon": "+6201-00646", "tz": "Atlantic/Faroe", "UTCOffset": "+00:00", "UTCDSTOffset": "+01:00" },
    { "code": "PT", "latLon": "+3238-01654", "tz": "Atlantic/Madeira", "UTCOffset": "+00:00", "UTCDSTOffset": "+01:00" },
    { "code": "IS", "latLon": "+6409-02151", "tz": "Atlantic/Reykjavik", "UTCOffset": "+00:00", "UTCDSTOffset": "+00:00" },
    { "code": "GS", "latLon": "-5416-03632", "tz": "Atlantic/South_Georgia", "UTCOffset": "-02:00", "UTCDSTOffset": "-02:00" },
    { "code": "FK", "latLon": "-5142-05751", "tz": "Atlantic/Stanley", "UTCOffset": "-03:00", "UTCDSTOffset": "-03:00" },
    { "code": "AU", "latLon": "-3455+13835", "tz": "Australia/Adelaide", "UTCOffset": "+09:30", "UTCDSTOffset": "+10:30" },
    { "code": "AU", "latLon": "-2728+15302", "tz": "Australia/Brisbane", "UTCOffset": "+10:00", "UTCDSTOffset": "+10:00" },
    { "code": "AU", "latLon": "-3157+14127", "tz": "Australia/Broken_Hill", "UTCOffset": "+09:30", "UTCDSTOffset": "+10:30" },
    { "code": "AU", "latLon": "-3956+14352", "tz": "Australia/Currie", "UTCOffset": "+10:00", "UTCDSTOffset": "+11:00" },
    { "code": "AU", "latLon": "-1228+13050", "tz": "Australia/Darwin", "UTCOffset": "+09:30", "UTCDSTOffset": "+09:30" },
    { "code": "AU", "latLon": "-3143+12852", "tz": "Australia/Eucla", "UTCOffset": "+08:45", "UTCDSTOffset": "+08:45" },
    { "code": "AU", "latLon": "-4253+14719", "tz": "Australia/Hobart", "UTCOffset": "+10:00", "UTCDSTOffset": "+11:00" },
    { "code": "AU", "latLon": "-2016+14900", "tz": "Australia/Lindeman", "UTCOffset": "+10:00", "UTCDSTOffset": "+10:00" },
    { "code": "AU", "latLon": "-3133+15905", "tz": "Australia/Lord_Howe", "UTCOffset": "+10:30", "UTCDSTOffset": "+11:00" },
    { "code": "AU", "latLon": "-3749+14458", "tz": "Australia/Melbourne", "UTCOffset": "+10:00", "UTCDSTOffset": "+11:00" },
    { "code": "AU", "latLon": "-3157+11551", "tz": "Australia/Perth", "UTCOffset": "+08:00", "UTCDSTOffset": "+08:00" },
    { "code": "AU", "latLon": "-3352+15113", "tz": "Australia/Sydney", "UTCOffset": "+10:00", "UTCDSTOffset": "+11:00" },
    { "code": "NL", "latLon": "5676", "tz": "Europe/Amsterdam", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "AD", "latLon": "4361", "tz": "Europe/Andorra", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "RU", "latLon": "9424", "tz": "Europe/Astrakhan", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "GR", "latLon": "6101", "tz": "Europe/Athens", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "RS", "latLon": "6480", "tz": "Europe/Belgrade", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "DE", "latLon": "6552", "tz": "Europe/Berlin", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "BE", "latLon": "5470", "tz": "Europe/Brussels", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "RO", "latLon": "7032", "tz": "Europe/Bucharest", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "HU", "latLon": "6635", "tz": "Europe/Budapest", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "MD", "latLon": "7550", "tz": "Europe/Chisinau", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "DK", "latLon": "6775", "tz": "Europe/Copenhagen", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "IE", "latLon": "+5320-00615", "tz": "Europe/Dublin", "UTCOffset": "+00:00", "UTCDSTOffset": "+01:00" },
    { "code": "GI", "latLon": "+3608-00521", "tz": "Europe/Gibraltar", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "FI", "latLon": "8468", "tz": "Europe/Helsinki", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "TR", "latLon": "6959", "tz": "Europe/Istanbul", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "RU", "latLon": "7473", "tz": "Europe/Kaliningrad", "UTCOffset": "+02:00", "UTCDSTOffset": "+02:00" },
    { "code": "UA", "latLon": "8057", "tz": "Europe/Kiev", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "RU", "latLon": "10775", "tz": "Europe/Kirov", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "PT", "latLon": "+3843-00908", "tz": "Europe/Lisbon", "UTCOffset": "+00:00", "UTCDSTOffset": "+01:00" },
    { "code": "GB", "latLon": "+513030-0000731", "tz": "Europe/London", "UTCOffset": "+00:00", "UTCDSTOffset": "+01:00" },
    { "code": "LU", "latLon": "5545", "tz": "Europe/Luxembourg", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "ES", "latLon": "+4024-00341", "tz": "Europe/Madrid", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "MT", "latLon": "4985", "tz": "Europe/Malta", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "BY", "latLon": "8088", "tz": "Europe/Minsk", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "MC", "latLon": "5065", "tz": "Europe/Monaco", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "RU", "latLon": "928225", "tz": "Europe/Moscow", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "CY", "latLon": "6832", "tz": "Asia/Nicosia", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "NO", "latLon": "7000", "tz": "Europe/Oslo", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "FR", "latLon": "5072", "tz": "Europe/Paris", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "CZ", "latLon": "6431", "tz": "Europe/Prague", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "LV", "latLon": "8063", "tz": "Europe/Riga", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "IT", "latLon": "5383", "tz": "Europe/Rome", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "RU", "latLon": "10321", "tz": "Europe/Samara", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "RU", "latLon": "9736", "tz": "Europe/Saratov", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "UA", "latLon": "7863", "tz": "Europe/Simferopol", "UTCOffset": "+03:00", "UTCDSTOffset": "+03:00" },
    { "code": "BG", "latLon": "6560", "tz": "Europe/Sofia", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "SE", "latLon": "7723", "tz": "Europe/Stockholm", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "EE", "latLon": "8370", "tz": "Europe/Tallinn", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "AL", "latLon": "6070", "tz": "Europe/Tirane", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "RU", "latLon": "10244", "tz": "Europe/Ulyanovsk", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "UA", "latLon": "7055", "tz": "Europe/Uzhgorod", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "AT", "latLon": "6433", "tz": "Europe/Vienna", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "LT", "latLon": "7960", "tz": "Europe/Vilnius", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "RU", "latLon": "9269", "tz": "Europe/Volgograd", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "PL", "latLon": "7315", "tz": "Europe/Warsaw", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "UA", "latLon": "8260", "tz": "Europe/Zaporozhye", "UTCOffset": "+02:00", "UTCDSTOffset": "+03:00" },
    { "code": "CH", "latLon": "5555", "tz": "Europe/Zurich", "UTCOffset": "+01:00", "UTCDSTOffset": "+02:00" },
    { "code": "IO", "latLon": "-0720+07225", "tz": "Indian/Chagos", "UTCOffset": "+06:00", "UTCDSTOffset": "+06:00" },
    { "code": "CX", "latLon": "-1025+10543", "tz": "Indian/Christmas", "UTCOffset": "+07:00", "UTCDSTOffset": "+07:00" },
    { "code": "CC", "latLon": "-1210+09655", "tz": "Indian/Cocos", "UTCOffset": "+06:30", "UTCDSTOffset": "+06:30" },
    { "code": "TF", "latLon": "-492110+0701303", "tz": "Indian/Kerguelen", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "SC", "latLon": "-0440+05528", "tz": "Indian/Mahe", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "MV", "latLon": "7740", "tz": "Indian/Maldives", "UTCOffset": "+05:00", "UTCDSTOffset": "+05:00" },
    { "code": "MU", "latLon": "-2010+05730", "tz": "Indian/Mauritius", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "RE", "latLon": "-2052+05528", "tz": "Indian/Reunion", "UTCOffset": "+04:00", "UTCDSTOffset": "+04:00" },
    { "code": "WS", "latLon": "-1350-17144", "tz": "Pacific/Apia", "UTCOffset": "+13:00", "UTCDSTOffset": "+14:00" },
    { "code": "NZ", "latLon": "-3652+17446", "tz": "Pacific/Auckland", "UTCOffset": "+12:00", "UTCDSTOffset": "+13:00" },
    { "code": "PG", "latLon": "-0613+15534", "tz": "Pacific/Bougainville", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "NZ", "latLon": "-4357-17633", "tz": "Pacific/Chatham", "UTCOffset": "+12:45", "UTCDSTOffset": "+13:45" },
    { "code": "FM", "latLon": "15872", "tz": "Pacific/Chuuk", "UTCOffset": "+10:00", "UTCDSTOffset": "+10:00" },
    { "code": "CL", "latLon": "-2709-10926", "tz": "Pacific/Easter", "UTCOffset": "-06:00", "UTCDSTOffset": "-05:00" },
    { "code": "VU", "latLon": "-1740+16825", "tz": "Pacific/Efate", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "KI", "latLon": "-0308-17105", "tz": "Pacific/Enderbury", "UTCOffset": "+13:00", "UTCDSTOffset": "+13:00" },
    { "code": "TK", "latLon": "-0922-17114", "tz": "Pacific/Fakaofo", "UTCOffset": "+13:00", "UTCDSTOffset": "+13:00" },
    { "code": "FJ", "latLon": "-1808+17825", "tz": "Pacific/Fiji", "UTCOffset": "+12:00", "UTCDSTOffset": "+13:00" },
    { "code": "TV", "latLon": "-0831+17913", "tz": "Pacific/Funafuti", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
    { "code": "EC", "latLon": "-0054-08936", "tz": "Pacific/Galapagos", "UTCOffset": "-06:00", "UTCDSTOffset": "-06:00" },
    { "code": "PF", "latLon": "-2308-13457", "tz": "Pacific/Gambier", "UTCOffset": "-09:00", "UTCDSTOffset": "-09:00" },
    { "code": "SB", "latLon": "-0932+16012", "tz": "Pacific/Guadalcanal", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "GU", "latLon": "15773", "tz": "Pacific/Guam", "UTCOffset": "+10:00", "UTCDSTOffset": "+10:00" },
    { "code": "US", "latLon": "+211825-1575130", "tz": "Pacific/Honolulu", "UTCOffset": "-10:00", "UTCDSTOffset": "-10:00" },
    { "code": "KI", "latLon": "+0152-15720", "tz": "Pacific/Kiritimati", "UTCOffset": "+14:00", "UTCDSTOffset": "+14:00" },
    { "code": "FM", "latLon": "16778", "tz": "Pacific/Kosrae", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "MH", "latLon": "17625", "tz": "Pacific/Kwajalein", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
    { "code": "MH", "latLon": "17821", "tz": "Pacific/Majuro", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
    { "code": "PF", "latLon": "-0900-13930", "tz": "Pacific/Marquesas", "UTCOffset": "-09:30", "UTCDSTOffset": "-09:30" },
    { "code": "NR", "latLon": "-0031+16655", "tz": "Pacific/Nauru", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
    { "code": "NU", "latLon": "-1901-16955", "tz": "Pacific/Niue", "UTCOffset": "-11:00", "UTCDSTOffset": "-11:00" },
    { "code": "NF", "latLon": "-2903+16758", "tz": "Pacific/Norfolk", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "NC", "latLon": "-2216+16627", "tz": "Pacific/Noumea", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "AS", "latLon": "-1416-17042", "tz": "Pacific/Pago_Pago", "UTCOffset": "-11:00", "UTCDSTOffset": "-11:00" },
    { "code": "PW", "latLon": "14149", "tz": "Pacific/Palau", "UTCOffset": "+09:00", "UTCDSTOffset": "+09:00" },
    { "code": "PN", "latLon": "-2504-13005", "tz": "Pacific/Pitcairn", "UTCOffset": "-08:00", "UTCDSTOffset": "-08:00" },
    { "code": "FM", "latLon": "16471", "tz": "Pacific/Pohnpei", "UTCOffset": "+11:00", "UTCDSTOffset": "+11:00" },
    { "code": "PG", "latLon": "-0930+14710", "tz": "Pacific/Port_Moresby", "UTCOffset": "+10:00", "UTCDSTOffset": "+10:00" },
    { "code": "CK", "latLon": "-2114-15946", "tz": "Pacific/Rarotonga", "UTCOffset": "-10:00", "UTCDSTOffset": "-10:00" },
    { "code": "PF", "latLon": "-1732-14934", "tz": "Pacific/Tahiti", "UTCOffset": "-10:00", "UTCDSTOffset": "-10:00" },
    { "code": "KI", "latLon": "17425", "tz": "Pacific/Tarawa", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
    { "code": "TO", "latLon": "-2110-17510", "tz": "Pacific/Tongatapu", "UTCOffset": "+13:00", "UTCDSTOffset": "+14:00" },
    { "code": "UM", "latLon": "18554", "tz": "Pacific/Wake", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
    { "code": "WF", "latLon": "-1318-17610", "tz": "Pacific/Wallis", "UTCOffset": "+12:00", "UTCDSTOffset": "+12:00" },
];
