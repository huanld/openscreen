# OpenScreen 1.4.14 release

Publish the screenshot capture and lightweight image editor approved in manual testing.

- [x] Recover repository metadata from Gitea main without replacing workspace files.
- [x] Compare current source with Gitea 1.4.13 and select the feature changes.
- [x] Commit and push source and version 1.4.14 to Gitea.
- [x] Build the Windows installer and sign all shipped application executables and installer with the confirmed signing identity.
- [x] Verify Authenticode signatures, timestamp, installer hashes and updater metadata after signing.
- [x] Publish versioned assets and release, then advance the latest updater feed after verification.
- [x] Verify Gitea downloads and published updater hashes against local signed artifacts.

The previous release and updater are 1.4.13. Existing release assets are served from versioned `release-assets/v*` branches; `release-assets/latest` is the generic updater endpoint. Record the current latest branch commit before advancing it so it can be restored if verification fails. Do not publish an unsigned substitute while signing configuration is unresolved.

## Published 2026-09-16

- Source commit `db41cf0975fdf442c4c1c839b243179c95dc5713`, tag `v1.4.14`.
- Assets commit `49054ba0fb7e05e47a4c61d21d27c94c660dbcc5` on both
  `release-assets/v1.4.14` and `release-assets/latest`; the feed it replaced was
  `cb3e52122ab042ffb0d76a2436a1c554bd35eb5c`.
- Installer `Openscreen-Setup-1.4.14.exe`, 419930072 bytes,
  SHA256 `0345700d96248d87b1d8f64f2153274ae462e65458ffb70493c452316b1abf72`.
- Verified directly with `Get-AuthenticodeSignature`: the installer,
  `Openscreen.exe`, `elevate.exe`, the four native helpers and the OCR service
  are all `Valid`, signed by `huanleducoutlook.onmicrosoft.com` and timestamped.
- The uninstaller was signed during the build, before NSIS embedded it into the
  installer; that step is recorded in the build log rather than checked on disk.
