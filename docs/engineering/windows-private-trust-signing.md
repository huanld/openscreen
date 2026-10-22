# Windows Private Trust Signing

OpenScreen supports Microsoft Trusted Signing private trust profiles for Windows
builds. Secrets and signing resource names are read from environment variables;
no certificate, client secret, or API key should be committed.

For a local signing machine, copy `.env.signing.example` to
`.env.signing.local` and fill in values there. `.env.signing.local` is ignored
by Git. Explicit shell environment variables override values in that local file.

## Required Azure Resource Variables

Set these values for the Trusted Signing account and certificate profile:

```powershell
$env:AZURE_TRUSTED_SIGNING_ENDPOINT = "https://eus.codesigning.azure.net/"
$env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME = "codesign-huanld"
$env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME = "codesign-profile"
$env:AZURE_TRUSTED_SIGNING_PUBLISHER_NAME = "huanleducoutlook.onmicrosoft.com"
```

`AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME` must point to a certificate
profile created with the `PrivateTrust` profile type.

These operational values were verified for the 1.4.14 release on 2026-09-16.
Older Knowledge/shared signing guides list account `huanld`; the working account
is `codesign-huanld`. Resource names and publisher identity above are not credentials.

## Required Azure Auth Variables

Electron Builder uses Azure environment credentials. Set the tenant and client:

```powershell
$env:AZURE_TENANT_ID = "<tenant-id>"
$env:AZURE_CLIENT_ID = "<app-registration-client-id>"
```

Then set one authentication mode. Service principal secret is the simplest for
local signing:

```powershell
$env:AZURE_CLIENT_SECRET = "<client-secret>"
```

Certificate auth is also supported:

```powershell
$env:AZURE_CLIENT_CERTIFICATE_PATH = "C:\secure\signing-auth.pfx"
$env:AZURE_CLIENT_CERTIFICATE_PASSWORD = "<pfx-password>"
```

## Sign Existing Installer

This signs the installer already built at
`release/<version>/Openscreen Setup <version>.exe`:

```powershell
npm run sign:win:private-trust
```

Signing only an existing installer does not sign its embedded application or
uninstaller. Use the full build below for releases. If an installer is signed
again afterward, regenerate its blockmap and update hashes before publishing.

To sign a specific file:

```powershell
npm run sign:win:private-trust -- --file "D:\Code\OpenScreen\release\1.4.0\Openscreen Setup 1.4.0.exe"
```

## Build And Sign

This signs the packaged app executable, bundled native helpers and OCR service
executable, NSIS uninstaller, and installer during the Windows build. Signing is
required: the private-trust configuration sets `forceCodeSigning: true`.

```powershell
npm run build:win:private-trust -- --publish never
```

The regular `npm run build:win` remains unsigned for local development builds.

PowerShell 7 is not required. Electron Builder prefers `pwsh.exe` and falls back
to Windows PowerShell, and the `TrustedSigning` module (0.5.8) supports 5.1, so
`powershell.exe` signs correctly when `pwsh` is absent.

For direct SignTool use on the release machine, use the **x64** Windows SDK
SignTool with the **x64** `Azure.CodeSigning.Dlib.dll` from the Trusted Signing
client. The x86 combination failed with exit code 3 in this environment. The
verified SDK executable is:

```text
C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe
```

Use SHA256 for both file and timestamp digests and the RFC3161 timestamp URL
`http://timestamp.acs.microsoft.com`. Keep authentication values in environment
variables or the ignored local environment file; never put them in metadata JSON.

## Publishing Release Assets

Push release asset branches over SSH, not HTTPS. The HTTPS endpoint is proxied by
Cloudflare, which rejects request bodies above roughly 100 MB, so the single
`git-receive-pack` POST that carries the ~420 MB installer fails with
`error: RPC failed; HTTP 413`. SSH reaches the origin server directly:

```text
ssh://git@gittea.softs.business:2224/huanld/openscreen.git
```

Small HTTPS calls are unaffected, so the release API and its attachments
(blockmap, sha256, `latest.yml`) continue to work over HTTPS.

Two further behaviours of this instance are worth knowing before verifying a
publication:

- Gitea clears the `draft` flag by itself once attachments are uploaded, so a
  release created as a draft may already be public before the explicit publish
  call. Verify the attachment set rather than the draft flag.
- The instance requires sign-in for `raw/branch/...` paths and for the API even
  though the repository is public, while `releases/download/...` is anonymous.
  The updater therefore needs `OPENSCREEN_UPDATE_TOKEN` (see
  `electron/updater.ts`) to read the `release-assets/latest` feed.

## Gitea Release Workflow

`.gitea/workflows/windows-release.yml` is manual-only. Pushing a release tag does
not start another build that could replace artifacts produced and verified locally.
The workflow uses the signed build with `--publish never`; its explicit publishing
steps run only after the build succeeds.

Configure Gitea Actions secrets for all four `AZURE_TRUSTED_SIGNING_*` resource
variables above plus `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`.
The workflow requires `GITEA_TOKEN` for release access. Missing configuration stops
the workflow before building or uploading. An already-published version is rejected
before the build and checked again before release asset uploads; choose a new version
instead of replacing a published release.

## Verification

After signing:

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Get-AuthenticodeSignature "release\$version\Openscreen Setup $version.exe" | Format-List
```

Check the installer, packaged `Openscreen.exe`, native helpers, OCR service, and
uninstaller for `Status: Valid`, the expected publisher, and a timestamp. The
standalone signing command fails if any of those signature checks fail for its
target file. Verify final SHA256/SHA512 metadata after all signing is complete.

Private trust signatures are valid only on machines that trust the private trust
certificate chain/publisher. For public downloads that must be trusted on any
Windows machine, use a public trust certificate profile instead.
