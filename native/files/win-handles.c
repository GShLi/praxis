#include "win.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <inttypes.h>

const char *pxw_error(void) {
  switch (GetLastError()) {
    case ERROR_FILE_NOT_FOUND: case ERROR_PATH_NOT_FOUND: return "FILE_NOT_FOUND";
    case ERROR_FILE_EXISTS: case ERROR_ALREADY_EXISTS: return "FILE_ALREADY_EXISTS";
    case ERROR_ACCESS_DENIED: case ERROR_SHARING_VIOLATION: case ERROR_CANT_ACCESS_FILE: return "ACCESS_DENIED";
    default: return "FILE_NATIVE_FAILED";
  }
}
const char *pxw_status(NTSTATUS status) {
  typedef ULONG (NTAPI *Convert)(NTSTATUS);
  Convert convert = (Convert)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlNtStatusToDosError");
  if (!convert) return "FILE_NATIVE_UNAVAILABLE";
  SetLastError(convert(status));
  return pxw_error();
}
void pxw_identity(const BY_HANDLE_FILE_INFORMATION *info, char *out, size_t length) {
  uint64_t inode = ((uint64_t)info->nFileIndexHigh << 32) | info->nFileIndexLow;
  snprintf(out, length, "%" PRIu32 ":%" PRIu64, (uint32_t)info->dwVolumeSerialNumber, inode);
}
static const char *check_name(HANDLE file, const WCHAR *name) {
  BY_HANDLE_FILE_INFORMATION info;
  if (!GetFileInformationByHandle(file, &info)) return pxw_error();
  if (GetFileType(file) != FILE_TYPE_DISK || (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) return "ACCESS_DENIED";
  WCHAR normalized[32768];
  DWORD length = GetFinalPathNameByHandleW(file, normalized, 32768, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (!length || length >= 32768) return "ACCESS_DENIED";
  WCHAR *last = wcsrchr(normalized, L'\\');
  if (!last || CompareStringOrdinal(last + 1, -1, name, -1, TRUE) != CSTR_EQUAL) return "ACCESS_DENIED";
  return NULL;
}
HANDLE pxw_open(HANDLE parent, const char *name, int directory, int create, ACCESS_MASK access, const char **error) {
  typedef NTSTATUS (NTAPI *Create)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK,
    PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
  Create create_file = (Create)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtCreateFile");
  if (!create_file) { *error = "FILE_NATIVE_UNAVAILABLE"; return INVALID_HANDLE_VALUE; }
  WCHAR wide[4096];
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, name, -1, wide, 4096);
  if (length < 2 || !strcmp(name, ".") || !strcmp(name, "..") || strpbrk(name, "/\\:")) {
    *error = "ACCESS_DENIED"; return INVALID_HANDLE_VALUE;
  }
  UNICODE_STRING string = { (USHORT)((length - 1) * sizeof(WCHAR)), (USHORT)(length * sizeof(WCHAR)), wide };
  OBJECT_ATTRIBUTES attributes = { sizeof(attributes), parent, &string, 0x40 /* OBJ_CASE_INSENSITIVE */, NULL, NULL };
  IO_STATUS_BLOCK status;
  HANDLE file = INVALID_HANDLE_VALUE;
  ULONG options = 0x00200000 /* FILE_OPEN_REPARSE_POINT */ | 0x20 /* SYNCHRONOUS_IO_NONALERT */ |
    (directory ? 1 /* DIRECTORY_FILE */ : 0x40 /* NON_DIRECTORY_FILE */);
  NTSTATUS result = create_file(&file, access | SYNCHRONIZE | FILE_READ_ATTRIBUTES, &attributes, &status,
    NULL, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ | FILE_SHARE_WRITE, create ? 2 : 1, options, NULL, 0);
  if (result < 0) { *error = pxw_status(result); return INVALID_HANDLE_VALUE; }
  *error = check_name(file, wide);
  if (*error) { CloseHandle(file); return INVALID_HANDLE_VALUE; }
  return file;
}
const char *pxw_rename(HANDLE file, HANDLE parent, const char *leaf, int replace) {
  typedef NTSTATUS (NTAPI *SetInfo)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, FILE_INFORMATION_CLASS);
  typedef struct { BOOLEAN replace; HANDLE root; ULONG length; WCHAR name[1]; } Rename;
  SetInfo set_info = (SetInfo)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtSetInformationFile");
  if (!set_info) return "FILE_NATIVE_UNAVAILABLE";
  WCHAR wide[4096];
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, leaf, -1, wide, 4096);
  if (length < 2) return "ACCESS_DENIED";
  size_t bytes = offsetof(Rename, name) + (size_t)(length - 1) * sizeof(WCHAR);
  Rename *rename = calloc(1, bytes);
  if (!rename) return "FILE_NATIVE_FAILED";
  rename->replace = (BOOLEAN)replace; rename->root = parent; rename->length = (ULONG)((length - 1) * sizeof(WCHAR));
  memcpy(rename->name, wide, rename->length);
  IO_STATUS_BLOCK status;
  NTSTATUS result = set_info(file, &status, rename, (ULONG)bytes, (FILE_INFORMATION_CLASS)10 /* FileRenameInformation */);
  free(rename);
  return result < 0 ? pxw_status(result) : NULL;
}
