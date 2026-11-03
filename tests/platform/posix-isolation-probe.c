#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

/* Fixed fixture: reports permission outcomes, never file bytes or user input execution. */
static int file_probe(const char *file, int writing) {
  int fd = open(file, writing ? O_WRONLY | O_APPEND : O_RDONLY);
  if (fd < 0) return errno == EACCES || errno == EPERM || errno == EROFS ? 10 : 20;
  char byte = 'x';
  ssize_t result = writing ? write(fd, &byte, 1) : read(fd, &byte, 1);
  int error = errno;
  close(fd);
  return result >= 0 ? 0 : error == EACCES || error == EPERM || error == EROFS ? 10 : 20;
}

static int socket_probe(const char *target, int tcp) {
  int fd = socket(tcp ? AF_INET : AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return errno == EACCES || errno == EPERM ? 10 : 20;
  int result;
  if (tcp) {
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_port = htons((unsigned short)strtoul(target, NULL, 10));
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    result = connect(fd, (struct sockaddr *)&address, sizeof(address));
  } else {
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    if (strlen(target) >= sizeof(address.sun_path)) { close(fd); return 20; }
    strcpy(address.sun_path, target);
    result = connect(fd, (struct sockaddr *)&address, sizeof(address));
  }
  int error = errno;
  close(fd);
  return result == 0 ? 0 : error == EACCES || error == EPERM ? 10 : 20;
}

int main(int argc, char **argv) {
  if (argc != 3) return 64;
  if (strcmp(argv[1], "read") == 0) return file_probe(argv[2], 0);
  if (strcmp(argv[1], "write") == 0) return file_probe(argv[2], 1);
  if (strcmp(argv[1], "tcp") == 0) return socket_probe(argv[2], 1);
  if (strcmp(argv[1], "unix") == 0) return socket_probe(argv[2], 0);
  if (strcmp(argv[1], "child-read") == 0) {
    pid_t child = fork();
    if (child < 0) return 21;
    if (child == 0) { execl(argv[0], argv[0], "read", argv[2], NULL); _exit(22); }
    int status;
    if (waitpid(child, &status, 0) != child || !WIFEXITED(status)) return 23;
    return WEXITSTATUS(status);
  }
  return 64;
}
