/**
 * iOS App Intents: "Arm Guard Mode" and "Charger alarm" as App Shortcuts.
 *
 * App Shortcuts appear automatically — no setup by the user — in Siri
 * ("Arm PhantomShield"), Spotlight, the Shortcuts app, and the Action Button
 * picker, and can drive Shortcuts automations such as "when the charger is
 * disconnected". Each intent opens the app on the same deep link the in-app
 * quick actions use (see src/services/shortcuts.ts).
 *
 * The Swift file is added to the MAIN app target: App Intents metadata is only
 * extracted from the target that ships it, and a pod's static library would be
 * silently skipped.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject, IOSConfig } = require('expo/config-plugins');

const FILE = 'ArmGuardIntents.swift';

const SWIFT = `import AppIntents
import UIKit

@available(iOS 16.0, *)
private func openGuard(_ mode: String) async {
  guard let url = URL(string: "phantomshield://guard-mode?arm=1&mode=\\(mode)") else { return }
  await UIApplication.shared.open(url)
}

@available(iOS 16.0, *)
struct ArmGuardModeIntent: AppIntent {
  static var title: LocalizedStringResource = "Arm Guard Mode"
  static var description = IntentDescription("Start PhantomShield Guard Mode for a phone left on a table.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await openGuard("table")
    return .result()
  }
}

@available(iOS 16.0, *)
struct ArmChargerAlarmIntent: AppIntent {
  static var title: LocalizedStringResource = "Start Charger Alarm"
  static var description = IntentDescription("Sound PhantomShield's alarm if the charger is pulled out.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await openGuard("charger")
    return .result()
  }
}

@available(iOS 16.0, *)
struct PhantomShieldShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ArmGuardModeIntent(),
      phrases: ["Arm \\(.applicationName)", "Start Guard Mode in \\(.applicationName)"],
      shortTitle: "Arm Guard Mode",
      systemImageName: "shield.lefthalf.filled"
    )
    AppShortcut(
      intent: ArmChargerAlarmIntent(),
      phrases: ["Start \\(.applicationName) charger alarm"],
      shortTitle: "Charger Alarm",
      systemImageName: "powerplug"
    )
  }
}
`;

module.exports = (config) => {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const name = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
      fs.writeFileSync(path.join(cfg.modRequest.platformProjectRoot, name, FILE), SWIFT);
      return cfg;
    },
  ]);
  return withXcodeProject(config, (cfg) => {
    const name = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const filepath = `${name}/${FILE}`;
    if (!cfg.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: name,
        project: cfg.modResults,
      });
    }
    return cfg;
  });
};
