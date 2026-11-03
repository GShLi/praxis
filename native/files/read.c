#include "protocol.h"
#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <dirent.h>

static int changed(const struct stat *a, const struct stat *b) {
#ifdef __APPLE__
  return a->st_size != b->st_size || a->st_mtimespec.tv_sec != b->st_mtimespec.tv_sec ||
    a->st_mtimespec.tv_nsec != b->st_mtimespec.tv_nsec || a->st_ctimespec.tv_sec != b->st_ctimespec.tv_sec ||
    a->st_ctimespec.tv_nsec != b->st_ctimespec.tv_nsec;
#else
  return a->st_size != b->st_size || a->st_mtim.tv_sec != b->st_mtim.tv_sec ||
    a->st_mtim.tv_nsec != b->st_mtim.tv_nsec || a->st_ctim.tv_sec != b->st_ctim.tv_sec ||
    a->st_ctim.tv_nsec != b->st_ctim.tv_nsec;
#endif
}
const char *px_read_fd(int fd, unsigned char **data, size_t *length, struct stat *after) {
  struct stat before;
  if (fstat(fd, &before)) return px_errno();
  if (!S_ISREG(before.st_mode)) return "UNSUPPORTED_FILE";
  if (before.st_nlink != 1) return "ACCESS_DENIED";
  if (before.st_size < 0 || before.st_size > PX_LIMIT) return "FILE_TOO_LARGE";
  *data = malloc(PX_LIMIT + 1);
  if (!*data) return "FILE_NATIVE_FAILED";
  *length = 0;
  while (*length <= PX_LIMIT) {
    ssize_t n = read(fd, *data + *length, PX_LIMIT + 1 - *length);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) return px_errno();
    if (n == 0) break;
    *length += (size_t)n;
  }
  if (*length > PX_LIMIT) return "FILE_TOO_LARGE";
  if (fstat(fd, after)) return px_errno();
  if (after->st_nlink != 1 || changed(&before, after)) return "FILE_CHANGED_DURING_READ";
  return NULL;
}
const char *px_read(PxRequest *r) {
  const char *error = NULL;
  char *leaf = NULL;
  int parent = px_parent(r, &leaf, &error);
  if (parent < 0) return error;
  int fd = openat(parent, leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
  if (fd < 0) error = px_errno();
  free(leaf); close(parent);
  unsigned char *data = NULL;
  size_t length = 0;
  struct stat stat;
  if (fd >= 0) { error = px_read_fd(fd, &data, &length, &stat); close(fd); }
  if (!error) {
    char identity[128]; px_identity(&stat, identity, sizeof(identity));
    printf("{\"status\":\"ok\",\"identity\":\"%s\",\"mode\":%u,\"nlink\":1,\"bytes\":%zu}\n",
      identity, (unsigned int)stat.st_mode & 0777, length);
    if (fwrite(data, 1, length, stdout) != length) error = "FILE_NATIVE_FAILED";
  }
  free(data);
  return error;
}
const char *px_list(PxRequest *r) {
  const char *error = NULL;
  char *leaf = NULL;
  int parent = px_parent(r, &leaf, &error);
  if (parent < 0) return error;
  int fd = leaf[0] ? openat(parent, leaf, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK) : dup(parent);
  if (fd < 0) error = px_errno();
  free(leaf); close(parent);
  if (fd < 0) return error;
  DIR *directory = fdopendir(fd);
  if (!directory) { error = px_errno(); close(fd); return error; }
  size_t count = 0;
  int incomplete = 0;
  printf("{\"status\":\"ok\",\"entries\":[");
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(directory);
    if (!entry) { if (errno) incomplete = 1; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (count >= 10000) { incomplete = 1; break; }
    struct stat stat;
    const char *type = "other";
    if (fstatat(fd, entry->d_name, &stat, AT_SYMLINK_NOFOLLOW)) incomplete = 1;
    else type = S_ISREG(stat.st_mode) ? "file" : S_ISDIR(stat.st_mode) ? "directory" : S_ISLNK(stat.st_mode) ? "symlink" : "other";
    if (count++) putchar(',');
    printf("{\"name\":"); px_string(entry->d_name, strlen(entry->d_name));
    printf(",\"type\":\"%s\"}", type);
  }
  closedir(directory);
  printf("],\"incomplete\":%s}\n", incomplete ? "true" : "false");
  return NULL;
}
