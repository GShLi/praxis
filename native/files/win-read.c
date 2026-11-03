#include "win.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

const char *pxw_read(HANDLE file, unsigned char **data, size_t *length, BY_HANDLE_FILE_INFORMATION *after) {
  BY_HANDLE_FILE_INFORMATION before;
  FILE_BASIC_INFO first, last;
  if (!GetFileInformationByHandle(file, &before) || !GetFileInformationByHandleEx(file, FileBasicInfo, &first, sizeof(first))) return pxw_error();
  if ((before.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) || GetFileType(file) != FILE_TYPE_DISK) return "UNSUPPORTED_FILE";
  if (before.nNumberOfLinks != 1) return "ACCESS_DENIED";
  if (before.nFileSizeHigh || before.nFileSizeLow > PX_LIMIT) return "FILE_TOO_LARGE";
  *data = malloc(PX_LIMIT + 1);
  if (!*data) return "FILE_NATIVE_FAILED";
  *length = 0;
  while (*length <= PX_LIMIT) {
    DWORD amount = 0;
    if (!ReadFile(file, *data + *length, (DWORD)(PX_LIMIT + 1 - *length), &amount, NULL)) return pxw_error();
    if (!amount) break;
    *length += amount;
  }
  if (*length > PX_LIMIT) return "FILE_TOO_LARGE";
  if (!GetFileInformationByHandle(file, after) || !GetFileInformationByHandleEx(file, FileBasicInfo, &last, sizeof(last))) return pxw_error();
  if (after->nNumberOfLinks != 1 || before.nFileSizeLow != after->nFileSizeLow || before.nFileSizeHigh != after->nFileSizeHigh ||
      first.LastWriteTime.QuadPart != last.LastWriteTime.QuadPart || first.ChangeTime.QuadPart != last.ChangeTime.QuadPart) return "FILE_CHANGED_DURING_READ";
  return NULL;
}
const char *px_read(PxRequest *r) {
  const char *error = NULL;
  char *leaf = NULL;
  HANDLE parent = pxw_parent(r, &leaf, &error);
  if (parent == INVALID_HANDLE_VALUE) return error;
  HANDLE file = pxw_open(parent, leaf, 0, 0, FILE_READ_DATA, &error);
  free(leaf); CloseHandle(parent);
  unsigned char *data = NULL;
  size_t length = 0;
  BY_HANDLE_FILE_INFORMATION info;
  if (file != INVALID_HANDLE_VALUE) { error = pxw_read(file, &data, &length, &info); CloseHandle(file); }
  if (!error) {
    char identity[128]; pxw_identity(&info, identity, sizeof(identity));
    printf("{\"status\":\"ok\",\"identity\":\"%s\",\"mode\":%u,\"nlink\":1,\"bytes\":%zu}\n",
      identity, (info.dwFileAttributes & FILE_ATTRIBUTE_READONLY) ? 0444u : 0666u, length);
    if (fwrite(data, 1, length, stdout) != length) error = "FILE_NATIVE_FAILED";
  }
  free(data);
  return error;
}
static int print_entry(FILE_ID_BOTH_DIR_INFO *entry, size_t *count) {
  char name[4096];
  int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, entry->FileName,
    (int)(entry->FileNameLength / sizeof(WCHAR)), name, sizeof(name) - 1, NULL, NULL);
  if (length <= 0) return -1;
  name[length] = 0;
  if (!strcmp(name, ".") || !strcmp(name, "..")) return 0;
  if (*count >= 10000) return -1;
  if ((*count)++) putchar(',');
  printf("{\"name\":"); px_string(name, (size_t)length);
  const char *type = (entry->FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ? "symlink" :
    (entry->FileAttributes & FILE_ATTRIBUTE_DIRECTORY) ? "directory" : "file";
  printf(",\"type\":\"%s\"}", type);
  return 0;
}
const char *px_list(PxRequest *r) {
  const char *error = NULL;
  char *leaf = NULL;
  HANDLE parent = pxw_parent(r, &leaf, &error);
  if (parent == INVALID_HANDLE_VALUE) return error;
  HANDLE directory = parent;
  if (leaf[0]) { directory = pxw_open(parent, leaf, 1, 0, FILE_LIST_DIRECTORY, &error); CloseHandle(parent); }
  free(leaf);
  if (directory == INVALID_HANDLE_VALUE) return error;
  unsigned char *buffer = malloc(65536);
  if (!buffer) { CloseHandle(directory); return "FILE_NATIVE_FAILED"; }
  size_t count = 0;
  int incomplete = 0, first = 1;
  printf("{\"status\":\"ok\",\"entries\":[");
  for (;;) {
    if (!GetFileInformationByHandleEx(directory, first ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo, buffer, 65536)) {
      if (GetLastError() != ERROR_NO_MORE_FILES) incomplete = 1;
      break;
    }
    first = 0;
    size_t offset = 0;
    for (;;) {
      if (offset > 65536 - offsetof(FILE_ID_BOTH_DIR_INFO, FileName)) { incomplete = 1; break; }
      FILE_ID_BOTH_DIR_INFO *entry = (FILE_ID_BOTH_DIR_INFO *)(buffer + offset);
      if (entry->FileNameLength > 65536 - offset - offsetof(FILE_ID_BOTH_DIR_INFO, FileName) ||
          entry->FileNameLength % sizeof(WCHAR) || print_entry(entry, &count)) { incomplete = 1; break; }
      if (!entry->NextEntryOffset) break;
      if (entry->NextEntryOffset < offsetof(FILE_ID_BOTH_DIR_INFO, FileName)) { incomplete = 1; break; }
      offset += entry->NextEntryOffset;
    }
    if (incomplete) break;
  }
  free(buffer); CloseHandle(directory);
  printf("],\"incomplete\":%s}\n", incomplete ? "true" : "false");
  return NULL;
}
