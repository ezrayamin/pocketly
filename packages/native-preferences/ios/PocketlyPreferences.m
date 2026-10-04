#import <React/RCTBridgeModule.h>

// NSUserDefaults: the same store the KMP core's IosPreferencesStore uses.
@interface PocketlyPreferences : NSObject <RCTBridgeModule>
@end

@implementation PocketlyPreferences

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(getString:(NSString *)key
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  resolve([[NSUserDefaults standardUserDefaults] stringForKey:key] ?: [NSNull null]);
}

RCT_EXPORT_METHOD(setString:(NSString *)key
                  value:(NSString *)value
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [[NSUserDefaults standardUserDefaults] setObject:value forKey:key];
  resolve(nil);
}

@end
