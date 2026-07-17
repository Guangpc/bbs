/**
 * Post-prebuild helper: copies Share Extension sources and ensures the Xcode
 * target exists with App Group entitlements. Safe to re-run.
 */
const fs = require("fs");
const path = require("path");
const xcode = require("xcode");

const ROOT = path.join(__dirname, "..");
const IOS = path.join(ROOT, "ios");
const EXT_NAME = "ShareExtension";
const APP_GROUP = "group.com.playproject.videobookmarkdemo";

function findPbxproj() {
  const entries = fs.readdirSync(IOS);
  const projectDir = entries.find((name) => name.endsWith(".xcodeproj"));
  if (!projectDir) {
    throw new Error("No .xcodeproj under ios/");
  }
  return path.join(IOS, projectDir, "project.pbxproj");
}

function copySources() {
  const src = path.join(ROOT, "native", "ShareExtension");
  const dest = path.join(IOS, EXT_NAME);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of [
    "ShareViewController.swift",
    "Info.plist",
    "ShareExtension.entitlements",
  ]) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

function ensureMainEntitlements() {
  const appDirs = fs
    .readdirSync(IOS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.endsWith(".xcodeproj") && d.name !== "Pods" && d.name !== EXT_NAME)
    .map((d) => d.name);

  for (const dir of appDirs) {
    const entitlementsPath = path.join(IOS, dir, `${dir}.entitlements`);
    if (!fs.existsSync(entitlementsPath)) {
      continue;
    }
    const plist = fs.readFileSync(entitlementsPath, "utf8");
    if (plist.includes(APP_GROUP)) {
      continue;
    }
    const next = plist.replace(
      "</dict>\n</plist>",
      `\t<key>com.apple.security.application-groups</key>\n\t<array>\n\t\t<string>${APP_GROUP}</string>\n\t</array>\n</dict>\n</plist>`,
    );
    fs.writeFileSync(entitlementsPath, next);
    console.log(`Updated entitlements: ${entitlementsPath}`);
  }
}

function ensureTarget() {
  const pbxPath = findPbxproj();
  const project = xcode.project(pbxPath);
  project.parseSync();

  if (project.pbxTargetByName(EXT_NAME)) {
    console.log("ShareExtension target already exists");
    return;
  }

  const bundleId = "com.playproject.videobookmarkdemo.ShareExtension";
  const target = project.addTarget(EXT_NAME, "app_extension", EXT_NAME, bundleId);

  const groupId = project.pbxCreateGroup(EXT_NAME, EXT_NAME);
  const mainGroupId = project.getFirstProject().firstProject.mainGroup;
  project.getPBXGroupByKey(mainGroupId).children.push({
    value: groupId,
    comment: EXT_NAME,
  });

  project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
  project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
  project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);

  // Group already has path=ShareExtension, so file path must be basename only.
  project.addSourceFile("ShareViewController.swift", { target: target.uuid }, groupId);

  const configs = project.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configs)) {
    const item = configs[key];
    if (typeof item !== "object" || !item.buildSettings) continue;
    const name = item.buildSettings.PRODUCT_NAME;
    const bid = item.buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
    if (name === `"${EXT_NAME}"` || bid === `"${bundleId}"`) {
      item.buildSettings.INFOPLIST_FILE = `${EXT_NAME}/Info.plist`;
      item.buildSettings.CODE_SIGN_ENTITLEMENTS = `${EXT_NAME}/ShareExtension.entitlements`;
      item.buildSettings.CLANG_ENABLE_MODULES = "YES";
      item.buildSettings.SWIFT_VERSION = "5.0";
      item.buildSettings.TARGETED_DEVICE_FAMILY = "1";
      item.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "15.1";
      item.buildSettings.GENERATE_INFOPLIST_FILE = "NO";
      item.buildSettings.SKIP_INSTALL = "YES";
      item.buildSettings.LD_RUNPATH_SEARCH_PATHS =
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
    }
  }

  const mainTarget = project.getFirstTarget();
  project.addTargetDependency(mainTarget.uuid, [target.uuid]);

  fs.writeFileSync(pbxPath, project.writeSync());
  console.log("Added ShareExtension target to Xcode project");
}

function main() {
  if (!fs.existsSync(IOS)) {
    console.error("ios/ missing. Run: npx expo prebuild --platform ios");
    process.exit(1);
  }
  copySources();
  ensureMainEntitlements();
  ensureTarget();
  console.log("Share Extension ready.");
}

main();
