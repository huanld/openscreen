import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

function loadLocalSigningEnv() {
	const envPath = path.join(rootDir, ".env.signing.local");
	if (!fs.existsSync(envPath)) {
		return;
	}

	const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
		if (!match || process.env[match[1]]) {
			continue;
		}
		process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
	}
}

function usage() {
	return [
		"Usage:",
		"  node scripts/sign-windows-private-trust.mjs [--file <path>]",
		"",
		"Defaults to release/<version>/Openscreen Setup <version>.exe",
	].join("\n");
}

function parseArgs(argv) {
	const args = { file: null };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			console.log(usage());
			process.exit(0);
		}
		if (arg === "--file") {
			args.file = argv[i + 1];
			i += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}\n${usage()}`);
	}
	return args;
}

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function hasAnyAuthMode() {
	const hasClientSecret = Boolean(process.env.AZURE_CLIENT_SECRET?.trim());
	const hasClientCertificate = Boolean(process.env.AZURE_CLIENT_CERTIFICATE_PATH?.trim());
	const hasUsernamePassword = Boolean(
		process.env.AZURE_USERNAME?.trim() && process.env.AZURE_PASSWORD?.trim(),
	);
	return hasClientSecret || hasClientCertificate || hasUsernamePassword;
}

function psQuote(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function runPowerShell(command) {
	return new Promise((resolve, reject) => {
		const candidates = ["pwsh.exe", "powershell.exe"];
		const tryCandidate = (index, lastError) => {
			if (index >= candidates.length) {
				reject(lastError ?? new Error("Unable to find PowerShell"));
				return;
			}

			const child = spawn(
				candidates[index],
				["-NoProfile", "-NonInteractive", "-Command", command],
				{
					stdio: "inherit",
					windowsHide: true,
				},
			);

			child.on("error", (error) => tryCandidate(index + 1, error));
			child.on("exit", (code) => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(new Error(`${candidates[index]} exited with code ${code}`));
			});
		};

		tryCandidate(0);
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const defaultInstaller = path.join(
		rootDir,
		"release",
		packageJson.version,
		`Openscreen Setup ${packageJson.version}.exe`,
	);
	const fileToSign = path.resolve(rootDir, args.file ?? defaultInstaller);

	if (!fs.existsSync(fileToSign)) {
		throw new Error(`Installer not found: ${fileToSign}`);
	}

	requireEnv("AZURE_TENANT_ID");
	requireEnv("AZURE_CLIENT_ID");
	if (!hasAnyAuthMode()) {
		throw new Error(
			"Missing Azure auth mode. Set AZURE_CLIENT_SECRET, or AZURE_CLIENT_CERTIFICATE_PATH, or AZURE_USERNAME/AZURE_PASSWORD.",
		);
	}

	const endpoint = requireEnv("AZURE_TRUSTED_SIGNING_ENDPOINT");
	const accountName = requireEnv("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME");
	const profileName = requireEnv("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME");
	const timestampUrl =
		process.env.AZURE_TRUSTED_SIGNING_TIMESTAMP_RFC3161?.trim() ||
		"http://timestamp.acs.microsoft.com";

	const installCommand = [
		"Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser",
		"Install-Module -Name TrustedSigning -MinimumVersion 0.5.0 -Force -Repository PSGallery -Scope CurrentUser",
	].join("; ");

	const signCommand = [
		"Invoke-TrustedSigning",
		`-Endpoint ${psQuote(endpoint)}`,
		`-CertificateProfileName ${psQuote(profileName)}`,
		`-CodeSigningAccountName ${psQuote(accountName)}`,
		`-TimestampRfc3161 ${psQuote(timestampUrl)}`,
		"-TimestampDigest SHA256",
		"-FileDigest SHA256",
		`-Files ${psQuote(fileToSign)}`,
	].join(" ");

	const verifyCommand = [
		"$signature = Get-AuthenticodeSignature -FilePath",
		psQuote(fileToSign),
		"; $signature | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate",
	].join(" ");

	console.log(`Signing ${fileToSign}`);
	await runPowerShell(installCommand);
	await runPowerShell(signCommand);
	await runPowerShell(verifyCommand);
}

loadLocalSigningEnv();

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
