/* Shared editor-side location (map) picker for node-red-contrib-cron-plus.
   Loaded on demand via $.getScript('resources/node-red-contrib-cron-plus/location-picker.js')
   by cronplus.html and cronplus-when-gate.html, then used as:
       window.cronplusLocationPicker.showMap($input)   // $input: plain input or typedInput
   The dialog markup is appended to document.body (not a node template) because node
   templates only exist in the DOM while that node's edit dialog is open, and the picker
   must be usable from more than one node type. */
/* global RED, jQuery, cartodb */
(function ($) {
    'use strict'
    if (window.cronplusLocationPicker) { return }

    let map, mapPopup, selectedLocation, selectedLocationInput
    let dialogReady = false
    const filesAdded = [] // list of files already added

    const DIALOG_CSS = `
        #cron-plus-map-dialog .leaflet-popup-content-wrapper,
        #cron-plus-map-dialog .leaflet-popup-tip {
            background-color: var(--red-ui-primary-background);
            color: var(--red-ui-primary-text-color);
        }
        #cron-plus-map-dialog a.leaflet-control-zoom-in,
        #cron-plus-map-dialog a.leaflet-control-zoom-out {
            background-color: var(--red-ui-primary-background);
            color: var(--red-ui-primary-text-color);
        }
        #cron-plus-map {
            height: 100%;
            padding: 0;
            margin: 0;
        }
        .cron-plus-map-dialog-content {
            padding: 0px 0px 0px 0px;
        }
        .cron-plus-map-not-loaded {
            padding: 2px 10px 2px 10px;
        }
        .cron-plus-map-loading {
            padding: 2px 10px 2px 10px;
        }
    `

    const COORD_HELP_HTML = `
        <h4>Alternative ways to get coordinates...</h4>
        <ul>
            <li>Visit <a href="https://www.latlong.net/" target="_blank" rel="noopener noreferrer">www.latlong.net</a> (on another device if required) then copy the "Lat Long" value provided into the cron-plus coordinates box</li>
            <li>Visit google maps, MSN maps, almost any other maps website on another device to get GPS or longitude latitude value</li>
            <li>Try one of the many longitude latitude apps available in the app store on your mobile phone</li>
            <li>Check your satnav device - it may show coordinates</li>
            <li>Use a topographic map</li>
            <li>Ask a friend</li>
        </ul>
        <h4>Accepted formats...</h4>
        <ul>
            <li>Decimal Degrees E.g: <code>54.9992500,-1.4170300</code> or <code>54.9992500&deg; N 1.4170300&deg; W</code></li>
            <li>Degrees Minutes Seconds E.g: <code>54&deg; 59' 57.3'' N 1&deg; 25' 1.308'' W</code></li>
            <li>Decimal Minutes E.g: <code>54&deg; 59.955' , -1&deg; 25.0218'</code></li>
            <li>GPS E.g: <code>N54&deg;59'57.3, W1&deg;25'1.308"</code>, <code>54&deg;59'57.3"N, 1&deg;25'1.308"W</code>, <code>54d 59' 57" N 1d 25' 1" W</code> or <code>54:59:57.3N 1:25:1.308W</code></li>
        </ul>
    `

    const DIALOG_HTML = `
        <div id="cron-plus-map-dialog" style="display: none;" title="Choose location...">
            <div class="cron-plus-map-loading" >
                <h3>Attempting to load map... <i class="fa fa-spinner fa-spin" style="font-size:24px"></i></h3>
                <p>The interactive Map is loaded via CDN at client side (to minimise installation size) and therefore requires an internet connection. Please wait 1 moment.</p>
                ${COORD_HELP_HTML}
            </div>
            <div class="cron-plus-map-not-loaded" style="display:hidden" >
                <h3>No internet on this device?</h3>
                <p>The interactive Map is loaded via CDN at client side (to minimise installation size) and therefore requires an internet connection. As you are seeing this message, it is likely this device does not have access to the internet.</p>
                ${COORD_HELP_HTML}
            </div>
            <div id="cron-plus-map"></div>
        </div>
    `

    function checkLoadJsCssFile (filename, filetype, callback) {
        if (filesAdded.indexOf(filename) === -1) {
            loadJsCssFile(filename, filetype, function () {
                filesAdded.push(filename)
                if (callback) callback()
            })
        } else {
            if (callback) callback()
        }
    }

    function loadJsCssFile (filename, filetype, callback) {
        let fileRef
        if (filetype === 'js') { // if filename is a external JavaScript file
            fileRef = document.createElement('script')
            fileRef.setAttribute('type', 'text/javascript')
            fileRef.setAttribute('src', filename)
        } else if (filetype === 'css') { // if filename is an external CSS file
            fileRef = document.createElement('link')
            fileRef.setAttribute('rel', 'stylesheet')
            fileRef.setAttribute('type', 'text/css')
            fileRef.setAttribute('href', filename)
        }
        if (typeof fileRef !== 'undefined') { document.getElementsByTagName('head')[0].appendChild(fileRef) }

        fileRef.onload = function () {
            if (callback) callback()
        }
    }

    function safeFloat (value, def) {
        if ((undefined === value) || (value === null)) {
            return def || 0.0
        }
        try {
            value = parseFloat(value)
        } catch (_e) {
            value = def || 0.0
        }
        if (isNaN(value)) {
            return def || 0.0
        }
        return value
    }

    const getIdealDialogHeight = function () {
        return Math.min(800, ($(document).height() < 600) ? $(document).height() - 30 : $(document).height() - 100)
    }

    function ensureDialog () {
        if (dialogReady) { return }
        $('<style>').text(DIALOG_CSS).appendTo('head')
        $(DIALOG_HTML).appendTo('body')
        // create map popup dialog
        $('#cron-plus-map-dialog').dialog({
            classes: {
                'ui-dialog-content': 'cron-plus-map-dialog-content'
            },
            autoOpen: false,
            height: getIdealDialogHeight(),
            width: '75%',
            minWidth: 300,
            maxWidth: 1000,
            modal: true,
            buttons: {
                Cancel: function () {
                    $('#cron-plus-map-dialog').dialog('close')
                },
                OK: function () {
                    $('#cron-plus-map-dialog').dialog('close')
                    if (selectedLocation && selectedLocationInput) {
                        if (selectedLocationInput.typedInput('instance')) {
                            selectedLocationInput.typedInput('value', selectedLocation.lat + ' ' + selectedLocation.lng)
                        } else {
                            selectedLocationInput.val(selectedLocation.lat + ' ' + selectedLocation.lng)
                        }
                        selectedLocationInput.focus()
                        // if selectedLocationInput is a typedInput, trigger focus on that
                        if (selectedLocationInput.typedInput('instance')) {
                            selectedLocationInput.typedInput('focus')
                        }
                        selectedLocationInput.change()
                    }
                }
            },
            show: {
                effect: 'blind',
                duration: 500
            },
            open: function (_event) {
                $(this).css('padding', '0px 0px 0px 0px')
                $('.ui-dialog-buttonpane').find('button:contains("OK")').addClass('primary')
                $('#cron-plus-map-dialog').dialog('option', 'height', getIdealDialogHeight())
                $('#cron-plus-map-dialog').dialog('option', 'position', { my: 'center', at: 'center', of: window })
            },
            hide: {
                effect: 'explode',
                duration: 500
            },
            close: function (_event, _ui) {
                if (RED._cron_plus_debug) console.debug('destroying map')
                if (map) map.remove()
            }
        })
        dialogReady = true
    }

    function createMap (srcInput) {
        if (RED._cron_plus_debug) {
            console.debug('createMap', srcInput)
        }
        $('.cron-plus-map-loading').hide()
        if (!window.L || navigator.onLine === false) {
            $('.cron-plus-map-not-loaded').show()
            $('#cron-plus-map').hide()
            return
        }
        $('#cron-plus-map').show()
        $('.cron-plus-map-not-loaded').hide()
        let lat, lon
        selectedLocationInput = srcInput
        function getInputValue () {
            if (selectedLocationInput.typedInput('instance')) {
                return selectedLocationInput.typedInput('value')
            }
            return selectedLocationInput.val()
        }
        const latlon = getInputValue()
        if (latlon && typeof latlon === 'string') {
            let splitChar = ' '
            if (latlon.includes(',')) splitChar = ','
            const arrLatlon = latlon.split(splitChar)
            if (arrLatlon.length >= 2) {
                lat = arrLatlon[0]
                lon = arrLatlon[1]
            }
        }
        if (RED._cron_plus_debug) console.debug('createMap', lat, lon)
        let zoom = 3// by default, zoomed out
        let showPopupOnOpen = false
        if (lat && lon) {
            showPopupOnOpen = true
            zoom = 5// if location is set, zoom in a bit
        }
        lat = safeFloat(lat, 50.0)
        lon = safeFloat(lon, 0.0)
        if (RED._cron_plus_debug) console.debug('lat/lon', lat, lon)
        selectedLocation = window.L.latLng(lat, lon)
        if (RED._cron_plus_debug) console.debug('selectedLocation', selectedLocation.lat, selectedLocation.lng)

        // create leaflet map
        map = window.L.map('cron-plus-map', {
            zoomControl: true,
            center: selectedLocation,
            zoom
        })
        mapPopup = window.L.popup()

        map.on('click', function (e) {
            if (RED._cron_plus_debug) console.debug(e)
            const normaliseLat = function (x) {
                while (x > 90.0 || x < -90.0) {
                    if (x > 90.0) { x = -(90.0 - (x - 90)) }
                    if (x < -90.0) { x = (90.0 - ((-x) - 90)) }
                }
                return x
            }
            const normaliseLng = function (x) {
                while (x > 180.0 || x < -180.0) {
                    if (x > 180.0) { x = -(180.0 - (x - 180)) }
                    if (x < -180.0) { x = (180.0 - ((-x) - 180)) }
                }
                return x
            }
            selectedLocation = {}
            selectedLocation.lat = normaliseLat(e.latlng.lat)
            selectedLocation.lng = normaliseLng(e.latlng.lng)
            const content =
            '<div><span>Lat:</span> <span>' + selectedLocation.lat + '</span></div>' +
                '<div><span>Lon:</span> <span>' + selectedLocation.lng + '</span></div>'
            showMapPopup(content, e.latlng.lat, e.latlng.lng, map)
        })

        function showMapPopup (content, lat, lon, map) {
            mapPopup
                .setLatLng([lat, lon])
                .setContent(content)
                .openOn(map)
        }

        // add a base layer
        const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        const layer = window.L.tileLayer(tileUrl, {})
        layer.addTo(map)
        // add cartodb layer with one sublayer
        cartodb.createLayer(map, {
            user_name: 'node-red',
            type: 'namedmap',
            options: {
                named_map: {
                    name: 'node-red@cronplus',
                    params: {
                        color: '#5CA2D1'
                    },
                    layers: [{}]
                }
            }
        })
            .addTo(map)
            .done(function (layer) {
                layer.setInteraction(true)
                if (showPopupOnOpen) {
                    const content =
                        '<div><span>Lat:</span> <span>' + selectedLocation.lat + '</span></div>' +
                        '<div><span>Lon:</span> <span>' + selectedLocation.lng + '</span></div>'
                    showMapPopup(content, selectedLocation.lat, selectedLocation.lng, map)
                }

                layer.on('featureClick', function (e, latlng, pos, data, _layer) {
                    if (RED._cron_plus_debug) console.debug('click', latlng, data)
                })
                $('#cron-plus-map-dialog').dialog('option', 'position', { my: 'center', at: 'center', of: window })
            })
    }

    function showMap (srcInput) {
        ensureDialog()
        $('#cron-plus-map-dialog').dialog('open')
        if (navigator.onLine === true) {
            $('.cron-plus-map-not-loaded').show()
            $('.cron-plus-map-loading').hide()
            $('#cron-plus-map').hide()
            const proto = window.location.protocol === 'https:' ? 'https:' : 'http:'
            checkLoadJsCssFile(proto + '//libs.cartocdn.com/cartodb.js/v3/3.15/themes/css/cartodb.css', 'css', function () {
                checkLoadJsCssFile(proto + '//libs.cartocdn.com/cartodb.js/v3/3.15/cartodb.uncompressed.js', 'js', function () {
                    createMap(srcInput)
                })
            })
        } else {
            $('.cron-plus-map-not-loaded').show()
            $('.cron-plus-map-loading').hide()
            $('#cron-plus-map').hide()
        }
    }

    window.cronplusLocationPicker = {
        showMap
    }
})(jQuery)
