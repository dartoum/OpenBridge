#!/bin/zsh
set -eu
cd "${0:A:h}/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
unset GEMINI_API_KEY GOOGLE_API_KEY GOOGLE_APPLICATION_CREDENTIALS GOOGLE_GENAI_USE_VERTEXAI
export GOOGLE_GENAI_USE_GCA=true
exec node node_modules/@google/gemini-cli/bundle/gemini.js
