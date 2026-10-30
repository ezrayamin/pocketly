#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

// FR-QR-05 on iOS. UIScreen.brightness is the whole device's, so the previous value is kept and
// put back when My QR closes, and whenever the app leaves the foreground (and raised again when it
// returns while My QR is still shown).
@interface PocketlyBrightness : NSObject <RCTBridgeModule>
@end

@implementation PocketlyBrightness {
  BOOL _raised;
  BOOL _applied;
  CGFloat _previous;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (instancetype)init
{
  if (self = [super init]) {
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self selector:@selector(restore) name:UIApplicationWillResignActiveNotification object:nil];
    [center addObserver:self selector:@selector(apply) name:UIApplicationDidBecomeActiveNotification object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

RCT_EXPORT_METHOD(setRaised:(BOOL)raised)
{
  _raised = raised;
  if (raised) {
    [self apply];
  } else {
    [self restore];
  }
}

- (void)apply
{
  if (!_raised || _applied) return;
  _previous = UIScreen.mainScreen.brightness;
  UIScreen.mainScreen.brightness = 1.0;
  _applied = YES;
}

- (void)restore
{
  if (!_applied) return;
  UIScreen.mainScreen.brightness = _previous;
  _applied = NO;
}

@end
