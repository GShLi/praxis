# 命令执行实现与验收

基线 `72d2418`。继续已批准的 P1/P4/P6 设计；优先 macOS 与 Linux。本文记录具体接线与证据，不取代原工具和沙箱合同。

## 任务与依赖

1. 有界 UTF-8 stdout/stderr、独立游标、头尾截断和可持久化快照。
2. turn 所有的执行状态机：准备、审批、启动意图、输出、退出、取消、超时、清理、终态。
3. 原生后端：隔离文件视图、环境、网络、系统调用和执行域；普通 Host 不直接启动用户程序。
4. Runtime/CLI/桌面接线与历史恢复；MCP stdio 复用已验证后端。
5. 目标系统和最终场景验收，补齐剩余交付项。

接口预检：输出快照由执行状态机提交；状态机只依赖受控后端，后端返回清理结果后才允许确定终态。Runtime 持有 turn 信号、剩余预算和审批入口；命令服务不能从模型参数恢复授权。未通过隔离合同的后端不装配到 Host。

## 平台调查

- macOS 27.2：Seatbelt 可拒绝 `SYS_setsid`/`SYS_setpgid`，但 `posix_spawn` 的 SETSID/SETPGROUP 属性仍成功创建独立 session/group。固定测试程序无后台残留；[XNU kern_exec.c](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exec.c) 中 spawn 直接进入内核内部设置路径，与实测一致。
- 拒绝 `SYS_posix_spawn` 并返回 ENOSYS 能封闭该入口，但本机 Node 22.15 的 libuv 因 `assert(err != ENOSYS)` 中止；bash fork/exec 仍可运行。该方案不满足 Node/npm 工具链要求，不作为可发布后端。参考 [libuv process.c](https://github.com/libuv/libuv/blob/v1.49.2/src/unix/process.c)。
- Ubuntu 已有 Bubblewrap、slirp4netns 和用户 FUSE 挂载组件；Linux 的独立 PID namespace 已有子孙清理证据，仍需实现完整文件保护和允许联网策略。

## 当前实现

- 已实现 `tools/processes` 的有界 UTF-8 输出、独立游标、头尾截断及显式缺口；每次执行最多保留 20 MiB，块数量同样有界。结束后释放内存，通过本 Session 的产物重新读取。
- `ManagedProcesses` 持有 turn 内执行：预备资源、完整计划单次审批、权限/计划复核、启动意图先落盘、启动回执、取消/超时和终态。输出保存失败触发停止与 fatal 通知；清理未知不会记录为成功，旧执行不会按 PID 恢复或自动重跑。
- 原始输出头部在接收时作为不可变产物事务提交，尾部在终态事务提交。崩溃时未提交的尾部可能丢失；恢复明确返回 `unknown` 和 `outputTruncated`，只提供已提交片段，不声称保存了全部输出。
- Runtime 装配传入真实 turn ID、deadline 和审批门；工具传入实际 call ID。只读模式允许交给只读沙箱执行，文件专用写工具仍受权限限制。运行事实包含活动执行；最终回答前停止并等待命令清理。
- 新增 15 项输出、持久化、生命周期和 Runtime 集成测试。macOS / Ubuntu 各 **239/239** 核心测试通过、无跳过；结构、类型、原生构建和应用构建通过。控制后端夹具没有启动用户程序，这些测试不替代原生沙箱验收。
- 生产 Host 仍未装配命令后端；完整保护路径/别名、网络允许策略、资源限制与执行域验收完成后才能启用。stdio 与发行验收仍待后续完成。
- Linux 只读文件视图原型已增加：目录句柄固定工作区，隐藏保护名称、多硬链接和所有符号链接，配置的私有目录同时校验路径及设备/inode。私有根替换后停止暴露文件，已打开的描述符也复核；原工作区路径被替换不会转向新目录。
- Ubuntu 新增 **5/5** 真实 FUSE/namespace 测试通过。旧版 fusermount3 在强杀后的自动卸载实测失败，因此崩溃方案采用私有 user/pid/mount namespace，分别验证模拟 Host 与视图进程被 SIGKILL 后执行域无人、宿主没有残留挂载。普通用户完成验证，没有安装系统服务或要求 sudo。该原型仍只读，未进入默认构建；后续写入、内部链接、mmap、用户命令隔离与网络策略见 [视图说明](../native/workspace-view/README.md)。
