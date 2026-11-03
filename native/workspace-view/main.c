#include "view.h"
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <unistd.h>

/* Trusted Host entry only. No user command runs in this filesystem process. */
int main(int argc, char **argv) {
  if (argc < 4 || argc > 68) return 64;
  pid_t parent = getppid();
  if (parent <= 1 || prctl(PR_SET_PDEATHSIG, SIGTERM) || getppid() != parent) return 70;
  PxView view = {.root = -1};
  if (px_view_root(argv[1], argv[2], &view)) return 65;
  for (int i = 4; i < argc; i++) {
    if (!strcmp(argv[i], "/")) { close(view.root); return 65; }
    /* Pin explicit private directories before exposing the view, also denying renamed aliases. */
    int fd = px_view_open(&view, argv[i], O_PATH);
    if (fd < 0 || fstat(fd, &view.denied[view.denied_count])) {
      if (fd >= 0) close(fd);
      close(view.root); return 65;
    }
    close(fd);
    view.denied_paths[view.denied_count++] = argv[i];
  }
  char *options[] = {argv[0], "-f", "-s", "-o", "ro,default_permissions,auto_unmount", argv[3]};
  int result = fuse_main(6, options, &px_view_operations, &view);
  close(view.root); return result;
}
