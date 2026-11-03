#include "win.h"
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

static HANDLE root_directory(PxRequest *r, const char **error) {
  const char *root = (char *)r->fields[PX_ROOT];
  if (strlen(root) < 3 || !isalpha((unsigned char)root[0]) || root[1] != ':' || (root[2] != '\\' && root[2] != '/')) {
    *error = "ACCESS_DENIED"; return INVALID_HANDLE_VALUE;
  }
  WCHAR drive[] = { (WCHAR)root[0], L':', L'\\', 0 };
  HANDLE current = CreateFileW(drive, FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (current == INVALID_HANDLE_VALUE) { *error = pxw_error(); return current; }
  char *copy = _strdup(root + 3), *save = NULL;
  if (!copy) { CloseHandle(current); *error = "FILE_NATIVE_FAILED"; return INVALID_HANDLE_VALUE; }
  for (char *part = strtok_s(copy, "/\\", &save); part; part = strtok_s(NULL, "/\\", &save)) {
    HANDLE next = pxw_open(current, part, 1, 0, FILE_LIST_DIRECTORY | FILE_TRAVERSE, error);
    CloseHandle(current); current = next;
    if (current == INVALID_HANDLE_VALUE) break;
  }
  free(copy);
  if (current == INVALID_HANDLE_VALUE) return current;
  BY_HANDLE_FILE_INFORMATION info;
  if (!GetFileInformationByHandle(current, &info)) *error = pxw_error();
  else {
    char identity[128]; pxw_identity(&info, identity, sizeof(identity));
    if (strcmp(identity, (char *)r->fields[PX_ROOT_ID])) *error = "WORKSPACE_CHANGED";
  }
  if (*error) { CloseHandle(current); return INVALID_HANDLE_VALUE; }
  return current;
}
HANDLE pxw_parent(PxRequest *r, char **leaf, const char **error) {
  char *copy = _strdup((char *)r->fields[PX_PATH]);
  if (!copy) { *error = "FILE_NATIVE_FAILED"; return INVALID_HANDLE_VALUE; }
  HANDLE current = root_directory(r, error);
  char *part = copy;
  while (current != INVALID_HANDLE_VALUE && strchr(part, '/')) {
    char *slash = strchr(part, '/'); *slash = 0;
    HANDLE next = pxw_open(current, part, 1, 0, FILE_LIST_DIRECTORY | FILE_TRAVERSE, error);
    if (next == INVALID_HANDLE_VALUE && !strcmp(*error, "FILE_NOT_FOUND") && r->flags && r->operation == 3) {
      if (r->created_count >= 256) { *error = "FILE_NATIVE_LIMIT"; break; }
      *error = NULL;
      next = pxw_open(current, part, 1, 1, FILE_LIST_DIRECTORY | FILE_TRAVERSE, error);
      if (next != INVALID_HANDLE_VALUE) r->created[r->created_count++] = (size_t)(slash - copy);
      else if (!strcmp(*error, "FILE_ALREADY_EXISTS")) {
        *error = NULL; next = pxw_open(current, part, 1, 0, FILE_LIST_DIRECTORY | FILE_TRAVERSE, error);
      }
    }
    if (next == INVALID_HANDLE_VALUE) break;
    CloseHandle(current); current = next; part = slash + 1;
  }
  if (current != INVALID_HANDLE_VALUE && !*error) {
    *leaf = _strdup(part);
    if (!*leaf) *error = "FILE_NATIVE_FAILED";
  }
  free(copy);
  if (*error && current != INVALID_HANDLE_VALUE) { CloseHandle(current); current = INVALID_HANDLE_VALUE; }
  return current;
}
