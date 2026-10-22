#!/bin/zsh
set -eu
cd "${0:A:h}/.."
app_path="build/OpenBridge.app"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources/bridge"
xcrun swiftc -parse-as-library -module-cache-path /tmp/openbridge-swift-cache -target "$(uname -m)-apple-macos14.0" macos/OpenBridge.swift macos/ManagerView.swift -o "$app_path/Contents/MacOS/OpenBridge" -framework AppKit -framework SwiftUI -framework Security
cp "$(command -v node)" "$app_path/Contents/Resources/node"
cp -R src "$app_path/Contents/Resources/bridge/"
cp README.md "$app_path/Contents/Resources/bridge/"
python3 - <<'PY'
import os, plistlib
with open('build/OpenBridge.app/Contents/Info.plist', 'wb') as f:
    plistlib.dump({'CFBundleIdentifier':'local.openbridge.menubar','CFBundleName':'OpenBridge','CFBundleExecutable':'OpenBridge','CFBundlePackageType':'APPL','CFBundleShortVersionString':'0.5.0','CFBundleDevelopmentRegion':'en','CFBundleLocalizations':['en'],'LSMinimumSystemVersion':'14.0','LSUIElement':True,'BridgeRoot':os.getcwd()},f)
PY
codesign --force --sign - "$app_path/Contents/Resources/node"
codesign --force --sign - "$app_path"
