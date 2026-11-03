#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>
#include <stdio.h>
#include <string.h>

/* Only the trusted Host calls this helper. Secrets never appear in argv or stderr. */
static bool valid_key(const char *key) {
  if (strlen(key) != 64) return false;
  for (int i = 0; i < 64; ++i)
    if (!((key[i] >= 'a' && key[i] <= 'f') || (key[i] >= '0' && key[i] <= '9'))) return false;
  return true;
}

static int operate(const char *action, NSString *account) {
  LAContext *context = [[LAContext alloc] init];
  context.interactionNotAllowed = YES;
  NSMutableDictionary *query = [@{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: @"ai.praxis.mcp",
    (__bridge id)kSecAttrAccount: account,
    (__bridge id)kSecUseAuthenticationContext: context
  } mutableCopy];
  OSStatus status;
  if (strcmp(action, "get") == 0) {
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecSuccess && result && CFGetTypeID(result) == CFDataGetTypeID()) {
      CFDataRef data = (CFDataRef)result;
      CFIndex size = CFDataGetLength(data);
      if (size > 65536 || fwrite(CFDataGetBytePtr(data), 1, (size_t)size, stdout) != (size_t)size) status = errSecIO;
    } else if (status == errSecSuccess) status = errSecDecode;
    if (result) CFRelease(result);
  } else if (strcmp(action, "set") == 0) {
    unsigned char buffer[65537];
    size_t length = fread(buffer, 1, sizeof(buffer), stdin);
    if (ferror(stdin) || length == 0 || length > 65536) return 64;
    NSData *data = [NSData dataWithBytes:buffer length:length];
    volatile unsigned char *wipe = buffer;
    for (size_t i = 0; i < sizeof(buffer); ++i) wipe[i] = 0;
    NSMutableDictionary *attributes = [query mutableCopy];
    attributes[(__bridge id)kSecValueData] = data;
    attributes[(__bridge id)kSecAttrLabel] = @"Praxis MCP";
    status = SecItemAdd((__bridge CFDictionaryRef)attributes, NULL);
    if (status == errSecDuplicateItem) {
      NSDictionary *update = @{(__bridge id)kSecValueData: data};
      status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)update);
    }
  } else if (strcmp(action, "delete") == 0) {
    status = SecItemDelete((__bridge CFDictionaryRef)query);
  } else return 64;
  if (status == errSecItemNotFound) return 44;
  return status == errSecSuccess ? 0 : 69;
}

int main(int argc, const char **argv) {
  if (argc != 3 || !valid_key(argv[2])) return 64;
  /* Classic Keychain and modern authentication contexts must both remain noninteractive. */
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  SecKeychainSetUserInteractionAllowed(false);
#pragma clang diagnostic pop
  @autoreleasepool {
    return operate(argv[1], [NSString stringWithUTF8String:argv[2]]);
  }
}
