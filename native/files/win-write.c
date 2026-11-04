#include "win.h"
#include <bcrypt.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

static const char *verify_previous(PxRequest *r, HANDLE parent, const char *leaf) {
  const char *error = NULL;
  HANDLE file = pxw_open(parent, leaf, 0, 0, FILE_READ_DATA, &error);
  if (r->operation == 3) {
    if (file != INVALID_HANDLE_VALUE) { CloseHandle(file); return "FILE_ALREADY_EXISTS"; }
    return !strcmp(error, "FILE_NOT_FOUND") ? NULL : error;
  }
  if (file == INVALID_HANDLE_VALUE) return error;
  unsigned char *data = NULL;
  size_t length = 0;
  BY_HANDLE_FILE_INFORMATION info;
  error = pxw_read(file, &data, &length, &info);
  CloseHandle(file);
  if (!error) {
    char identity[128]; pxw_identity(&info, identity, sizeof(identity));
    if (strcmp(identity, (char *)r->fields[PX_BEFORE_ID]) || length != r->lengths[PX_BEFORE] ||
        memcmp(data, r->fields[PX_BEFORE], length)) error = "FILE_VERSION_CONFLICT";
  }
  free(data);
  return error;
}
static HANDLE temporary_file(HANDLE parent, const char **error) {
  unsigned char random[16];
  if (BCryptGenRandom(NULL, random, sizeof(random), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) {
    *error = "FILE_NATIVE_FAILED"; return INVALID_HANDLE_VALUE;
  }
  char name[80];
  size_t offset = (size_t)snprintf(name, sizeof(name), ".praxis-");
  for (size_t i = 0; i < sizeof(random); i++) offset += (size_t)snprintf(name + offset, sizeof(name) - offset, "%02x", random[i]);
  snprintf(name + offset, sizeof(name) - offset, ".tmp");
  return pxw_open(parent, name, 0, 1, FILE_WRITE_DATA | DELETE, error);
}
static const char *write_all(HANDLE file, const unsigned char *data, size_t length) {
  while (length) {
    DWORD amount = 0;
    if (!WriteFile(file, data, (DWORD)length, &amount, NULL) || !amount) return "FILE_NATIVE_FAILED";
    data += amount; length -= amount;
  }
  return FlushFileBuffers(file) ? NULL : "FILE_NATIVE_FAILED";
}
static const char *delete_when_closed(HANDLE file, BOOLEAN enabled) {
  FILE_DISPOSITION_INFO disposition = { enabled };
  return SetFileInformationByHandle(file, FileDispositionInfo, &disposition, sizeof(disposition))
    ? NULL : "FILE_CLEANUP_FAILED";
}
const char *px_write(PxRequest *r) {
  const char *error = NULL;
  char *leaf = NULL;
  HANDLE parent = pxw_parent(r, &leaf, &error);
  if (parent == INVALID_HANDLE_VALUE) return error;
  error = verify_previous(r, parent, leaf);
  HANDLE temporary = INVALID_HANDLE_VALUE;
  int published = 0;
  if (!error) temporary = temporary_file(parent, &error);
  if (!error) error = write_all(temporary, r->fields[PX_CONTENT], r->lengths[PX_CONTENT]);
  /* A Windows parent Job may terminate this helper before EOF cleanup runs.
     Keep prepared content delete-pending while waiting for explicit commit permission. */
  if (!error) error = delete_when_closed(temporary, TRUE);
  if (!error) error = px_await_commit();
  if (!error) error = delete_when_closed(temporary, FALSE);
  if (!error) error = verify_previous(r, parent, leaf);
  if (!error) { error = pxw_rename(temporary, parent, leaf, r->operation == 4); published = !error; }
  if (temporary != INVALID_HANDLE_VALUE) {
    if (!published) {
      const char *cleanup = delete_when_closed(temporary, TRUE);
      if (cleanup) error = cleanup;
    }
    CloseHandle(temporary);
  }
  free(leaf); CloseHandle(parent);
  if (!error) px_write_result(r);
  return error;
}
