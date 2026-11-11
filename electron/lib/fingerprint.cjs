const { randomBytes } = require("node:crypto");

const REGIONS = {
  "zh-CN": { locale: "zh-CN", languages: ["zh-CN", "zh", "en"], timezone: "Asia/Shanghai" },
  "en-US": { locale: "en-US", languages: ["en-US", "en"], timezone: "America/New_York" },
  "en-GB": { locale: "en-GB", languages: ["en-GB", "en"], timezone: "Europe/London" },
  "de-DE": { locale: "de-DE", languages: ["de-DE", "de", "en"], timezone: "Europe/Berlin" },
};

const HARDWARE_PROFILES = [4, 8, 8, 12];

function normalizeChromeVersion(chromeVersion) {
  const match = String(chromeVersion || "").match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  return match ? match[0] : "136.0.0.0";
}

function buildFingerprint({ region, systemLocale, systemTimezone, chromeVersion, randomIndex }) {
  const selectedRegion = region === "local"
    ? {
        locale: systemLocale || "en-US",
        languages: [systemLocale || "en-US", String(systemLocale || "en-US").split("-")[0], "en"],
        timezone: systemTimezone || "UTC",
      }
    : REGIONS[region] || REGIONS["en-US"];
  const index = Number.isInteger(randomIndex)
    ? Math.abs(randomIndex) % HARDWARE_PROFILES.length
    : randomBytes(1)[0] % HARDWARE_PROFILES.length;
  const fullVersion = normalizeChromeVersion(chromeVersion);
  const majorVersion = fullVersion.split(".")[0];

  return {
    ...selectedRegion,
    platform: "Win32",
    hardwareConcurrency: HARDWARE_PROFILES[index],
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${fullVersion} Safari/537.36`,
    userAgentMetadata: {
      brands: [
        { brand: "Chromium", version: majorVersion },
        { brand: "Not_A Brand", version: "99" },
      ],
      fullVersionList: [
        { brand: "Chromium", version: fullVersion },
        { brand: "Not_A Brand", version: "99.0.0.0" },
      ],
      fullVersion,
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      model: "",
      mobile: false,
      bitness: "64",
      wow64: false,
    },
    profileCode: randomBytes(4).toString("hex").toUpperCase(),
  };
}

module.exports = { buildFingerprint, REGIONS, HARDWARE_PROFILES };
