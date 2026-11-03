#include "view.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static PxView *current(void) { return fuse_get_context()->private_data; }
static int attributes(const char *path, struct stat *st, struct fuse_file_info *fi) {
  (void)fi;
  int fd = px_view_open(current(), path, O_PATH);
  if (fd < 0) return -errno;
  int error = fstat(fd, st) ? -errno : 0;
  close(fd);
  /* This first delivery is read-only; writable modes are not implemented. */
  if (!error) st->st_mode &= ~(S_IWUSR | S_IWGRP | S_IWOTH | S_ISUID | S_ISGID);
  return error;
}
static int open_file(const char *path, struct fuse_file_info *fi) {
  if ((fi->flags & O_ACCMODE) != O_RDONLY || (fi->flags & (O_TRUNC | O_CREAT))) return -EROFS;
  int fd = px_view_open(current(), path, O_RDONLY);
  if (fd < 0) return -errno;
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode)) { close(fd); return -EACCES; }
  fi->fh = (uint64_t)fd; fi->direct_io = 1; fi->keep_cache = 0;
  return 0;
}
static int read_file(const char *path, char *buffer, size_t size, off_t offset, struct fuse_file_info *fi) {
  (void)path;
  int fd = (int)fi->fh;
  struct stat st;
  if (!px_view_private_roots_valid(current()) || fstat(fd, &st) || !px_view_stat_ok(current(), &st)) return -EACCES;
  ssize_t count = pread(fd, buffer, size, offset);
  if (count < 0) return -errno;
  return (int)count;
}
static int release_file(const char *path, struct fuse_file_info *fi) {
  (void)path; return close((int)fi->fh) ? -errno : 0;
}
static int open_directory(const char *path, struct fuse_file_info *fi) {
  int fd = px_view_open(current(), path, O_RDONLY | O_DIRECTORY);
  if (fd < 0) return -errno;
  DIR *directory = fdopendir(fd);
  if (!directory) { int error = errno; close(fd); return -error; }
  fi->fh = (uint64_t)(uintptr_t)directory; return 0;
}
static int read_directory(const char *path, void *buffer, fuse_fill_dir_t filler, off_t offset, struct fuse_file_info *fi, enum fuse_readdir_flags flags) {
  (void)flags;
  DIR *directory = (DIR *)(uintptr_t)fi->fh;
  seekdir(directory, offset);
  while (1) {
    errno = 0;
    struct dirent *entry = readdir(directory);
    if (!entry) return -errno;
    if (!px_view_component(entry->d_name)) continue;
    char child[4098];
    int length = snprintf(child, sizeof(child), "%s%s%s", path, !strcmp(path, "/") ? "" : "/", entry->d_name);
    if (length < 0 || (size_t)length >= sizeof(child)) continue;
    int fd = px_view_open(current(), child, O_PATH);
    if (fd < 0) continue;
    struct stat st;
    int valid = fstat(fd, &st) == 0;
    close(fd);
    if (valid && filler(buffer, entry->d_name, NULL, telldir(directory), 0)) break;
  }
  return 0;
}
static int release_directory(const char *path, struct fuse_file_info *fi) {
  (void)path;
  return closedir((DIR *)(uintptr_t)fi->fh) ? -errno : 0;
}
static void *initialize(struct fuse_conn_info *connection, struct fuse_config *config) {
  (void)connection;
  config->entry_timeout = 0; config->attr_timeout = 0; config->negative_timeout = 0;
  config->kernel_cache = 0;
  puts("ready"); fflush(stdout);
  return current();
}
const struct fuse_operations px_view_operations = {
  .init = initialize, .getattr = attributes, .open = open_file,
  .read = read_file, .release = release_file, .opendir = open_directory,
  .readdir = read_directory, .releasedir = release_directory,
};
