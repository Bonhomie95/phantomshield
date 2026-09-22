/**
 * Raise every CocoaPods target to the app's iOS deployment target.
 *
 * Several pods still declare iOS 9–13; newer Xcode releases refuse to build
 * anything below iOS 15 ("deployment target ... is set to 9.0"). Lifting them
 * to the app's own minimum changes nothing at runtime — the app can't run
 * below that version anyway.
 */
const { withPodfile } = require('expo/config-plugins');

const MARKER = '# phantomshield: pods deployment target';

module.exports = (config, { target = '15.1' } = {}) =>
  withPodfile(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    src = src.replace(
      /post_install do \|installer\|\n/,
      (m) =>
        `${m}    ${MARKER}\n` +
        `    installer.pods_project.targets.each do |t|\n` +
        `      t.build_configurations.each do |bc|\n` +
        `        if bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${target}\n` +
        `          bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${target}'\n` +
        `        end\n` +
        `      end\n` +
        `    end\n`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
