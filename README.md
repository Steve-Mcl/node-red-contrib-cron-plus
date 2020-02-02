node-red-contrib-cron-plus
============================
_A flexible scheduler node for Node-RED (featuring full dynamic control, sunrise/sunset by location and Timezone support)_

FEATURES
--------
* Schedule by CRON, date and date sequences, sunrise & sunset (with offset)
  * Human readable descriptions of your CRON expression are provided as you type.
* Send timestamp, string, number, boolean, flow variable, global variable, JSON, Buffer or Env variable as the output.
* Option to separate control responses from output 1 to seperate 2nd output 
* Settable output variable (normally `msg.payload` but it is up to you)
* Inject-like button to fire the node (available when only one schedule is added) 
* Multiple schedules can be entered by the UI
* Additional info about the triggered schedule is always send in the output message in `msg.cronplus`
* Ability to add, remove, list, stop, start, pause schedules by a payload input permitting full flexability & dynamic control
* Full demo flow provided in node-red editors menu > import > examples.
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
