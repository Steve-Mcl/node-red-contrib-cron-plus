node-red-contrib-cron-plus
============================
_A flexible scheduler (cron, solar events, datetime) node for Node-RED with full dynamic control and Timezone support_


QUICK DEMO...
-------------
![cron-demo](https://user-images.githubusercontent.com/44235289/84031306-592fa900-a98d-11ea-9e93-c074473aa0c8.gif)


FEATURES
--------
* Schedule by CRON, date sequences and solar events (with offset) 
  * Human readable descriptions of your CRON expression are provided as you type.
  * ![cron-tt](https://user-images.githubusercontent.com/44235289/84030877-afe8b300-a98c-11ea-8a77-be84d840bf5d.gif)
* Multiple schedules can be entered by the node editor UI or dynamically at runtime
* Send a default payload or any of the following: timestamp, string, number, boolean, flow variable, global variable, JSON, Buffer or Env variable as the output.
* Example CRON expressions provided in the dropdown to get you started
* Map popup to help you enter coordinates for solar events
  * NOTE: Map is 100% CDN dynamic and requires and internet connection. If there is no internet, the popup will provide information to help you get location coordinates from another source
  * ![cron-plus-map](https://user-images.githubusercontent.com/44235289/84031948-79ac3300-a98e-11ea-966c-b77200515030.gif)
* Option to separate command responses from output 1 to seperate 2nd output 
* Settable output variable (normally `msg.payload` but it is up to you)
* Inject-like button to fire the node (available when only one schedule is added) 
* View dynamically created schedules in the node editor UI
* Additional info about the triggered schedule is always send in the output message in `msg.cronplus` 
  * NOTE: if the payload is to "Default Payload", then the content of `msg.cronplus` is moved to `msg.payload`
* Node status updates to show the next event
  * NOTE: the status indicator will be shown as a "ring" for dynamic schedules or shown as a "dot" for static schedules
* Full flexability & dynamic control. 
  * Ability to control via simple topic commands. Examples include...
    * remove, remove-all, remove-all-dynamic, remove-all-static
    * list, list-all, list-all-dynamic, list-all-static
    * export, export-all, export-all-dynamic, export-all-static
    * stop, stop-all, stop-all-dynamic, stop-all-static
    * start, start-all, start-all-dynamic, start-all-static
    * pause, pause-all, pause-all-dynamic, pause-all-static
  * Ability to add, remove, list, export, stop, start, pause schedules by a command payload input. Examples include...
    * add - add one or more dynamic schedules
    * describe - describe solar events or cron expression (without the need to add a schedule)
      * useful for creating a [dynamic dashboard like this](https://flows.nodered.org/flow/79a66966a6cc655a827872a4af794b94)
* Demo flows demonstrating many of the capabilities. Import via node-red menu > import > examples.
* Optional timezone setting suppoting UTC and Region/Area (e.g. Europe/London)

Install
-------

* Easiest...

  Use the Manage Palette > Install option from the menu inside node-red

* Harder...

  Alternatively in your Node-RED user directory, typically ~/.node-red, run
Run the following command in the root directory of your Node-RED install.
(Usually this is `~/.node-red` or `%userprofile%\.node-red`).

  Install from GIT

      npm install Steve-Mcl/node-red-contrib-cron-plus

  Install from NPM 

      npm install node-red-contrib-cron-plus 

  Alternatively, install from a folder

      npm install c:/tempfolder/node-red-contrib-cron-plus


  Or simply copy the folder `node-red-contrib-cron-plus` into a folder named `nodes` inside your node-red folder then `cd` into `nodes/node-red-contrib-cron-plus` and execute `npm install`

Acknowledgments
---------------
* Inspired by [node-red-contrib-cron](https://github.com/chameleonbr/node-red-contrib-cron)

Dependencies
------------
* [cronosjs](https://github.com/jaclarke/cronosjs)
* [cronstrue](https://github.com/bradymholt/cRonstrue) 
* [pretty-ms](https://github.com/sindresorhus/pretty-ms)
* [suncalc2](https://github.com/andiling/suncalc2)
* [coord-parser](https://github.com/naturalatlas/coord-parser)

