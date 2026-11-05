# Runs the full review-probe chain: bundle (with every stub alias) + probe +
# static checks + tsc. One command so the alias list can never drift.
#   npm run probe
param(
  [switch]$SkipTsc
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$P = ($root -replace '\\', '/')
$stubs = "$P/.expo/review-probe/stubs"

# alias:package=stub-file
$pairs = @(
  "expo-sqlite=expo-sqlite",
  "expo-file-system=expo-file-system",
  "expo-file-system/legacy=expo-file-system-legacy",
  "expo-image-manipulator=expo-image-manipulator",
  "expo-media-library=expo-media-library",
  "expo-media-library/legacy=expo-media-library-legacy",
  "expo-constants=expo-constants",
  "expo-crypto=expo-crypto",
  "react-native=react-native",
  "react-native-tdlib=react-native-tdlib",
  "react-native-mmkv=react-native-mmkv",
  "react-native-fast-tflite=react-native-fast-tflite",
  "expo-document-picker=expo-document-picker",
  "expo-network=expo-network"
)

$args = @(
  ".expo/review-probe/probe.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--define:__DEV__=true",
  "--outfile=.expo/review-probe/probe.cjs"
)
foreach ($pair in $pairs) {
  $pkg, $file = $pair -split "="
  $args += "--alias:$pkg=$stubs/$file.ts"
}

& "node_modules\@esbuild\win32-x64\esbuild.exe" @args
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }

node .expo/review-probe/probe.cjs
if ($LASTEXITCODE -ne 0) { throw "probe failed" }

node .expo/review-probe/static-checks.cjs
if ($LASTEXITCODE -ne 0) { throw "static checks failed" }

if (-not $SkipTsc) {
  npx tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw "tsc failed" }
}
Write-Host "ALL GREEN"
