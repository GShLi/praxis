# Linux 工作区过滤视图原型

此 helper 是生产命令后端的文件视图候选，仅实现只读文件访问。目前不进入默认构建、不装配到 Host，也不作为已完成的命令沙箱发布。

`main.c` 拥有根目录句柄、私有目录标识及 FUSE 生命周期；`path.c` 负责逐段无跟随打开、保护名称、设备/inode 和硬链接校验；`read.c` 提供目录、元数据和文件读取。目录遍历与读取不会通过宿主符号链接，所有符号链接、非普通文件、额外挂载设备和多硬链接文件目前均拒绝。没有写入回调。关闭属性/目录缓存，文件读取使用 direct I/O。

启动参数为 `workspace device:inode mountpoint [private-relative-path ...]`，私有路径以 `/` 开头、相对于工作区，最多 64 个且必须存在。目录句柄固定原工作区；替换根路径不会转向新目录。私有目录既按路径拒绝，也固定其设备/inode；原位置缺失或身份改变后停止暴露文件，已打开文件也复核该条件。

依赖 Linux FUSE3 运行库、`/dev/fuse` 与用户挂载支持；开发测试还需要 C 编译器和 libfuse3 头文件。测试把 helper 编译在一次性目录，用 `-Wall -Wextra -Werror`，退出后清理。

```sh
# 系统已安装开发头文件时无需指定此变量。
PRAXIS_TEST_FUSE_INCLUDE=/path/to/include/fuse3 pnpm test:linux-view
```

Ubuntu 22.04 自带 fusermount3 3.10.5 的 `auto_unmount` 不能作为崩溃清理保证：其特权检查可能因 EACCES 不执行卸载，后续 libfuse 增加了按挂载所有者重查的处理。参考 [3.10.5 实现](https://github.com/libfuse/libfuse/blob/fuse-3.10.5/util/fusermount.c) 和 [当前实现](https://libfuse.github.io/doxygen/fusermount_8c_source.html)。活跃测试所有者会显式卸载自己的视图；崩溃验收把整组受信任进程放在独立 user/pid/mount namespace 内，使 namespace 销毁时释放挂载。测试分别强杀模拟 Host 和视图进程，确认 PID namespace 无成员、宿主无新增挂载。

命名空间中的测试 Worker 只运行固定测试程序；为创建视图持有该 user namespace 内的 CAP_SYS_ADMIN，并只读访问宿主构建工具。这**不是用户命令的权限或文件可见范围**。生产后端仍需嵌套的受限用户命令视图、能力与系统调用限制、网络策略、资源预算、启动收据和双向清理管理。工作区写入、安全的内部符号链接、可执行文件 mmap、竞态压力及完整后端接线均未完成。
