#ifndef PRAXIS_WORKSPACE_VIEW_H
#define PRAXIS_WORKSPACE_VIEW_H
#define _GNU_SOURCE
#define FUSE_USE_VERSION 31
#define _FILE_OFFSET_BITS 64
#include <fuse.h>
#include <sys/stat.h>

typedef struct {
  int root;
  struct stat identity;
  struct stat denied[64];
  const char *denied_paths[64];
  size_t denied_count;
} PxView;

int px_view_component(const char *name);
int px_view_open(PxView *view, const char *path, int flags);
int px_view_stat_ok(PxView *view, const struct stat *st);
int px_view_private_roots_valid(PxView *view);
int px_view_root(const char *path, const char *identity, PxView *view);
extern const struct fuse_operations px_view_operations;
#endif
