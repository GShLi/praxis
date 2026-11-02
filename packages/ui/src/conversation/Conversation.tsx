import type { AppController } from '../app/useAppController.ts';
import { MessageList } from '../conversation/MessageList.tsx';

export function Conversation({
  client,
  providerId,
  kind,
  selected,
  snapshot,
  partial,
  error,
  setError,
  setLoadAttempt,
  question,
  setQuestion,
  setFollow,
  scroll,
  fail,
  running,
  showChange,
  loadingSession,
  empty,
}: Pick<
  AppController,
  | 'client'
  | 'providerId'
  | 'kind'
  | 'selected'
  | 'snapshot'
  | 'partial'
  | 'error'
  | 'setError'
  | 'setLoadAttempt'
  | 'question'
  | 'setQuestion'
  | 'setFollow'
  | 'scroll'
  | 'fail'
  | 'running'
  | 'showChange'
  | 'loadingSession'
  | 'empty'
>) {
  return (
    <div
      className={`conversation ${!snapshot?.messages.length ? 'is-empty' : ''}`}
      ref={scroll}
      onScroll={() => {
        const element = scroll.current;
        if (element)
          setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 80);
      }}
    >
      {loadingSession ? (
        <p className="session-loading" role="status">
          {error ? (
            <>
              会话暂时无法加载。
              <button
                className="text-button"
                onClick={() => {
                  setError('');
                  setLoadAttempt((value) => value + 1);
                }}
              >
                重试
              </button>
            </>
          ) : (
            '正在加载对话…'
          )}
        </p>
      ) : empty ? (
        <div className="welcome">
          <h1>{kind === 'agent' ? '你想完成什么任务？' : '我能帮你做些什么？'}</h1>
        </div>
      ) : (
        <MessageList
          client={client}
          providerId={providerId}
          selected={selected}
          snapshot={snapshot}
          partial={partial}
          question={question}
          setQuestion={setQuestion}
          fail={fail}
          running={running}
          showChange={showChange}
        />
      )}
    </div>
  );
}
