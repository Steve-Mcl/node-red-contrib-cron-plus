node-red-contrib-cron-plus
============================
_A flexible timer/scheduler (cron, solar events, lunar events, simple dates) node for Node-RED with full dynamic control and time zone support_


QUICK DEMO...
-------------
![cron-demo](https://user-images.githubusercontent.com/44235289/84031306-592fa900-a98d-11ea-9e93-c074473aa0c8.gif)


FEATURES
--------
* Schedule by CRON, date sequences, solar events and lunar events (with offset) 
  * A human readable description of your expression is provided as you type.
  * ![cron-tt](https://user-images.githubusercontent.com/44235289/84030877-afe8b300-a98c-11ea-8a77-be84d840bf5d.gif)
  * An Easy Expression Builder to aid cron novices
  * ![easy-expr-builder](https://user-images.githubusercontent.com/44235289/90957177-296c4980-e484-11ea-9705-9a7faf90b5f0.gif)
* Multiple schedules can be entered by the node editor UI or dynamically at runtime
* Send a default payload or any of the following: timestamp, string, number, boolean, flow variable, global variable, JSON, JSONata, Buffer or Env variable as the output.
* Example CRON expressions provided in the dropdown to get you started
* Map popup to help you enter coordinates for solar events
  * Location coordinates can be per schedule, per cron node or set by an environment variable (as of V2.0.0)
  * NOTE: Map is 100% CDN dynamic and requires and internet connection. If there is no internet, the popup will provide information to help you get location coordinates from another source
  * ![cron-plus-map](https://user-images.githubusercontent.com/44235289/84031948-79ac3300-a98e-11ea-966c-b77200515030.gif)
* Option to separate command responses from output 1 to separate 2nd output
* Fan out option to separate each static schedule to its own output (dynamic and command responses are sent on last 2 output pins) (as of V1.4.0)
* Settable output variable (normally `msg.payload` but it is up to you)
* Inject-like button to fire the node (available when only one schedule is added) 
* View dynamically created schedules in the node editor UI (updated in V2.0.0)
* Additional info about the triggered schedule is always sent in the output message in `msg.cronplus` 
  * NOTE: if the payload is to "Default Payload", then the content of `msg.cronplus` is moved to `msg.payload`
* Node status updates to show the next event
  * NOTE: the status indicator will be shown as a "ring" for dynamic schedules or shown as a "dot" for static schedules
* Full flexibility & dynamic control. 
  * Ability to control via simple topic commands. Examples include...
    * remove, remove-all, remove-all-dynamic, remove-all-static, remove-active, remove-active-dynamic, remove-active-static, remove-inactive, remove-inactive-dynamic, remove-inactive-static
    * export, export-all, export-all-dynamic, export-all-static, export-active, export-active-dynamic, export-active-static, export-inactive, export-inactive-dynamic, export-inactive-static
    * list, list-all, list-all-dynamic, list-all-static, list-active, list-active-dynamic, list-active-static, list-inactive, list-inactive-dynamic, list-inactive-static
    * status, status-all, status-all-dynamic, status-all-static, status-active, status-active-dynamic, status-active-static, status-inactive, status-inactive-dynamic, status-inactive-static
      * status is an alias for list
    * stop, stop-all, stop-all-dynamic, stop-all-static
    * start, start-all, start-all-dynamic, start-all-static
    * pause, pause-all, pause-all-dynamic, pause-all-static
    * next (as of v2.0.0)
  * Ability to add, remove, list, export, stop, start, pause schedules by a command payload input. Examples include...
    * add - add one or more dynamic schedules
    * describe - describe solar events or cron expression (without the need to add a schedule)
      * useful for creating a [dynamic dashboard like this](https://flows.nodered.org/flow/79a66966a6cc655a827872a4af794b94)
* Persist schedules and state
  * In local file system (default)
  * In memory or persistent context (as of V2.0.0)
  * Persist state of schedules (as of V2.0.0) (i.e. if a schedule is paused, it will remain paused after a restart)
* Recognises system clock changes and recalculates schedules
  * change detection can now be customised by adding an entry in `settings.js` or an environment variable named `CRONPLUS_MAX_CLOCK_DIFF` (as of V2.0.0)
* Demo flows demonstrating many of the capabilities. Import via node-red menu > import > examples.
* Optional time zone setting supporting UTC and Region/Area (e.g. Europe/London)
* Daylight Saving Time transitions are handled following the same conventions as Debian cron (see below)

Lunar events
------------

Schedules can fire on moon events at a location, alongside the existing solar events:

| Event ID | Event | Information |
|----------|-------|-------------|
| `rise` | moon rise | the moon rises above the horizon |
| `set` | moon set | the moon sets below the horizon |
| `highest` | lunar transit | the moon is at its highest position |

A lunar schedule takes the same shape as a solar one, using `expressionType: "lunar"` with `lunarType` (`"all"` or `"selected"`) and `lunarEvents` (a CSV or array of the event IDs above), plus the usual `location` and optional `offset` (minutes). For example, adding one dynamically:

```json
{
    "command": "add",
    "name": "moonwatch",
    "topic": "moonwatch",
    "expressionType": "lunar",
    "lunarType": "selected",
    "lunarEvents": "rise,set",
    "location": "54.9992500,-1.4170300"
}
```

> [!NOTE]
> Lunar schedules are currently created dynamically (via the `add` command) or by importing flow JSON - the node's editor UI does not offer them yet.

> [!TIP]
> At high latitudes the moon can stay above or below the horizon for days at a time. During such periods `rise`/`set` events simply do not occur and the schedule waits for the next real occurrence.

Daylight Saving Time (DST) handling
-----------------------------------

When a schedule runs in a time zone that observes DST (either the node's time zone setting or the system time zone), cron-plus follows the same conventions as [Debian cron](https://blog.healthchecks.io/2021/10/how-debian-cron-handles-dst-transitions/):

* A schedule is a **wildcard job** when its minute or hour field starts with `*` (e.g. `0,15,30,45 * * * * * *` "every 15 seconds", or `0 * 1 * * *` "every minute during the 1am hour"). Wildcard jobs maintain their real-time interval across a DST transition:
  * when clocks go back, they also run during the repeated hour
  * when clocks go forward, they continue at the next real-time slot
* A schedule is a **fixed-time job** when both its minute and hour fields are specific (e.g. `0 30 1 * * *` "01:30 every day"). Fixed-time jobs:
  * run only once when clocks go back and their scheduled time occurs twice
  * run as soon as possible after the transition when clocks go forward and their scheduled time is skipped

> [!TIP]
> schedules using the `UTC` time zone (or any time zone without DST) are unaffected by DST transitions.

Install
-------

* Easiest...

  Use the Manage Palette > Install option from the menu inside node-red

* Harder...

  Alternatively in your Node-RED user directory, typically ~/.node-red, run
Run the following command in the root directory of your Node-RED install.
(Usually this is `~/.node-red` or `%userprofile%\.node-red`).

  Install from NPM 

      npm install node-red-contrib-cron-plus

  Install from GIT

      npm install Steve-Mcl/node-red-contrib-cron-plus

  Alternatively, install from a folder

      npm install c:/tempfolder/node-red-contrib-cron-plus


  Or simply copy the folder `node-red-contrib-cron-plus` into a folder named `nodes` inside your node-red folder then `cd` into `nodes/node-red-contrib-cron-plus` and execute `npm install`

Troubleshooting
---------------

### "Invalid store name specified 'xxx' - state will not be persisted for this node"

The node's **Save State** setting names a node context store that the node-red runtime does not recognise. Context stores are defined in the `contextStorage` section of your node-red settings file (typically `~/.node-red/settings.js`) and the store selected in the node may have been removed or renamed there.

To fix, either select a different **Save State** option in the node's settings, or define the store in your settings file and restart node-red, e.g.:

```javascript
contextStorage: {
    default: {
        module: "localfilesystem"
    },
},
```

> [!NOTE]
> on a default node-red installation (no `contextStorage` configured), the only context store is the built-in `memory` store. State saved there survives re-deploys but **not** node-red restarts - choose the **File** option (or configure a `localfilesystem` context store) if state must survive a restart.

Context storage is pluggable: besides the built-in `memory` and `localfilesystem` modules, installable plugins provide stores backed by other technologies (e.g. [Redis](https://github.com/node-red/node-red-context-redis), SQLite, PostgreSQL, MySQL/MariaDB), and some platforms (e.g. FlowFuse) provide a persistent context store out of the box. Any store configured in `contextStorage` (or provided by your platform) can be selected in the node's **Save State** setting. See the [node-red context documentation](https://nodered.org/docs/user-guide/context) for details.

Acknowledgements
---------------
* Inspired by [node-red-contrib-cron](https://github.com/chameleonbr/node-red-contrib-cron)
* Cron expression builder adapted for cron-plus from https://github.com/juliacscai/jquery-cron-quartz (not on NPM)
* Big thanks for continued support by [@jaclark](https://github.com/jaclarke) for the excellent [cronosjs](https://github.com/jaclarke/cronosjs)

Dependencies
------------
* [cronosjs](https://github.com/jaclarke/cronosjs)
* [cronstrue](https://github.com/bradymholt/cRonstrue) 
* [pretty-ms](https://github.com/sindresorhus/pretty-ms)
* [suncalc3](https://github.com/hypnos3/suncalc3)
* [coord-parser](https://github.com/naturalatlas/coord-parser)

Development
-----------

* Fork the repo
* Clone your fork locally and `cd` into the project folder
* Run `npm install` to install dependencies
* Run `npm run lint` to check code style
* Run `npm run lint:fix` to fix code style issues
* Run `npm test` to run tests
