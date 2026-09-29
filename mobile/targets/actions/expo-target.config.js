// The phone's own ways in (iPhone): Control Center, Lock Screen and Action button controls. The ask they run is in
// _shared, so the app builds it too; the App Shortcuts list is the app's alone (plugins/shortcuts.js).
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = { type: 'widget', name: 'actions', displayName: 'Crewhouse', deploymentTarget: '18.0' };
