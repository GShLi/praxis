import { DesktopLoginFields, WebLoginFields } from './LoginFields.tsx';
import { useLoginForm, type LoginSubmit } from './useLoginForm.ts';

export function Login({
  desktop,
  error,
  onSubmit,
}: {
  desktop: boolean;
  error: string;
  onSubmit: LoginSubmit;
}) {
  const form = useLoginForm(onSubmit);
  const message = form.failure || error;
  return (
    <main className="login-page">
      <div className="login-brand">
        <span className="brand-mark">知</span>Praxis
      </div>
      <form className="login-form" onSubmit={(e) => void form.submit(e)} aria-busy={form.busy}>
        <h1>{desktop ? '连接 Praxis' : '欢迎使用知行'}</h1>
        <p>{desktop ? '连接你的账户，开始对话或本地任务。' : '登录后，继续你的思考。'}</p>
        {desktop ? <DesktopLoginFields {...form} /> : <WebLoginFields {...form} />}
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <button className="primary-button" type="submit" disabled={form.busy}>
          {form.busy ? '正在连接…' : desktop ? '连接 Praxis' : '登录'}
        </button>
        <small>账号由你的 Praxis 管理员创建。</small>
      </form>
      <footer>知行合一 · From thought to action</footer>
    </main>
  );
}
