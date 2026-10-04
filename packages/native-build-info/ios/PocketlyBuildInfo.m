#import <React/RCTBridgeModule.h>

// Info.plist `PocketlyDevTools` = $(POCKETLY_DEV_TOOLS:default=YES). Missing → NO (fail closed).
@interface PocketlyBuildInfo : NSObject <RCTBridgeModule>
@end

@implementation PocketlyBuildInfo

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSDictionary *)constantsToExport
{
  id value = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"PocketlyDevTools"];
  BOOL enabled = [value respondsToSelector:@selector(boolValue)] && [value boolValue];
  return @{ @"devToolsEnabled" : @(enabled) };
}

- (NSDictionary *)getConstants
{
  return [self constantsToExport];
}

@end
