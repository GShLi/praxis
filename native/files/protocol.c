#include "protocol.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#ifdef _WIN32
#include <io.h>
#define PX_READ(buffer, length) _read(_fileno(stdin), buffer, (unsigned int)(length))
#else
#include <unistd.h>
#define PX_READ(buffer, length) read(STDIN_FILENO, buffer, length)
#endif
#include <inttypes.h>

static int read_exact(void *buffer, size_t length) {
  unsigned char *position = buffer;
  while (length) {
    ptrdiff_t amount = PX_READ(position, length);
    if (amount < 0 && errno == EINTR) continue;
    if (amount <= 0) return -1;
    position += amount;
    length -= (size_t)amount;
  }
  return 0;
}
static uint32_t little(const unsigned char *value) {
  return (uint32_t)value[0] | ((uint32_t)value[1] << 8) |
    ((uint32_t)value[2] << 16) | ((uint32_t)value[3] << 24);
}
const char *px_request(PxRequest *r) {
  unsigned char header[44];
  if (read_exact(header, sizeof(header)) || memcmp(header, "PXFSv001", 8)) return "FILE_NATIVE_PROTOCOL";
  r->operation = little(header + 8);
  r->flags = little(header + 12);
  r->mode = little(header + 16);
  if (r->operation < 1 || r->operation > 4 || r->flags > 1 || r->mode > 0777) return "FILE_NATIVE_PROTOCOL";
  for (size_t i = 0; i < PX_FIELDS; i++) {
    uint32_t length = little(header + 20 + i * 4);
    if (length > (i < PX_BEFORE ? PX_PATH_LIMIT : PX_LIMIT)) return "FILE_NATIVE_PROTOCOL";
    r->lengths[i] = length;
    r->fields[i] = calloc((size_t)length + 1, 1);
    if (!r->fields[i]) return "FILE_NATIVE_FAILED";
    if (read_exact(r->fields[i], length)) return "FILE_CANCELLED";
    if (i < PX_BEFORE && memchr(r->fields[i], 0, length)) return "FILE_NATIVE_PROTOCOL";
  }
  return NULL;
}
void px_release(PxRequest *r) {
  for (size_t i = 0; i < PX_FIELDS; i++) free(r->fields[i]);
}
const char *px_await_commit(void) {
  if (printf("{\"status\":\"ready\"}\n") < 0 || fflush(stdout)) return "FILE_CANCELLED";
  unsigned char permission = 0;
  return !read_exact(&permission, 1) && permission == '1' ? NULL : "FILE_CANCELLED";
}
void px_write_result(PxRequest *r) {
  printf("{\"status\":\"ok\",\"createdDirectories\":[");
  for (size_t i = 0; i < r->created_count; i++) {
    if (i) putchar(',');
    px_string((char *)r->fields[PX_PATH], r->created[i]);
  }
  printf("]}\n");
}
const char *px_errno(void) {
  switch (errno) {
    case ENOENT: return "FILE_NOT_FOUND";
    case EEXIST: return "FILE_ALREADY_EXISTS";
#ifdef ELOOP
    case ELOOP:
#endif
    case ENOTDIR: case EACCES: case EPERM: return "ACCESS_DENIED";
    default: return "FILE_NATIVE_FAILED";
  }
}
void px_string(const char *text, size_t length) {
  putchar('"');
  for (size_t i = 0; i < length; i++) {
    unsigned char ch = (unsigned char)text[i];
    if (ch == '"' || ch == '\\') { putchar('\\'); putchar(ch); }
    else if (ch < 32) printf("\\u%04x", ch);
    else putchar(ch);
  }
  putchar('"');
}
#ifndef _WIN32
void px_identity(const struct stat *stat, char *out, size_t length) {
  snprintf(out, length, "%" PRIuMAX ":%" PRIuMAX, (uintmax_t)stat->st_dev, (uintmax_t)stat->st_ino);
}
#endif
