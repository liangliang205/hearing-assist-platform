# HearLink 最小验证 APO

目的：验证「把音频效果注册到输出端点后，系统里**所有应用**的声音都会被处理」这条技术路线是否成立。

不是产品代码——它只做一件事：对经过该端点的所有声音乘以一个固定增益（默认 +6 dB），并在加载时写日志。

## 它验证什么

| 疑问 | 这个原型怎么回答 |
| --- | --- |
| 不用虚拟声卡、不切默认设备，能不能全局生效？ | 注册到端点后，播放任意应用的声音，看日志是否被调用 |
| APO 能不能做任意 DSP（为频率重映射铺路）？ | `APOProcess` 里就是普通采样循环，可替换成任意算法 |
| 会不会要求逐应用配置？ | 任何应用都不需要知道它的存在 |

## 目录

```
apo.h / apo.cpp      APO 本体（继承 CBaseAudioProcessingObject）
dllmain.cpp          COM 类工厂 + DLL 入口（带加载日志）
exports.def          导出 DllGetClassObject / DllCanUnloadNow
build.ps1            用 VS Build Tools 编译出 x64 DLL
install.ps1          注册 COM + 音频引擎 + 输出端点，重启音频服务
uninstall.ps1        完整移除，恢复系统原状
```

## 编译

```powershell
.\build.ps1
```

产物：`build\HearLinkApo.dll`

依赖：VS Build Tools 2022（C++ 工作负载 + **ATL 组件**）+ Windows SDK 10。

## 安装（管理员）

```powershell
.\install.ps1                 # 注册到所有活动播放设备
.\install.ps1 -Endpoint '{GUID}'   # 只注册指定端点
```

脚本做四件事：

1. 复制 DLL 到 `C:\ProgramData\HearLink\Apo\`
2. 写 COM 注册（`HKLM\SOFTWARE\Classes\CLSID\...`）
3. 写音频引擎注册（`AudioEngine\AudioProcessingObjects`）
4. 给端点写 `FxProperties`（SFX 的 CLSID + 支持的信号处理模式），重启 `audiosrv`

## 验证

播放任意音频，然后看日志：

```powershell
Get-Content C:\ProgramData\HearLink\apo.log -Wait
```

出现 `DllMain: 已加载到音频引擎进程` 和 `Initialize 成功` 就证明**音频引擎确实在用它**（此时听到的声音会比原来大 6 dB）。

改增益：编辑 `C:\ProgramData\HearLink\gain.txt`（线性倍数，1.0 = 不放大，2.0 = +6 dB），重启音频服务生效。

## 卸载（必须做）

```powershell
.\uninstall.ps1
```

会移除端点注册、引擎注册、COM 注册并删除 DLL。**不卸载会让所有声音一直带增益。**

## 已知风险

- APO 跑在 `audiodg.exe` 里，代码缺陷会导致**整机音频异常**（无声/爆音）
- 连续初始化失败 10 次，Windows 会自动禁用该端点的系统效果
- 受保护内容（DRM 音频）要求 APO 已签名，未签名版本不会被加载
- 实时线程内不能做 IO/加锁/分配内存——本原型的日志只写在加载与初始化阶段
