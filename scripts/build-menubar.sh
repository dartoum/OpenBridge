#!/bin/zsh
set -eu
cd "${0:A:h}/.."
app_path="build/OpenBridge.app"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources/bridge"
xcrun swiftc -parse-as-library -module-cache-path /tmp/openbridge-swift-cache -target "$(uname -m)-apple-macos14.0" macos/OpenBridge.swift macos/ManagerView.swift macos/CLIMaintenance.swift macos/Icons.swift -o "$app_path/Contents/MacOS/OpenBridge" -framework AppKit -framework SwiftUI -framework Security
# The icon lives in the bundle so Finder and the Dock show it while the app is not running.
icon_dir=$(mktemp -d)
"$app_path/Contents/MacOS/OpenBridge" --render-icon "$icon_dir/AppIcon.iconset"
mkdir -p "$app_path/Contents/Resources"
iconutil -c icns -o "$app_path/Contents/Resources/AppIcon.icns" "$icon_dir/AppIcon.iconset"
rm -rf "$icon_dir"
cp "$(command -v node)" "$app_path/Contents/Resources/node"
cp -R src "$app_path/Contents/Resources/bridge/"
cp README.md "$app_path/Contents/Resources/bridge/"
python3 - <<'PY'
import os, plistlib
with open('build/OpenBridge.app/Contents/Info.plist', 'wb') as f:
    plistlib.dump({'CFBundleIdentifier':'local.openbridge.menubar','CFBundleName':'OpenBridge','CFBundleIconFile':'AppIcon','CFBundleExecutable':'OpenBridge','CFBundlePackageType':'APPL','CFBundleShortVersionString':'0.7.0','CFBundleDevelopmentRegion':'en','CFBundleLocalizations':['en'],'LSMinimumSystemVersion':'14.0','BridgeRoot':os.getcwd()},f)
PY
# A stable signing identity keeps Keychain "Always Allow" valid across rebuilds; fall back to ad-hoc signing.
identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development[^"]*\)".*/\1/p' | head -1)
echo "Signing with: ${identity:-ad-hoc}"
codesign --force --sign "${identity:--}" "$app_path/Contents/Resources/node"
codesign --force --sign "${identity:--}" "$app_path"
# Make macOS read the new icon right away instead of showing a cached one in the Dock and Finder.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app_path" >/dev/null 2>&1 || true
