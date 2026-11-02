// Chrome's reduced user agent: major version only, a fixed OS token, and no Electron or app name.
export function chromeUserAgent(platform = process.platform, chromeVersion = process.versions.chrome) {
  const major = String(chromeVersion).split(".")[0];
  const os =
    platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
