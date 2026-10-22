#!/bin/zsh
set -eu
cd "${0:A:h}/.."
task_test_dir=$(mktemp -d /tmp/openbridge-native-check.XXXXXX)
trap 'rm -rf "$task_test_dir"' EXIT
xcrun swiftc -module-cache-path "$task_test_dir/cache" macos/CLIMaintenance.swift test/native/maintenance.swift -o "$task_test_dir/maintenance-tests"
"$task_test_dir/maintenance-tests"
xcrun swiftc -module-cache-path "$task_test_dir/cache" macos/CLIStatus.swift test/native/status.swift -o "$task_test_dir/status-tests"
"$task_test_dir/status-tests"
