#include "protocol.h"
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>

static int component_ok(const char *name) {
  return name[0] && strcmp(name, ".") && strcmp(name, "..");
}
static int directory_at(int parent, const char *name) {
  return openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
}
static int root_directory(PxRequest *r, const char **error) {
  const char *root = (const char *)r->fields[PX_ROOT];
  if (root[0] != '/') { *error = "ACCESS_DENIED"; return -1; }
  char *copy = strdup(root + 1), *save = NULL;
  if (!copy) { *error = "FILE_NATIVE_FAILED"; return -1; }
  int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  for (char *part = strtok_r(copy, "/", &save); fd >= 0 && part; part = strtok_r(NULL, "/", &save)) {
    if (!component_ok(part)) { close(fd); fd = -1; *error = "ACCESS_DENIED"; break; }
    int next = directory_at(fd, part);
    if (next < 0) *error = px_errno();
    close(fd);
    fd = next;
  }
  free(copy);
  if (fd < 0) { if (!*error) *error = px_errno(); return -1; }
  struct stat stat;
  char identity[128];
  if (fstat(fd, &stat)) { *error = px_errno(); close(fd); return -1; }
  px_identity(&stat, identity, sizeof(identity));
  if (strcmp(identity, (char *)r->fields[PX_ROOT_ID])) {
    *error = "WORKSPACE_CHANGED"; close(fd); return -1;
  }
  return fd;
}

/* Every lookup is relative to a pinned directory. A renamed ancestor cannot redirect later I/O. */
int px_parent(PxRequest *r, char **leaf, const char **error) {
  const char *relative = (char *)r->fields[PX_PATH];
  if (relative[0] == '/') { *error = "ACCESS_DENIED"; return -1; }
  char *copy = strdup(relative);
  if (!copy) { *error = "FILE_NATIVE_FAILED"; return -1; }
  int fd = root_directory(r, error);
  char *part = copy;
  while (fd >= 0 && strchr(part, '/')) {
    char *slash = strchr(part, '/');
    *slash = 0;
    if (!component_ok(part)) { *error = "ACCESS_DENIED"; break; }
    int next = directory_at(fd, part);
    if (next < 0 && errno == ENOENT && r->flags && r->operation == 3) {
      if (r->created_count >= 256) { *error = "FILE_NATIVE_LIMIT"; break; }
      if (mkdirat(fd, part, 0755) == 0) r->created[r->created_count++] = (size_t)(slash - copy);
      else if (errno != EEXIST) { *error = px_errno(); break; }
      next = directory_at(fd, part);
    }
    if (next < 0) { *error = px_errno(); break; }
    close(fd);
    fd = next;
    part = slash + 1;
  }
  if (fd >= 0 && !*error && !component_ok(part) && !(r->operation == 2 && !part[0])) *error = "ACCESS_DENIED";
  if (fd >= 0 && !*error) {
    *leaf = strdup(part);
    if (!*leaf) *error = "FILE_NATIVE_FAILED";
  }
  free(copy);
  if (*error && fd >= 0) { close(fd); fd = -1; }
  return fd;
}
