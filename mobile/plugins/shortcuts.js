// The App Shortcuts list (Shortcuts.swift) belongs to the app itself, never an extension. The ask it names is in
// targets/actions/_shared, which the app shares with the controls.
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const { copyFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = (config) => withXcodeProject(withDangerousMod(config, ['ios', (c) => {
  copyFileSync(join(__dirname, 'Shortcuts.swift'), join(c.modRequest.platformProjectRoot, c.modRequest.projectName, 'Shortcuts.swift'));
  return c;
}]), (c) => {
  const file = `${c.modRequest.projectName}/Shortcuts.swift`;
  if (!c.modResults.hasFile(file)) IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: file, groupName: c.modRequest.projectName, project: c.modResults });
  return c;
});
