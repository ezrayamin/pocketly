#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

// NFR-SEC-03 on iOS. Apps can't block screenshots, but they can tell when the screen is being
// recorded or mirrored (UIScreen.isCaptured). While a sensitive screen is shown and the screen is
// captured, an opaque cover sits above the whole window, so the recording shows nothing.
@interface PocketlySecureScreen : NSObject <RCTBridgeModule>
@end

@implementation PocketlySecureScreen {
  BOOL _enabled;
  UIView *_cover;
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
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(update)
                                                 name:UIScreenCapturedDidChangeNotification
                                               object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

RCT_EXPORT_METHOD(setEnabled:(BOOL)enabled)
{
  _enabled = enabled;
  [self update];
}

- (void)update
{
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ [self update]; });
    return;
  }
  BOOL captured = UIScreen.mainScreen.isCaptured;
  if (_enabled && captured) {
    UIWindow *window = RCTKeyWindow();
    if (window == nil) return;
    if (_cover == nil) {
      _cover = [[UIView alloc] initWithFrame:window.bounds];
      _cover.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
      // colors.background (src/theme/tokens.ts)
      _cover.backgroundColor = [UIColor colorWithRed:0x09 / 255.0 green:0x0D / 255.0 blue:0x16 / 255.0 alpha:1];
      UILabel *label = [[UILabel alloc] initWithFrame:_cover.bounds];
      label.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
      label.text = @"Hidden while the screen is recorded";
      label.textColor = [UIColor colorWithRed:0x8B / 255.0 green:0x95 / 255.0 blue:0xA7 / 255.0 alpha:1];
      label.textAlignment = NSTextAlignmentCenter;
      [_cover addSubview:label];
    }
    if (_cover.superview != window) [window addSubview:_cover];
    [window bringSubviewToFront:_cover];
  } else {
    [_cover removeFromSuperview];
  }
}

@end
