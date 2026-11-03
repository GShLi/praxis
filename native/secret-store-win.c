#include <windows.h>
#include <wincred.h>
#include <stdio.h>
#include <string.h>
#include <fcntl.h>
#include <io.h>

/* Fixed local Credential Manager namespace; no secret values in command arguments. */
static int valid_key(const char *key) {
  if (strlen(key) != 64) return 0;
  for (int i = 0; i < 64; ++i)
    if (!((key[i] >= 'a' && key[i] <= 'f') || (key[i] >= '0' && key[i] <= '9'))) return 0;
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 3 || !valid_key(argv[2])) return 64;
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  char target[96];
  if (sprintf_s(target, sizeof(target), "Praxis/MCP/%s", argv[2]) < 0) return 64;
  if (strcmp(argv[1], "get") == 0) {
    PCREDENTIALA credential = NULL;
    if (!CredReadA(target, CRED_TYPE_GENERIC, 0, &credential))
      return GetLastError() == ERROR_NOT_FOUND ? 44 : 69;
    size_t size = credential->CredentialBlobSize;
    int result = fwrite(credential->CredentialBlob, 1, size, stdout) == size ? 0 : 69;
    CredFree(credential);
    return result;
  }
  if (strcmp(argv[1], "delete") == 0) {
    if (CredDeleteA(target, CRED_TYPE_GENERIC, 0)) return 0;
    return GetLastError() == ERROR_NOT_FOUND ? 44 : 69;
  }
  if (strcmp(argv[1], "set") != 0) return 64;
  unsigned char secret[CRED_MAX_CREDENTIAL_BLOB_SIZE + 1];
  size_t size = fread(secret, 1, sizeof(secret), stdin);
  if (ferror(stdin) || size == 0 || size > CRED_MAX_CREDENTIAL_BLOB_SIZE) {
    SecureZeroMemory(secret, sizeof(secret));
    return 69;
  }
  CREDENTIALA credential = {0};
  credential.Type = CRED_TYPE_GENERIC;
  credential.TargetName = target;
  credential.UserName = "Praxis";
  credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
  credential.CredentialBlob = secret;
  credential.CredentialBlobSize = (DWORD)size;
  int result = CredWriteA(&credential, 0) ? 0 : 69;
  SecureZeroMemory(secret, sizeof(secret));
  return result;
}
