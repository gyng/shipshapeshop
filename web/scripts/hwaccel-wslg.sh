#!/usr/bin/env bash
# Launch Chrome/Chromium with WSLg GPU acceleration for testing Ship Shape Shop.
#
# Findings on this WSL2 box (2026-06): /dev/dxg + NVIDIA WSL libs + mesa's d3d12 Gallium GL driver are
# present, BUT Vulkan only exposes `llvmpipe` (software) and there is no /dev/dri. So the realistic HW path
# is ANGLE → native GL → mesa **d3d12** → /dev/dxg → the host GPU. Headless Chromium otherwise falls back to
# SwiftShader (pure software), which is what the Playwright test browser used (~5fps before the perf pass,
# ~38fps after, still software).
#
# Pass a URL (defaults to the vite preview). After it opens, check chrome://gpu — "GL Renderer" should read
# the host GPU (D3D12) instead of "SwiftShader". If it still says SwiftShader, the d3d12 GL driver isn't
# wired up in this distro; test on native Windows instead (the app auto-accelerates there).

set -e
URL="${1:-http://localhost:4173}"

# Force mesa to use the D3D12 Gallium driver (host GPU via /dev/dxg) for OpenGL.
export LIBGL_ALWAYS_SOFTWARE=0
export MESA_LOADER_DRIVER_OVERRIDE=d3d12
export GALLIUM_DRIVER=d3d12

# Find a Chromium: prefer a system one, else the Playwright-bundled binary.
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME" ]; then
  CHROME="$(ls -1 "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | sort | tail -1 || true)"
fi
[ -z "$CHROME" ] && { echo "No Chromium found"; exit 1; }

exec "$CHROME" \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --use-gl=angle \
  --use-angle=gl-egl \
  --enable-features=Vulkan \
  "$URL"
