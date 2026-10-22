#!/bin/zsh
set -eu
cd "${0:A:h}/.."
mkdir -p build/OpenBridge.app/Contents/MacOS
xcrun swiftc -parse-as-library -module-cache-path /tmp/openbridge-swift-cache macos/OpenBridge.swift -o build/OpenBridge.app/Contents/MacOS/OpenBridge -framework AppKit -framework Security
python3 - <<'PY'
import os, plistlib, shutil
with open('build/OpenBridge.app/Contents/Info.plist', 'wb') as f:
    plistlib.dump({'CFBundleIdentifier':'local.openbridge.menubar','CFBundleName':'OpenBridge','CFBundleExecutable':'OpenBridge','CFBundlePackageType':'APPL','CFBundleShortVersionString':'0.3.0','LSUIElement':True,'BridgeRoot':os.getcwd(),'NodePath':shutil.which('node')},f)
PY
codesign --force --sign - build/OpenBridge.app
