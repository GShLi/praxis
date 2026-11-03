# 原生文件 I/O 组件

`praxis-files` 是 Host 的固定 I/O 适配器，不接受命令、插件或脚本。TS 层负责工作区和敏感路径政策、原文件观察版本、UTF-8、补丁、授权及产物；helper 负责真实目录句柄访问。缺失或协议不符时报错，不回退到通过字符串路径的普通读写。

每次调用持有自己的进程、管道和文件句柄。stdin 使用固定 `PXFSv001` 有界帧（6 个长度字段，每个路径最多 4096 字节，前后文件各最多 2 MiB）。路径和内容不放入 argv；只继承 Windows 所需的 SystemRoot，其他环境不继承。输出有 6 MiB 总限额，整个操作限时 15 秒。

POSIX 后端以根目录设备/inode 校验起点，逐段 `openat(O_DIRECTORY|O_NOFOLLOW)`，后续读、列目录、mkdirat、linkat/renameat、unlinkat 都相对已打开目录。文件数据通过已打开的普通文件句柄读取，拒绝多硬链接与超限文件，并检查读取期间变化。读取允许的符号链接先由 TS 解析并重新检查政策，原生路径本身不跟随链接。参考 [openat 的目录句柄与竞态说明](https://man7.org/linux/man-pages/man2/open.2.html) 和 [Apple 的安全文件操作说明](https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html)。

Windows 后端用 NtCreateFile 的 RootDirectory 逐个名称打开，指定 FILE_OPEN_REPARSE_POINT 并拒绝重解析对象、短名称别名和非磁盘对象。目录句柄不共享删除权限；列表由目录句柄枚举；临时文件用句柄相对的 NtSetInformationFile 改名并按句柄清理。只接收普通本地盘符路径，不支持 UNC/设备路径。参考 [NtCreateFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile) 和 [FILE_RENAME_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)。

写入先生成完整临时内容并 fsync/FlushFileBuffers，返回 ready；Host 再检查取消及当前权限，发送单次提交字节。helper 发布前重新检查原文件身份及完整原文。EOF、取消或权限拒绝清除未发布临时文件。发布后 Host 重新读取并校验结果；路径变化或结果无法确认时报告 FILE_PUBLISH_UNKNOWN。强杀或磁盘故障可能遗留临时文件，不承诺已发布内容回滚，也不宣称外部编辑器参与了原子比较交换事务。

macOS ARM64 和 Ubuntu 22.04.5 x64（GCC 11.4、内核 5.15）已编译并执行真实回归，包括 UTF-8、目录句柄/路径替换、版本冲突、取消、父进程退出和打包组件定位。Windows 源码仍须在目标系统编译、运行和验收。这不是命令执行沙箱，不能据此开放 shell 或 MCP stdio。
