/* Fixed file operations only. There is no shell, plugin loader, network or user code in this helper. */
#include "protocol.h"
#include <stdio.h>
#include <signal.h>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

int main(void) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#else
  signal(SIGPIPE, SIG_IGN);
#endif
  PxRequest request = {0};
  const char *error = px_request(&request);
  if (!error) {
    switch (request.operation) {
      case 1: error = px_read(&request); break;
      case 2: error = px_list(&request); break;
      default: error = px_write(&request); break;
    }
  }
  if (error) printf("{\"status\":\"error\",\"code\":\"%s\"}\n", error);
  px_release(&request);
  return error || fflush(stdout) ? 1 : 0;
}
