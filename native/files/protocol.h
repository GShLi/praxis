#ifndef PRAXIS_FILES_PROTOCOL_H
#define PRAXIS_FILES_PROTOCOL_H
#include <sys/stat.h>
#include <stdint.h>
#include <stddef.h>

#define PX_LIMIT (2u * 1024u * 1024u)
#define PX_PATH_LIMIT 4096u
enum { PX_ROOT, PX_PATH, PX_ROOT_ID, PX_BEFORE_ID, PX_BEFORE, PX_CONTENT, PX_FIELDS };
typedef struct {
  uint32_t operation, flags, mode, lengths[PX_FIELDS];
  unsigned char *fields[PX_FIELDS];
  size_t created[256], created_count;
} PxRequest;
const char *px_request(PxRequest *request);
void px_release(PxRequest *request);
const char *px_errno(void);
void px_string(const char *text, size_t length);
void px_identity(const struct stat *stat, char *out, size_t length);
const char *px_await_commit(void);
void px_write_result(PxRequest *request);
int px_parent(PxRequest *request, char **leaf, const char **error);
const char *px_read_fd(int fd, unsigned char **data, size_t *length, struct stat *stat);
const char *px_read(PxRequest *request);
const char *px_list(PxRequest *request);
const char *px_write(PxRequest *request);
#endif
