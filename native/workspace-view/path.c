#include "view.h"
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>

int px_view_component(const char *name) {
  static const char *protected[] = {".git", ".hg", ".svn", ".ssh", ".aws", ".gnupg", ".praxis"};
  size_t length = strlen(name);
  if (!length || !strcmp(name, ".") || !strcmp(name, "..") || name[length - 1] == '.' || name[length - 1] == ' ') return 0;
  for (const unsigned char *p = (const unsigned char *)name; *p; p++) if (*p < 32 || *p == ':') return 0;
  for (size_t i = 0; i < sizeof(protected) / sizeof(protected[0]); i++) if (!strcasecmp(name, protected[i])) return 0;
  if (!strncasecmp(name, ".env", 4) && (!name[4] || name[4] == '.')) return 0;
  const char *extension = strrchr(name, '.');
  if (extension && (!strcasecmp(extension, ".pem") || !strcasecmp(extension, ".key") || !strcasecmp(extension, ".p12") || !strcasecmp(extension, ".pfx"))) return 0;
  return 1;
}

int px_view_stat_ok(PxView *view, const struct stat *st) {
  if (st->st_dev != view->identity.st_dev) return 0;
  if (!S_ISDIR(st->st_mode) && (!S_ISREG(st->st_mode) || st->st_nlink != 1)) return 0;
  for (size_t i = 0; i < view->denied_count; i++)
    if (st->st_dev == view->denied[i].st_dev && st->st_ino == view->denied[i].st_ino) return 0;
  return 1;
}

static int allowed_path(PxView *view, const char *path) {
  if (path[0] != '/' || strlen(path) > 4096) return 0;
  for (size_t i = 0; i < view->denied_count; i++) {
    size_t length = strlen(view->denied_paths[i]);
    if (!strncmp(path, view->denied_paths[i], length) && (!path[length] || path[length] == '/')) return 0;
  }
  return 1;
}

/* A configured private root may be replaced between calls. Invalidate visibility
 * instead of trusting an obsolete inode list while new private data is created. */
int px_view_private_roots_valid(PxView *view) {
  for (size_t i = 0; i < view->denied_count; i++) {
    char *copy = strdup(view->denied_paths[i] + 1), *save = NULL;
    if (!copy) return 0;
    int fd = dup(view->root);
    for (char *part = strtok_r(copy, "/", &save); fd >= 0 && part; part = strtok_r(NULL, "/", &save)) {
      int next = openat(fd, part, O_PATH | O_CLOEXEC | O_NOFOLLOW);
      close(fd); fd = next;
      struct stat st;
      if (fd >= 0 && (fstat(fd, &st) || S_ISLNK(st.st_mode))) { close(fd); fd = -1; }
    }
    free(copy);
    if (fd < 0) return 0;
    struct stat st;
    int valid = !fstat(fd, &st) && st.st_dev == view->denied[i].st_dev && st.st_ino == view->denied[i].st_ino;
    close(fd);
    if (!valid) return 0;
  }
  return 1;
}

/* Every component uses a directory capability; no host-side symlink traversal. */
int px_view_open(PxView *view, const char *path, int flags) {
  if (!allowed_path(view, path)) { errno = EACCES; return -1; }
  if (!strcmp(path, "/")) return openat(view->root, ".", flags | O_CLOEXEC | O_NOFOLLOW);
  if (!px_view_private_roots_valid(view)) { errno = EACCES; return -1; }
  char *copy = strdup(path + 1), *part = copy;
  if (!copy) return -1;
  int parent = dup(view->root), result = -1;
  while (parent >= 0) {
    char *slash = strchr(part, '/');
    if (slash) *slash = 0;
    if (!px_view_component(part)) { errno = EACCES; break; }
    int mode = slash ? O_RDONLY | O_DIRECTORY : flags;
    int next = openat(parent, part, mode | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (next < 0) break;
    struct stat st;
    if (fstat(next, &st) || !px_view_stat_ok(view, &st)) { close(next); errno = EACCES; break; }
    close(parent); parent = next;
    if (!slash) { result = parent; parent = -1; break; }
    part = slash + 1;
  }
  int error = errno;
  if (parent >= 0) close(parent);
  free(copy); errno = error; return result;
}

int px_view_root(const char *path, const char *identity, PxView *view) {
  if (path[0] != '/' || !path[1] || strlen(path) > 4096) return -1;
  char *copy = strdup(path + 1), *save = NULL;
  if (!copy) return -1;
  int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  for (char *part = strtok_r(copy, "/", &save); part && fd >= 0; part = strtok_r(NULL, "/", &save)) {
    if (!strcmp(part, ".") || !strcmp(part, "..")) { close(fd); fd = -1; break; }
    int next = openat(fd, part, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    close(fd); fd = next;
  }
  free(copy);
  if (fd < 0) return -1;
  char actual[128];
  if (fstat(fd, &view->identity)) { close(fd); return -1; }
  snprintf(actual, sizeof(actual), "%ju:%ju", (uintmax_t)view->identity.st_dev, (uintmax_t)view->identity.st_ino);
  if (strcmp(actual, identity)) { close(fd); return -1; }
  view->root = fd; return 0;
}
