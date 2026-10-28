#!/bin/zsh
# Builds build/OpenBridge.app for this Mac. With OPENBRIDGE_RELEASE=1 (see scripts/package-release.sh) it builds a
# universal app (Apple silicon and Intel), signed ad-hoc and without the checkout path, for others to download.
set -eu
cd "${0:A:h}/.."
version="0.7.0"
release="${OPENBRIDGE_RELEASE:-}"
app_path="${OPENBRIDGE_APP:-build/OpenBridge.app}"
# Start from an empty bundle so files removed from src/ never linger in it.
rm -rf "$app_path"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources/bridge"
sources=(macos/OpenBridge.swift macos/ManagerView.swift macos/CLIMaintenance.swift macos/Icons.swift macos/CLIStatus.swift)
compile() { xcrun swiftc -parse-as-library -module-cache-path /tmp/openbridge-swift-cache -target "$1-apple-macos14.0" $sources -o "$2" -framework AppKit -framework SwiftUI -framework Security }
if [[ -n "$release" ]]; then
  slices=$(mktemp -d)
  compile arm64 "$slices/arm64"; compile x86_64 "$slices/x86_64"
  lipo -create "$slices/arm64" "$slices/x86_64" -output "$app_path/Contents/MacOS/OpenBridge"
  rm -rf "$slices"
else
  compile "$(uname -m)" "$app_path/Contents/MacOS/OpenBridge"
fi
# The icon lives in the bundle so Finder and the Dock show it while the app is not running.
icon_dir=$(mktemp -d)
"$app_path/Contents/MacOS/OpenBridge" --render-icon "$icon_dir/AppIcon.iconset"
mkdir -p "$app_path/Contents/Resources"
iconutil -c icns -o "$app_path/Contents/Resources/AppIcon.icns" "$icon_dir/AppIcon.iconset"
rm -rf "$icon_dir"
node_binary="$(command -v node)"
if [[ -n "$release" ]] && ! { lipo -archs "$node_binary" | grep -q arm64 && lipo -archs "$node_binary" | grep -q x86_64; }; then
  echo "A release needs a universal Node binary (arm64 and x86_64); $node_binary is $(lipo -archs "$node_binary")" >&2; exit 1
fi
cp "$node_binary" "$app_path/Contents/Resources/node"
cp -R src "$app_path/Contents/Resources/bridge/"
cp README.md LICENSE "$app_path/Contents/Resources/bridge/"
OPENBRIDGE_VERSION="$version" OPENBRIDGE_PLIST="$app_path/Contents/Info.plist" python3 - <<'PY'
import os, plistlib
info = {'CFBundleIdentifier':'local.openbridge.menubar','CFBundleName':'OpenBridge','CFBundleIconFile':'AppIcon','CFBundleExecutable':'OpenBridge','CFBundlePackageType':'APPL','CFBundleShortVersionString':os.environ['OPENBRIDGE_VERSION'],'CFBundleVersion':os.environ['OPENBRIDGE_VERSION'],'CFBundleDevelopmentRegion':'en','CFBundleLocalizations':['en'],'LSMinimumSystemVersion':'14.0','NSHumanReadableCopyright':'MIT License'}
# A development build remembers its checkout (to carry over an existing .bridge-key); a release must not carry a local path.
if not os.environ.get('OPENBRIDGE_RELEASE'): info['BridgeRoot'] = os.getcwd()
with open(os.environ['OPENBRIDGE_PLIST'], 'wb') as f: plistlib.dump(info, f)
PY
# A stable signing identity keeps Keychain "Always Allow" valid across rebuilds; fall back to ad-hoc signing.
# Releases are always ad-hoc: a development certificate would put the developer's name and email in the app.
identity=""
[[ -z "$release" ]] && identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development[^"]*\)".*/\1/p' | head -1)
echo "Signing with: ${identity:-ad-hoc}"
codesign --force --sign "${identity:--}" "$app_path/Contents/Resources/node"
codesign --force --sign "${identity:--}" "$app_path"
# Make macOS read the new icon right away instead of showing a cached one in the Dock and Finder.
[[ -z "$release" ]] && { /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app_path" >/dev/null 2>&1 || true; }
exit 0
