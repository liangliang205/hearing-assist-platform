# -*- coding: utf-8 -*-
"""Build the '附页' (student self-check) draft for the mid-term inspection report."""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "中期检查报告_附页_自检自查草稿.docx")

BODY_FONT = "宋体"
HEAD_FONT = "黑体"


def set_run_font(run, name=BODY_FONT, size=12, bold=False, color=None):
    run.font.name = name
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), name)
    rfonts.set(qn("w:ascii"), name)
    rfonts.set(qn("w:hAnsi"), name)


def shade(cell, hexcolor):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hexcolor)
    tcpr.append(shd)


def add_para(doc, text, size=12, bold=False, font=BODY_FONT,
             align=None, space_after=6, first_indent=True, color=None):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.5
    if first_indent:
        pf.first_line_indent = Pt(size * 2)
    r = p.add_run(text)
    set_run_font(r, font, size, bold, color)
    return p


def add_heading(doc, text, level=1):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.5
    r = p.add_run(text)
    set_run_font(r, HEAD_FONT, 14 if level == 1 else 12.5, True)
    return p


def add_item(doc, label, text, size=12):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.5
    p.paragraph_format.left_indent = Pt(24)
    r1 = p.add_run(label)
    set_run_font(r1, HEAD_FONT, size, True)
    r2 = p.add_run(text)
    set_run_font(r2, BODY_FONT, size)
    return p


def add_table(doc, headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        r = p.add_run(h)
        set_run_font(r, HEAD_FONT, 10.5, True)
        shade(hdr[i], "D9E2F3")
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.25
            r = p.add_run(str(val))
            set_run_font(r, BODY_FONT, 10.5)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def main():
    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.2)
    sec.left_margin = Cm(2.6)
    sec.right_margin = Cm(2.6)

    # ---------- Title ----------
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("岭南师范学院本科生毕业论文（设计）中期检查报告")
    set_run_font(r, HEAD_FONT, 16, True)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(10)
    r = p.add_run("附页：学生自检自查（草稿）")
    set_run_font(r, HEAD_FONT, 14, True)

    # ---------- Basic info ----------
    add_table(doc, ["项目", "内容"], [
        ["毕业论文（设计）题目", "《基于React+TypeScript与AI微服务的听障辅助视频处理及听力自测平台设计与实现》"],
        ["姓名 / 学号", "梁境峰 / 202308764415"],
        ["二级学院 / 专业", "计算机与智能教育学院 / 软件工程"],
        ["指导教师", "程翔（讲师）"],
        ["开题日期 / 中期检查截止", "2026.09.27 / 2026.11.25 23:00"],
        ["本报告填写日期", "2026 年 11 月　　日"],
    ], widths=[4.2, 11.5])

    # ---------- Notice box ----------
    t = doc.add_table(rows=1, cols=1)
    t.style = "Table Grid"
    c = t.rows[0].cells[0]
    shade(c, "FFF2CC")
    c.text = ""
    p = c.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.35
    r = p.add_run("填写提示（定稿时删除本框）：")
    set_run_font(r, HEAD_FONT, 10.5, True, RGBColor(0xC0, 0x00, 0x00))
    r = p.add_run(
        "本稿为依据现有文档与代码仓库整理的填写草稿。所有标注【待确认】【待补充】的内容，"
        "须由本人核实或在实际完成后填入，不得虚报；进展描述必须与代码仓库、测试记录、截图一致。"
        "中期检查表第 1 栏格子有限，按模板注释「不够可另加附页」将本附页随表一并提交。"
    )
    set_run_font(r, BODY_FONT, 10.5, False, RGBColor(0xC0, 0x00, 0x00))
    doc.add_paragraph().paragraph_format.space_after = Pt(2)

    # ---------- 1 ----------
    add_heading(doc, "一、毕业论文（设计）进展情况")
    add_para(doc,
             "本课题自 2026 年 9 月 27 日完成选题、10 月 15 日前提交开题报告以来，"
             "按「文献调研 → 需求与设计 → 工程初始化 → 模块实现」的路线推进。"
             "截至本报告填写之日，选题、开题、需求分析与系统设计、数据库与接口设计以及"
             "前后端与 AI 微服务三端工程骨架均已完成，系统进入核心功能开发阶段。"
             "以下按「已完成 / 进行中 / 未开始」如实说明。")

    add_heading(doc, "（一）已完成", level=2)
    add_item(doc, "1. 选题与开题：",
             "完成《开题报告》，明确研究意义、7 个研究内容模块、技术路线与 16 周进度；"
             "收集并研读中外文献 6 篇（听障字幕、移动听力测试、频率压缩、娱乐性噪声暴露等方向），"
             "建立参考文献清单。【待确认：文献台账是否已补齐至 16 篇】")
    add_item(doc, "2. 需求与系统设计：",
             "完成《软件需求规格说明书》《系统设计说明书》《数据库设计说明书》《接口规范》"
             "《测试用例与实验记录》共 5 份项目文档（均标注 V1.0 / 2026 年 9 月），"
             "以及《软件开发流程说明书》《MVP 个人开发计划》。需求条目按模块编号（FR-* / NFR-*）"
             "并逐条映射到测试用例；《接口规范》定义 30 个业务接口与 3 个内网 AI 接口共 33 个编号接口、"
             "统一 { code, message, data, traceId } 响应结构、分页约定与 30 个错误码；"
             "《测试用例与实验记录》编写功能用例 53 条、非功能用例 20 条，合计 73 条。")
    add_item(doc, "3. 数据库与接口设计：",
             "在 Prisma 中定义 8 个数据模型（users、hearing_tests、hearing_test_results、"
             "hearing_profiles、videos、subtitles、ai_tasks、evaluations），含 5 组枚举与索引；"
             "已生成并执行初始迁移脚本，形成可重复重建的物理模型。")
    add_item(doc, "4. 工程初始化（P2 阶段）：",
             "建立 pnpm workspace 单体仓库，划分 frontend（React 18 + TypeScript + Vite + Ant Design）、"
             "backend（Next.js + Prisma + PostgreSQL）、ai-service（FastAPI）三个子工程；"
             "编写 docker-compose.yml 编排 PostgreSQL 16、Redis 7 与 S3 兼容对象存储（SeaweedFS）；"
             "完成 /api/health 与 AI 服务 /health 健康检查、统一响应工具与 Prisma 客户端封装，"
             "并编写 README 环境搭建指南。三端可独立启动，本机可复现初始化链路。")

    add_heading(doc, "（二）进行中", level=2)
    add_item(doc, "1. 技术预研（Spike）：",
             "正在对 faster-whisper 中文语音识别、ffmpeg 转码抽音频、Web Audio 实时增强三项关键技术"
             "进行实测，重点记录模型耗时、内存占用、字幕可读性与播放稳定性，用于确定最终实现方案与降级预案。"
             "【待补充：预研结论、实测耗时与选用模型】")
    add_item(doc, "2. 核心链路开发：",
             "按垂直切片方式推进「注册/登录 → 视频上传与转码 → AI 字幕生成 → 带字幕播放」主线，"
             "后续接听力自测、个性化音频增强与原音/增强对比。"
             "【待补充：截至提交之日已跑通的环节、演示录屏与截图编号】")
    add_item(doc, "3. 测试数据与实验记录：",
             "《测试用例与实验记录》已定义 TC-* 用例集、实验数据采集字段与记录模板；"
             "随功能上线同步填写第 1 轮主线冒烟执行记录与字幕质量抽检数据。"
             "【待补充：执行日期、用例总数、通过数、抽检字错率等实测值】")

    add_heading(doc, "（三）尚未开始的模块", level=2)
    add_para(doc,
             "M2 听力配置与自测、M5 频谱重映射、M6 实验评估的完整实现，"
             "M7 应用镜像与一键部署，以及全量功能/异常/兼容性测试与论文正文撰写，"
             "按计划安排在中期检查之后至 2027 年 3 月初稿阶段完成。",
             first_indent=True)

    add_heading(doc, "（四）阶段性成果清单（可核对）", level=2)
    add_table(doc, ["类别", "成果", "数量 / 位置"], [
        ["文档", "开题报告、软件开发流程、MVP 个人开发计划", "3 份 / D:\\dsh_workspace"],
        ["文档", "项目文档①~⑤（需求、系统设计、数据库、接口、测试与实验）", "5 份 / D:\\dsh_workspace"],
        ["文献", "中外文参考文献 PDF", "6 篇【待确认：补充至 16 篇】"],
        ["需求设计", "功能需求 + 非功能需求、角色、用例、追溯矩阵", "90 条需求 / 5 个用例"],
        ["数据设计", "数据表、字段、索引、枚举、完整性约束", "10 张表 / 109 字段 / 15 索引"],
        ["接口设计", "REST 业务接口 + 内网 AI 接口 + 错误码", "33 个接口 / 30 个错误码"],
        ["测试设计", "功能用例 + 非功能用例", "73 条用例"],
        ["代码", "三端工程骨架、Prisma 模型与初始迁移、健康检查接口、docker-compose、README", "git 提交 2 次（2026-10-07）"],
        ["数据模型", "Prisma models / enums / 初始 migration", "8 个模型 / 5 组枚举 / 1 个迁移"],
        ["过程材料", "技术预研记录、周报、演示截图与录屏、测试执行记录", "【待补充：中期检查前补齐】"],
    ], widths=[2.4, 9.0, 4.3])

    # ---------- 2 ----------
    add_heading(doc, "二、存在的问题与主要困难")
    add_item(doc, "1. 进度较原 16 周计划滞后：",
             "开题报告与《软件开发流程说明书》计划第 6 周完成 AI 字幕模块（Alpha 2），"
             "而实际工作在设计文档与工程初始化阶段停留时间较长，代码提交集中在 2026-10-07，"
             "模块实现进度约滞后 4 周。主要原因是单人独立承担产品、前端、后端、算法、测试与文档，"
             "且学期课程与考试占用了部分投入（计划按 20 小时/周制定，实际存在 30%–40% 损耗）。"
             "已采取的措施：按《MVP 个人开发计划》冻结范围、按周垂直切片交付，"
             "优先保证核心链路可演示，非关键功能顺延。")
    add_item(doc, "2. 关键技术的不确定性尚未完全排除：",
             "faster-whisper 在本地 CPU 上的推理耗时、长视频字幕时间轴稳定性，"
             "以及 Web Audio 链路播放的爆音/削波问题，均需通过第 1 周技术预研给出实测结论。"
             "若预研不通过，按预案降级为更小模型、短视频演示或服务端离线处理。")
    add_item(doc, "3. 实验与测试数据仍为模板：",
             "测试用例执行记录、字幕质量抽检、增强主观评价、自测重复性等表格目前为空模板，"
             "尚不足以支撑论文实验章节。需在功能上线同步采集，避免期末集中补做。")
    add_item(doc, "4. 计划基线需要正式统一：",
             "开题报告的 16 周全量方案与《MVP 个人开发计划》的 12 周降范围方案存在技术选型差异"
             "（详见第四节），已整理《研究内容与技术路线调整说明》报指导教师确认，"
             "并在《软件开发流程说明书》中补记变更，避免论文描述与系统实现不一致。")
    add_item(doc, "5. 设计文档之间、以及设计文档与代码之间尚有口径不一致：",
             "如系统设计与接口规范中 E9001/E9002 错误码含义冲突、接口规范状态码表缺 504 与 422、"
             "个别接口缺错误码行、需求追溯矩阵的章节号与接口编号范围错配、任务状态枚举四态/五态不一、"
             "测试范围说明与 TC-HP-03 用例对「多配置并存」的描述相反；实验记录中「预期结论」"
             "在尚无数据时已预先写定。更需优先处理的是：《数据库设计说明书》列出 10 张表，"
             "而仓库 backend/prisma/schema.prisma 实际为 8 个模型（tasks 改名为 AiTask、"
             "字幕分段合并为 JSON、video_metrics 与 remap_tasks 尚未落地），命名与结构均不一致。"
             "上述内容正在做一次「接口—数据表—用例」三方对照后统一修订，使设计文档与代码实现收敛，"
             "并把「预期结论」改为待数据验证的假设。")

    # ---------- 3 ----------
    add_heading(doc, "三、下一步计划与安排")
    add_para(doc,
             "以 2026 年 11 月 25 日中期检查提交、2027 年 3 月 5 日初稿 1 提交为两个硬节点，"
             "按周倒排如下。中期检查前只做「登录 → 上传 → 转码 → AI 字幕 → 带字幕播放」一条垂直切片，"
             "不并行开工听力自测与频谱重映射。")

    add_table(doc, ["时间", "阶段目标", "主要任务", "可验证产出"], [
        ["11/05–11/07", "变更备案与技术预研",
         "完成 Whisper、ffmpeg、Web Audio 三项实测；提交《研究内容与技术路线调整说明》并请导师确认；补写第 1–5 周周报；做一次接口—数据表—用例三方对照并统一错误码、编号与范围口径",
         "《技术预研记录》、调整说明（导师确认）、周报、三方对照表与文档修订记录"],
        ["11/08–11/14", "主线前段（Alpha 1）",
         "实现注册/登录/JWT、视频上传与格式校验、ffmpeg 转码与 16 kHz 单声道音频抽取、视频列表与播放页",
         "可演示的注册→上传→播放流程；演示录屏与截图"],
        ["11/15–11/21", "AI 字幕与主线闭环（Alpha 2）",
         "FastAPI 接入 faster-whisper 生成 SRT/VTT；AI 任务状态机与进度轮询；VTT 挂载播放器；字幕质量抽检",
         "上传后自动出字幕并同步播放；表 4-1、表 5-1 首轮实测数据"],
        ["11/22–11/25", "材料整理与提交",
         "填写中期检查表与附页、整理支撑材料、送导师审阅、上传维普系统",
         "中期检查表（含签名）、附页、材料包、提交回执"],
        ["11/26–12/31", "完成 MVP 核心链路",
         "M2 听力自测、M5 个性化音频增强、原音/增强 AB 对比；补齐实验数据采集",
         "MVP 全链路可演示；论文第 3、5 章素材"],
        ["2027/01–02", "算法补齐与全量测试",
         "v1.1 的 STFT 离线频谱重映射（开题报告承诺的核心算法）；TC-* 全量用例执行；Docker 一键部署与性能数据",
         "测试报告、实验数据集、部署包"],
        ["2027/02–03/05", "论文初稿 1",
         "先完成第 1、2、4 章（绪论、技术、数据库），再完成第 3、5、6、7 章；整理参考文献与图表",
         "论文初稿 1（按学院模板 1–7 章结构）"],
    ], widths=[2.6, 3.2, 6.8, 3.1])

    # ---------- 4 ----------
    add_heading(doc, "四、执行情况说明")
    add_para(doc,
             "本课题题目、研究方向、研究目标与开题报告一致，选题未发生变化，"
             "故中期检查表「选题是否有变化」勾选「无（与开题一致）」。"
             "但在执行过程中，为保证单人可在有限投入内交付可演示、可验证的完整链路，"
             "对阶段性实现范围与技术选型作了收敛，形成《MVP 个人开发计划》。"
             "该调整不改变研究目标与 7 个模块的总体框架，仅把部分实现推迟到 v1.1/v1.2 阶段，"
             "已整理《研究内容与技术路线调整说明》报指导教师确认，并同步记录于《软件开发流程说明书》变更记录。"
             "【待确认：导师确认方式（签字/邮件）与日期】")
    add_para(doc,
             "其中需重点说明的一项：开题报告将「频谱重映射模块」安排在第 8—9 周，"
             "《软件开发流程说明书》亦将其列为 M5 / P6 阶段；在阶段性实现中，"
             "为保证核心链路先跑通，把基于 STFT 的离线频谱重映射调整到 v1.1（第 13—14 周），"
             "MVP 阶段先以 Web Audio 实时增强完成「按听力配置改善可听度」的验证，"
             "数据库与接口层仅作结构预留（remap_tasks 建表、AI-03 /ai/v1/remap 标记为 v1.1）。"
             "该调整不改变题目的研究目标，离线重映射及其与实时增强的对比实验仍将在论文"
             "「系统实现」与「实验结果」章节中完成；中期检查阶段以实时增强的实测数据作为替代验证。"
             "【待确认：是否需按学院流程办理任务书/开题变更手续】")

    add_table(doc, ["环节", "开题报告 / 软件开发流程（基线）", "阶段性实现（MVP）", "补齐安排"], [
        ["开发周期", "16 周，P0–P7 八阶段", "12 周 MVP + v1.1/v1.2 演进", "第 13–16 周及后续补齐"],
        ["频谱重映射", "librosa / torchaudio + STFT 离线重映射 + iSTFT",
         "Web Audio API 实时 EQ / 高频补偿 / 动态压缩", "v1.1 补离线重映射并做对比"],
        ["任务进度", "SSE / WebSocket 实时推送", "前端每 2 秒轮询任务状态接口", "接口结构不变，后续平滑替换"],
        ["文件存储", "MinIO / S3 对象存储", "本地磁盘 + 静态资源路由（存储层抽象）", "接入 S3 客户端时切换"],
        ["AI 字幕", "WhisperX + 说话人分离 + 在线编辑", "faster-whisper base/small，生成 SRT/VTT", "v1.2 补在线编辑与版本管理"],
        ["播放器", "Video.js + 自定义字幕轨", "HTML5 video + 原生 track + 双音轨切换", "体验优化阶段完善"],
        ["角色权限", "完整角色权限体系", "邮箱密码登录 + JWT，角色权限后置", "v1.2 补齐"],
    ], widths=[2.3, 4.6, 4.6, 4.2])

    add_para(doc,
             "执行情况总体判断：设计阶段成果完整且可追溯，工程初始化已达到「三端可独立启动、"
             "数据模型可重建、基础设施可编排」的预期；实现阶段进度滞后但主链路技术风险已识别，"
             "并已给出降级预案与带日期的追赶计划。后续将严格执行每周演示与周报制度，"
             "保证论文描述与系统实测数据一致。")

    # ---------- 5 ----------
    add_heading(doc, "五、随附支撑材料清单")
    add_table(doc, ["序号", "材料名称", "状态"], [
        ["1", "开题报告", "已具备"],
        ["2", "软件开发流程说明书、MVP 个人开发计划", "已具备"],
        ["3", "项目文档①软件需求规格说明书", "已具备"],
        ["4", "项目文档②系统设计说明书", "已具备"],
        ["5", "项目文档③数据库设计说明书", "已具备"],
        ["6", "项目文档④接口规范", "已具备"],
        ["7", "项目文档⑤测试用例与实验记录（含首轮执行记录）", "已具备模板，实测数据待补"],
        ["8", "研究内容与技术路线调整说明（导师确认）", "待补"],
        ["9", "技术预研记录（Whisper / ffmpeg / Web Audio 实测）", "待补"],
        ["10", "第 1–5 周周报", "待补"],
        ["11", "系统演示录屏与截图、git 提交记录、README", "部分具备，待补齐"],
        ["12", "文献台账（≥16 篇）与综述笔记", "部分具备（6 篇），待补齐"],
        ["13", "接口—数据表—用例三方对照表与文档修订记录", "待补"],
        ["14", "论文第 5、6 章骨架（用例/实验与论文章节映射、图表与截图清单）", "待补"],
    ], widths=[1.5, 10.5, 3.7])

    # ---------- signature ----------
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("学生（签名）：　　　　　　　　　　")
    set_run_font(r, BODY_FONT, 12)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p.add_run("2026 年　　11 月　　　日")
    set_run_font(r, BODY_FONT, 12)

    doc.save(OUT)
    print("SAVED", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
