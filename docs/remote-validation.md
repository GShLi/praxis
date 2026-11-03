# Linux / Windows 验证环境配置

在本机编辑 `praxis/.runtime/validation-targets.local.json`。这是开发验收环境的连接说明，由开发 Agent 读取，不是 Praxis 产品的模型配置或远程执行功能。实际机器地址仅保存在这份 Git 忽略的本机文件中；可提交的空白模板是 [validation-targets.example.json](validation-targets.example.json)。

可以先只填 Linux 并将其 `enabled` 设为 `true`，Windows 留为 `false`。填好后告诉开发 Agent“环境配置已填写”，便可先连接检查，再在专用目录上传源代码副本、编译和运行验收。上传范围限项目源代码，不包含 `.env`、`.runtime`、`.cache`、数据库、账号配置或私钥。执行验收不等于自动完成桌面交互验收；需要可见桌面会单独记录。

## 字段清单

Linux 和 Windows 各有一组相同字段：

| 字段 | 是否必填 | Linux 示例 | Windows 示例 | 含义 |
| --- | --- | --- | --- | --- |
| `enabled` | 是 | `true` | `true` | 当前环境已经准备好并用于 Praxis 验证 |
| `ssh.alias` | 可选 | `praxis-linux` | `praxis-windows` | 本机 `~/.ssh/config` 中已配置好的 Host 别名 |
| `ssh.host` | 不用别名时必填 | `192.168.1.20` | `192.168.1.30` | 这台 Mac 可达的 IP 或主机名 |
| `ssh.port` | 不用别名时填写 | `22` | `22` | SSH 端口 |
| `ssh.user` | 不用别名时必填 | `double` | `praxis-test` | SSH 登录账号；Windows 推荐专用本地账号 |
| `systemVersion` | 可留空，连接后探测 | `Ubuntu 24.04` | `Windows 11 24H2` | 系统版本，不确定时留空 |
| `architecture` | 可保留 `auto` | `x64` / `arm64` / `auto` | `x64` / `arm64` / `auto` | 目标 CPU 架构 |
| `workdir` | 是 | `/home/double/praxis-validation` | `C:\Users\praxis-test\praxis-validation` | 本账号可写的专用测试目录；使用绝对路径 |
| `allowInstallDependencies` | 是 | `true` / `false` | `true` / `false` | 是否允许安装项目和构建依赖；`false` 时只检查现有工具 |
| `allowPrivilegedSetup` | 是 | `true` / `false` | `true` / `false` | 是否允许为验收使用 sudo/管理员权限配置必要系统组件；不代表已有提升能力 |

使用 `ssh.alias` 时，SSH 地址、用户名、端口及密钥路径以本机 SSH 配置为准，本文件的 `host/user/port` 不再覆盖它。密码、私钥内容、模型 API Key 都不填写在本文件中。带密码的密钥由本机 ssh-agent 解锁；连接检查使用非交互模式。

Windows 路径在 JSON 中必须写双反斜杠，例如：

```json
"workdir": "C:\\Users\\praxis-test\\praxis-validation"
```

不需要提前安装全部开发工具。连接后先检查 Node、pnpm、Git、C/C++ 编译器及目标系统能力；如果允许安装，再补必要依赖。Windows 验收连接应进入原生 Windows，WSL 可作为额外 Linux 环境，不能替代 AppContainer、Job Object 和 Windows 文件路径验收。

## Linux

已有免密 SSH 时，填 `host/user/port/workdir` 即可。也可以直接填写能正常使用的 SSH 别名。

在本机终端检查连接（替换账号和 IP）：

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 -p 22 double@192.168.1.20 'uname -s; uname -m'
```

首次连接尚未登记主机指纹时，先手动连接并核对指纹；无需关闭 SSH 主机校验。

## Windows

需要 Windows 的 **OpenSSH Server**，并配置从这台 Mac 到 Windows 账号的公钥登录。账号和 IP 与 Linux 一样填写，另外提供 Windows 形式的专用测试目录。

### 1. 启动 OpenSSH Server

在 Windows 管理员 PowerShell 中执行：

```powershell
Get-WindowsCapability -Online -Name OpenSSH.Server*
# 仅在未安装时执行下一行
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
Get-NetFirewallRule -Name OpenSSH-Server-In-TCP
```

安装通常会创建 SSH 防火墙规则；目标地址使用这台 Mac 可达的内网/VPN 地址。不同 Windows 版本的安装入口及故障处理见 [Microsoft OpenSSH 安装说明](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)。

### 2. 配置免密登录

使用本机已有 SSH 公钥即可，例如 `~/.ssh/id_ed25519.pub` 的内容。私钥继续保留在 Mac。把公钥作为单独一行加入 Windows 对应账号的公钥文件：

| Windows 账号 | 默认公钥文件 |
| --- | --- |
| 普通本地用户 | `C:\Users\用户名\.ssh\authorized_keys` |
| Administrators 组成员 | `C:\ProgramData\ssh\administrators_authorized_keys` |

公钥文件需要正确的 Windows ACL。普通专用本地账号更便于区分日常测试和系统安装；管理员账号的文件位置及 ACL 命令、域账号要求见 [Microsoft 公钥登录说明](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement)。Entra ID 账号不支持该文档中的公钥登录方式。

### 3. 从 Mac 验证

首次可先手动连接并核对指纹，随后确认下面命令不要求输入密码：

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 -p 22 praxis-test@192.168.1.30 whoami
```

成功后填写 Windows 配置。之后的 Windows 系统检查会显式调用 PowerShell，无需把默认 SSH shell 改成 PowerShell。
