#!/bin/zsh
# Builds the downloadable app and packs it as a zip and a dmg in build/release/, ready to attach to a GitHub release.
set -eu
cd "${0:A:h}/.."
out="build/release"
rm -rf "$out"; mkdir -p "$out"
OPENBRIDGE_RELEASE=1 OPENBRIDGE_APP="$out/OpenBridge.app" scripts/build-menubar.sh
version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$out/OpenBridge.app/Contents/Info.plist")
ditto -c -k --keepParent "$out/OpenBridge.app" "$out/OpenBridge-$version.zip"
staging=$(mktemp -d)
ditto "$out/OpenBridge.app" "$staging/OpenBridge.app"
ln -s /Applications "$staging/Applications"
hdiutil create -quiet -volname "OpenBridge $version" -srcfolder "$staging" -fs HFS+ -format UDZO "$out/OpenBridge-$version.dmg"
rm -rf "$staging"
(cd "$out" && shasum -a 256 "OpenBridge-$version.zip" "OpenBridge-$version.dmg" | tee SHA256SUMS.txt)
