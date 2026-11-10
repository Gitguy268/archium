# Template for Gitguy268/homebrew-tap Casks/archium.rb. Fill in SHA256_APP from the release's
# SHA256SUMS after the release workflow has attached the zip.
cask "archium" do
  version "0.1.0"
  sha256 "SHA256_APP"

  url "https://github.com/Gitguy268/archium/releases/download/v#{version}/Archium-#{version}-macos-arm64.zip"
  name "Archium"
  desc "Arc and Zen style browser with Helium's privacy defaults"
  homepage "https://github.com/Gitguy268/archium"

  depends_on arch: :arm64
  depends_on macos: ">= :monterey"

  app "Archium.app"

  # The release build is signed ad hoc, not notarised; clear the download quarantine so it opens.
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Archium.app"]
  end

  zap trash: [
    "~/Library/Application Support/Archium",
    "~/Library/Caches/Archium",
    "~/Library/Preferences/org.archium.browser.plist",
    "~/Library/Saved Application State/org.archium.browser.savedState",
  ]

  caveats <<~EOS
    Archium is not signed by Apple. The cask removes the quarantine flag after install.
  EOS
end
