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
$env:AZURE_TRUSTED_SIGNING_ENDPOINT = "https://<region>.codesigning.azure.net/"
$env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME = "<trusted-signing-account-name>"
$env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME = "<private-trust-profile-name>"
$env:AZURE_TRUSTED_SIGNING_PUBLISHER_NAME = "<certificate-common-name>"
```

`AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME` must point to a certificate
profile created with the `PrivateTrust` profile type.

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

To sign a specific file:

```powershell
npm run sign:win:private-trust -- --file "D:\Code\OpenScreen\release\1.4.0\Openscreen Setup 1.4.0.exe"
```

## Build And Sign

This signs the packaged app executable, bundled OCR service executable, and NSIS
installer during the Windows build:

```powershell
npm run build:win:private-trust
```

The regular `npm run build:win` remains unsigned for local development builds.

## Verification

After signing:

```powershell
Get-AuthenticodeSignature "release\1.4.0\Openscreen Setup 1.4.0.exe" | Format-List
```

Private trust signatures are valid only on machines that trust the private trust
certificate chain/publisher. For public downloads that must be trusted on any
Windows machine, use a public trust certificate profile instead.
