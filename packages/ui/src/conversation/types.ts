export const statusText: Record<string, string> = {
  idle: '就绪',
  running: '正在执行',
  waiting_input: '等待你的回答',
  waiting_approval: '等待批准',
  cancelling: '正在停止',
  completed: '已完成',
  failed: '执行失败',
  interrupted: '已中断',
  cancelled: '已停止',
};

export type Question = {
  questionId: string;
  turnId: string;
  questions: Array<{ id: string; prompt: string; options?: Array<{ id: string; label: string }> }>;
};
