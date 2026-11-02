/* Holds an OS advisory lock while the private parent pipe remains open.
 * This process never executes user commands. EOF releases the kernel lock. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#else
#include <unistd.h>
#include <sys/file.h>
#include <fcntl.h>
#include <errno.h>
#endif

int main(int argc, char **argv) {
  if (argc != 2 && argc != 3) return 64;
  int shared = argc == 3 && strcmp(argv[2], "shared") == 0;
  if (argc == 3 && !shared) return 64;
#ifdef _WIN32
  wchar_t path[32768];
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, argv[1], -1, path, 32768)) return 65;
  HANDLE file = CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
    NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (file == INVALID_HANDLE_VALUE) return 66;
  BY_HANDLE_FILE_INFORMATION info;
  if (!GetFileInformationByHandle(file, &info) || (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) { CloseHandle(file); return 66; }
  OVERLAPPED overlap = {0};
  if (!LockFileEx(file, (shared ? 0 : LOCKFILE_EXCLUSIVE_LOCK) | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlap)) { CloseHandle(file); return 73; }
  _setmode(_fileno(stdin), _O_BINARY);
#else
  int file = open(argv[1], O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (file < 0) return 66;
  if (flock(file, (shared ? LOCK_SH : LOCK_EX) | LOCK_NB) != 0) { close(file); return 73; }
#endif
  puts("{\"locked\":true}"); fflush(stdout);
  char buffer[64];
#ifdef _WIN32
  while (_read(_fileno(stdin), buffer, sizeof(buffer)) > 0) {}
  CloseHandle(file);
#else
  ssize_t amount;
  do { amount = read(STDIN_FILENO, buffer, sizeof(buffer)); } while (amount > 0 || (amount < 0 && errno == EINTR));
  close(file);
#endif
  return 0;
}
