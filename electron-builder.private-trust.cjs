const fs = require("node:fs");
const path = require("node:path");
const JSON5 = require("json5");

function loadLocalSigningEnv() {
	const envPath = path.join(__dirname, ".env.signing.local");
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

function readBaseConfig() {
	const configPath = path.join(__dirname, "electron-builder.json5");
	return JSON5.parse(fs.readFileSync(configPath, "utf8"));
}

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function requireAnyEnv(names) {
	for (const name of names) {
		const value = process.env[name]?.trim();
		if (value) {
			return value;
		}
	}
	throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

loadLocalSigningEnv();

const config = readBaseConfig();

config.win = {
	...config.win,
	signAndEditExecutable: true,
	azureSignOptions: {
		publisherName: requireAnyEnv([
			"AZURE_TRUSTED_SIGNING_PUBLISHER_NAME",
			"OPENSCREEN_SIGNING_PUBLISHER_NAME",
		]),
		endpoint: requireEnv("AZURE_TRUSTED_SIGNING_ENDPOINT"),
		certificateProfileName: requireEnv("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME"),
		codeSigningAccountName: requireEnv("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME"),
		fileDigest: process.env.AZURE_TRUSTED_SIGNING_FILE_DIGEST?.trim() || "SHA256",
		timestampRfc3161:
			process.env.AZURE_TRUSTED_SIGNING_TIMESTAMP_RFC3161?.trim() ||
			"http://timestamp.acs.microsoft.com",
		timestampDigest: process.env.AZURE_TRUSTED_SIGNING_TIMESTAMP_DIGEST?.trim() || "SHA256",
	},
};

delete config.win.signExts;

module.exports = config;
