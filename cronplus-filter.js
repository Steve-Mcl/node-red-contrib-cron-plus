/* cronplus-filter ("Cron Filter") - gate messages on a free-text temporal
   condition ("on saturdays", "when the moon is visible", "weekdays between
   9am and 5pm"). Output 1 = allowed, output 2 = blocked.
   Parsing lives in resources/filter-lang.js (shared with the editor for the
   live "parsed understanding" preview); evaluation in lib/filter-eval.js. */

module.exports = function (RED) {
    'use strict'
    const coordParser = require('coord-parser')
    // the published package ships only the minified parser build; a source
    // checkout (dev) has the readable file and must prefer it (never stale)
    let filterLang
    try {
        filterLang = require('./resources/filter-lang.js')
    } catch (_e) {
        filterLang = require('./resources/filter-lang.min.js')
    }
    const filterEval = require('./lib/filter-eval.js')

    function evaluateNodeProperty (value, type, node, msg) {
        return new Promise(function (resolve, reject) {
            RED.util.evaluateNodeProperty(value, type, node, msg, function (err, result) {
                if (err) {
                    reject(err)
                } else {
                    resolve(result)
                }
            })
        })
    }

    // a cronplus output object, whether at msg.cronplus or moved to the output
    // field (msg.payload) by payloadType 'default'
    function looksLikeCronplusData (value) {
        return !!value && typeof value === 'object' &&
            ('triggerTimestamp' in value) && typeof value.config === 'object'
    }

    function normaliseTs (value) {
        if (value instanceof Date) { return value.valueOf() }
        if (typeof value === 'number' && isFinite(value)) { return value }
        if (typeof value === 'string') { return Date.parse(value) }
        return NaN
    }

    // compact "until" stamp for the status: same local day -> "18:45",
    // within a week -> "Sun 16:00", further out -> "25 Dec 16:00"
    function fmtUntil (ts, tz, nowTs) {
        try {
            const tzOpt = { timeZone: tz || undefined }
            const time = new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined })
            const dayKey = function (t) { return new Date(t).toLocaleDateString('en-GB', tzOpt) }
            if (dayKey(ts) === dayKey(nowTs)) { return time }
            if (ts - nowTs < 7 * 86400000) {
                return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', timeZone: tz || undefined }) + ' ' + time
            }
            return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz || undefined }) + ' ' + time
        } catch (_e) {
            return new Date(ts).toISOString()
        }
    }

    function parseLocation (value) {
        if (value && typeof value === 'object') {
            const lat = Number(value.lat)
            const lon = Number(value.lon !== undefined ? value.lon : value.lng)
            if (isFinite(lat) && isFinite(lon)) { return { lat, lon } }
            throw new Error('location object must have numeric lat and lon properties')
        }
        return coordParser(String(value)) // throws on unparseable input
    }

    function CronPlusFilterNode (config) {
        RED.nodes.createNode(this, config)
        const node = this
        node.condition = config.condition || ''
        node.conditionType = config.conditionType || 'str'
        node.location = config.location || ''
        node.locationType = config.locationType || 'none'
        node.timeZone = config.timeZone || ''

        // condition text can vary per message (msg./env types) - cache the last
        // parse so identical text (the overwhelmingly common case) parses once
        const parseCache = { text: null, parsed: null, needsLocation: false }
        function getParsed (text) {
            text = String(text === undefined || text === null ? '' : text)
            if (parseCache.text !== text) {
                parseCache.text = text
                parseCache.parsed = filterLang.parse(text)
                parseCache.needsLocation = parseCache.parsed.ok ? filterLang.requiresLocation(parseCache.parsed.ast) : false
            }
            return parseCache.parsed
        }

        // The status always reflects NOW (never a message's own timestamp): the
        // current decision plus when it next flips ("allow until 17:00"). It is
        // set at deploy time and a timer re-arms it at each flip; messages only
        // refresh the context (condition text and location) it evaluates with.
        const MAX_TIMER_MS = 0x7FFFFFFE // setTimeout clamp (~24.8 days)
        const statusContext = { parsed: null, lat: undefined, lon: undefined, ready: false }
        let statusTimer = null
        function refreshStatus () {
            if (statusTimer) {
                clearTimeout(statusTimer)
                statusTimer = null
            }
            if (!statusContext.ready) { return }
            try {
                const tz = node.timeZone || undefined
                const now = Date.now()
                const ast = statusContext.parsed.ast
                const opts = { ts: now, lat: statusContext.lat, lon: statusContext.lon, tz }
                const pass = filterEval.evaluate(ast, opts).pass
                const scan = filterEval.findWindows(ast, Object.assign({ maxWindows: 1, budgetMs: 100 }, opts))
                const win = scan.windows[0]
                let until = null
                if (pass) {
                    if (win && win.start <= now) { until = win.end } // end of the window we are inside
                } else if (win) {
                    until = win.start // the next allowed window
                }
                const text = (pass ? 'allow' : 'deny') + (until ? ' until ' + fmtUntil(until, tz, now) : '')
                node.status({ fill: pass ? 'green' : 'grey', shape: pass ? 'dot' : 'ring', text })
                // re-arm at the flip; when no flip is known, re-check occasionally
                // (hourly when the scan hit its budget, else daily as a heartbeat)
                let delay = until ? Math.max(1000, until - now + 500) : (scan.truncated ? 3600000 : 86400000)
                if (delay > MAX_TIMER_MS) { delay = MAX_TIMER_MS }
                statusTimer = setTimeout(refreshStatus, delay)
                if (statusTimer.unref) { statusTimer.unref() }
            } catch (_e) { /* the status is cosmetic - never let it break the node */ }
        }
        node.on('close', function () {
            if (statusTimer) {
                clearTimeout(statusTimer)
                statusTimer = null
            }
        })

        // resolve what we can at deploy time so the status shows without traffic
        if (node.conditionType === 'msg') {
            node.status({ fill: 'grey', shape: 'ring', text: 'waiting for message' })
        } else {
            (async function initStatus () {
                let conditionText = node.condition
                try {
                    if (node.conditionType === 'env') {
                        conditionText = await evaluateNodeProperty(node.condition, 'env', node, null)
                    }
                } catch (_e) { conditionText = '' }
                const parsed = getParsed(conditionText)
                if (!parsed.ok) {
                    node.status({ fill: 'red', shape: 'dot', text: 'invalid condition' })
                    node.error(`Cannot understand condition "${parseCache.text}". ${parsed.suggestion}`)
                    return
                }
                statusContext.parsed = parsed
                if (node.locationType === 'fixed' || node.locationType === 'env') {
                    try {
                        const value = await evaluateNodeProperty(node.location, node.locationType === 'env' ? 'env' : 'str', node, null)
                        if (value) {
                            const pos = parseLocation(value)
                            statusContext.lat = pos.lat
                            statusContext.lon = pos.lon
                        }
                    } catch (_e) { /* leave location unset */ }
                }
                if (parseCache.needsLocation && statusContext.lat === undefined) {
                    // the location may arrive on messages - say so instead of guessing
                    node.status({ fill: 'grey', shape: 'ring', text: 'no location (waiting for message)' })
                    return
                }
                statusContext.ready = true
                refreshStatus()
            })()
        }

        node.on('input', async function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments) }
            done = done || function (err) { if (err) { node.error(err, msg) } }
            try {
                // resolve the condition text: fixed string, env var, or msg property
                let conditionText = node.condition
                if (node.conditionType === 'env') {
                    conditionText = await evaluateNodeProperty(node.condition, 'env', node, msg)
                } else if (node.conditionType === 'msg') {
                    conditionText = RED.util.getMessageProperty(msg, node.condition)
                }
                const parsed = getParsed(conditionText)
                if (!parsed.ok) {
                    node.status({ fill: 'red', shape: 'dot', text: 'invalid condition' })
                    throw new Error(`Cannot understand condition "${parseCache.text}". ${parsed.suggestion}`)
                }
                const cronplusData = looksLikeCronplusData(msg.cronplus)
                    ? msg.cronplus
                    : (looksLikeCronplusData(msg.payload) ? msg.payload : null)

                // timestamp precedence: msg.ts -> cronplus trigger time -> now
                let ts
                if (msg.ts !== undefined && msg.ts !== null && msg.ts !== '') {
                    ts = normaliseTs(msg.ts)
                    if (isNaN(ts)) {
                        throw new Error('msg.ts is not a valid timestamp (epoch ms, ISO string or Date)')
                    }
                } else if (cronplusData && cronplusData.triggerTimestamp) {
                    ts = normaliseTs(cronplusData.triggerTimestamp)
                }
                if (ts === undefined || isNaN(ts)) { ts = Date.now() }

                // location precedence: msg.location -> cronplus schedule location -> node config
                let lat, lon
                if (msg.location) {
                    ({ lat, lon } = parseLocation(msg.location))
                } else if (cronplusData && cronplusData.config && cronplusData.config.location) {
                    ({ lat, lon } = parseLocation(cronplusData.config.location))
                } else if (node.locationType === 'fixed' || node.locationType === 'env') {
                    const value = await evaluateNodeProperty(node.location, node.locationType === 'env' ? 'env' : 'str', node, msg)
                    if (value) {
                        ({ lat, lon } = parseLocation(value))
                    }
                }

                if (parseCache.needsLocation && (lat === undefined || lon === undefined)) {
                    node.status({ fill: 'yellow', shape: 'ring', text: 'location required' })
                    throw new Error('Condition needs a location: set one on the node or send msg.location (or wire from a cronplus solar/lunar schedule)')
                }

                const result = filterEval.evaluate(parsed.ast, { ts, lat, lon, tz: node.timeZone || undefined })
                msg.filter = {
                    pass: result.pass,
                    condition: parseCache.text,
                    description: parsed.description,
                    ts,
                    reasons: result.reasons
                }
                // keep the live status context fresh with what this message taught
                // us (per-message condition, msg-borne location), then re-render it
                // for NOW - the message's own timestamp never drives the status
                statusContext.parsed = parsed
                if (lat !== undefined) {
                    statusContext.lat = lat
                    statusContext.lon = lon
                }
                statusContext.ready = !parseCache.needsLocation || statusContext.lat !== undefined
                refreshStatus()
                if (result.pass) {
                    send([msg, null])
                } else {
                    send([null, msg])
                }
                done()
            } catch (err) {
                done(err) // catchable; message is not forwarded on either output
            }
        })
    }

    RED.nodes.registerType('cronplus-filter', CronPlusFilterNode)

    // Editor support: the details popout asks for upcoming allowed windows.
    // The parse itself is client-side; this endpoint exists because evaluation
    // (suncalc, timezone maths) lives in the runtime.
    RED.httpAdmin.post('/cronplus-filter/:id/preview', RED.auth.needsPermission('cronplus-filter.read'), async function (req, res) {
        try {
            const body = req.body || {}
            // the node may not be deployed yet - evaluate env vars without it
            const previewNode = RED.nodes.getNode(req.params.id) || null
            let conditionText = body.condition || ''
            if (body.conditionType === 'msg') {
                res.json({ error: 'the condition comes from the message at runtime - no preview available' })
                return
            }
            if (body.conditionType === 'env') {
                conditionText = await evaluateNodeProperty(body.condition, 'env', previewNode, null)
            }
            const parsed = filterLang.parse(conditionText || '')
            if (!parsed.ok) {
                res.json({ error: body.conditionType === 'env' ? `invalid condition from env var "${body.condition}"` : 'invalid condition' })
                return
            }
            let lat, lon
            if (body.locationType === 'fixed' || body.locationType === 'env') {
                const value = await evaluateNodeProperty(body.location, body.locationType === 'env' ? 'env' : 'str', previewNode, null)
                if (value) {
                    try {
                        ({ lat, lon } = parseLocation(value))
                    } catch (_e) { /* fall through to the location check below */ }
                }
            }
            if (filterLang.requiresLocation(parsed.ast) && (lat === undefined || lon === undefined)) {
                res.json({ error: 'location required', needsLocation: true })
                return
            }
            const tz = body.timeZone || undefined
            const now = Date.now()
            // user-initiated and infrequent - worth a bigger scan budget than the status
            const result = filterEval.findWindows(parsed.ast, { ts: now, lat, lon, tz, budgetMs: 1500 })
            result.now = filterEval.evaluate(parsed.ast, { ts: now, lat, lon, tz }).pass
            // for env conditions the editor cannot parse client-side - hand it
            // the description and breakdown too
            result.condition = conditionText
            result.description = parsed.description
            result.summary = filterLang.summarize(parsed.ast)
            res.json(result)
        } catch (err) {
            res.status(500).json({ error: err.message })
        }
    })
}
