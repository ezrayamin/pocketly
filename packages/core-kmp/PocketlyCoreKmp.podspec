require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "PocketlyCoreKmp"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/ezrayamin/pocketly"
  s.license      = "MIT"
  s.authors      = "Ezra Yamin"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/ezrayamin/pocketly.git", :tag => "#{s.version}" }

  s.source_files = [
    # Nitro adapter (Swift) over the KMP facade
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
  ]

  # The KMP module, built by `yarn workspace @pocketly/core-kmp build:ios-framework`
  # (shared/ → assemblePocketlySharedReleaseXCFramework → ios/Frameworks/).
  s.vendored_frameworks = "ios/Frameworks/PocketlyShared.xcframework"

  load 'nitrogen/generated/ios/PocketlyCoreKmp+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
