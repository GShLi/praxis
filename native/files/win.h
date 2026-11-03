#ifndef PRAXIS_FILES_WIN_H
#define PRAXIS_FILES_WIN_H
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>
#include "protocol.h"
const char *pxw_error(void);
const char *pxw_status(NTSTATUS status);
void pxw_identity(const BY_HANDLE_FILE_INFORMATION *info, char *out, size_t length);
HANDLE pxw_open(HANDLE parent, const char *name, int directory, int create, ACCESS_MASK access, const char **error);
HANDLE pxw_parent(PxRequest *r, char **leaf, const char **error);
const char *pxw_read(HANDLE file, unsigned char **data, size_t *length, BY_HANDLE_FILE_INFORMATION *info);
const char *pxw_rename(HANDLE file, HANDLE parent, const char *leaf, int replace);
#endif
