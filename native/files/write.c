#include "protocol.h"
#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <sys/random.h>

static const char *verify_previous(PxRequest *r, int parent, const char *leaf) {
  if (r->operation == 3) {
    struct stat stat;
    if (!fstatat(parent, leaf, &stat, AT_SYMLINK_NOFOLLOW)) return "FILE_ALREADY_EXISTS";
    return errno == ENOENT ? NULL : px_errno();
  }
  int fd = openat(parent, leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
  if (fd < 0) return px_errno();
  struct stat stat;
  unsigned char *data = NULL;
  size_t length = 0;
  const char *error = px_read_fd(fd, &data, &length, &stat);
  close(fd);
  if (!error) {
    char identity[128]; px_identity(&stat, identity, sizeof(identity));
    if (strcmp(identity, (char *)r->fields[PX_BEFORE_ID]) || length != r->lengths[PX_BEFORE] ||
        memcmp(data, r->fields[PX_BEFORE], length)) error = "FILE_VERSION_CONFLICT";
  }
  free(data);
  return error;
}
static const char *write_all(int fd, const unsigned char *data, size_t length) {
  while (length) {
    ssize_t amount = write(fd, data, length);
    if (amount < 0 && errno == EINTR) continue;
    if (amount <= 0) return "FILE_NATIVE_FAILED";
    data += amount;
    length -= (size_t)amount;
  }
  return fsync(fd) ? "FILE_NATIVE_FAILED" : NULL;
}
static int temporary_file(int parent, char *name, size_t capacity) {
  unsigned char random[16];
  if (getentropy(random, sizeof(random))) return -1;
  size_t offset = (size_t)snprintf(name, capacity, ".praxis-");
  for (size_t i = 0; i < sizeof(random); i++) offset += (size_t)snprintf(name + offset, capacity - offset, "%02x", random[i]);
  snprintf(name + offset, capacity - offset, ".tmp");
  return openat(parent, name, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0600);
}
static const char *publish(PxRequest *r, int parent, int temporary, const char *name, const char *leaf) {
  const char *error = verify_previous(r, parent, leaf);
  if (error) return error;
  struct stat handle, named;
  if (fstat(temporary, &handle) || fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW)) return px_errno();
  if (handle.st_ino != named.st_ino || handle.st_dev != named.st_dev || named.st_nlink != 1) return "FILE_VERSION_CONFLICT";
  if (fchmod(temporary, r->mode)) return px_errno();
  if (r->operation == 3) {
    if (linkat(parent, name, parent, leaf, 0)) return px_errno();
  } else if (renameat(parent, name, parent, leaf)) return px_errno();
  return NULL;
}
const char *px_write(PxRequest *r) {
  const char *error = NULL;
  char *leaf = NULL;
  int parent = px_parent(r, &leaf, &error);
  if (parent < 0) return error;
  error = verify_previous(r, parent, leaf);
  char temporary[80] = {0};
  int fd = -1;
  if (!error) {
    fd = temporary_file(parent, temporary, sizeof(temporary));
    if (fd < 0) error = px_errno();
  }
  if (!error) error = write_all(fd, r->fields[PX_CONTENT], r->lengths[PX_CONTENT]);
  if (!error) error = px_await_commit();
  if (!error) error = publish(r, parent, fd, temporary, leaf);
  if (fd >= 0) {
    close(fd);
    if (unlinkat(parent, temporary, 0) && errno != ENOENT) error = "FILE_CLEANUP_FAILED";
  }
  free(leaf); close(parent);
  if (!error) px_write_result(r);
  return error;
}
