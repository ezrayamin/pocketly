require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "PocketlyPreferences"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/ezrayamin/pocketly"
  s.license      = "MIT"
  s.authors      = "Ezra Yamin"
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/ezrayamin/pocketly.git", :tag => "#{s.version}" }
  s.source_files = "ios/**/*.{h,m,mm}"

  install_modules_dependencies(s)
end
