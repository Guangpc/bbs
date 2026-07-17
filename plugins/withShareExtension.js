const { withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");

const APP_GROUP = "group.com.playproject.videobookmarkdemo";

function withShareExtension(config) {
  config = withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.security.application-groups"] = [APP_GROUP];
    return config;
  });

  config = withInfoPlist(config, (config) => {
    config.modResults.AppGroup = APP_GROUP;
    return config;
  });

  return config;
}

module.exports = withShareExtension;
