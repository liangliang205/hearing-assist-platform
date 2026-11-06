import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  List,
  Radio,
  Row,
  Segmented,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import {
  EAR_LABELS,
  effectiveGainDb,
  planFrequencyLowering,
  PROCESSING_SCHEMES,
  type CompensationConfig,
  type Ear,
  type EarCompensation,
  type ProcessingScheme,
} from '@hearlink/domain';
import { ensureAudioReady } from '../audio/audioEngine';
import { createProcessor, type StereoEnhancementChain } from '../audio/enhancementChain';
import {
  createSweepBuffer,
  decodeAudioFile,
  playBufferThroughStereoChain,
  type PlaybackController,
} from '../audio/media';
import { downloadBlob, isAudioFile, processAudioFile } from '../audio/render';
import { ResponseCurveChart } from '../components/charts';
import {
  engineErrorMessage,
  isDesktopShell,
  readEngineStatus,
  startEngine,
  stopEngine,
  useEngineStatus,
  writeProfile,
} from '../desktop/systemEngine';
import { localStore } from '../store';
import { configFromProfile } from '../store/profile';

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
}

const SCHEME_SETTING_KEY = 'processingScheme';

interface GainRow {
  frequency: number;
  threshold: number | null;
  effective: number;
}

/** 有效增益 = 整条 EQ 链在该频点的实际响应（含相邻频带叠加与前置增益）。 */
function gainRows(ear: EarCompensation): GainRow[] {
  return [...ear.audiogram]
    .sort((a, b) => a.frequency - b.frequency)
    .map((item) => ({
      frequency: item.frequency,
      threshold: item.thresholdDbHl,
      effective: Number(effectiveGainDb(ear, item.frequency).toFixed(1)),
    }));
}

const gainColumns: ColumnsType<GainRow> = [
  { title: '频点', dataIndex: 'frequency', render: (value: number) => formatFrequency(value) },
  {
    title: '听阈',
    dataIndex: 'threshold',
    render: (value: number | null) => (value === null ? '未测出' : `${value} dB`),
  },
  { title: '有效增益', dataIndex: 'effective', render: (value: number) => `${value} dB` },
];

interface FileItem {
  id: string;
  name: string;
  status: 'processing' | 'done' | 'error';
  blob?: Blob;
  outputName?: string;
  error?: string;
}

export function EnhancePage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<CompensationConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [scheme, setScheme] = useState<ProcessingScheme>('gain');
  const [source, setSource] = useState<'sweep' | 'file'>('sweep');
  const [fileName, setFileName] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [enhanced, setEnhanced] = useState(true);
  const [items, setItems] = useState<FileItem[]>([]);

  const desktopShell = isDesktopShell();
  const { status: engine, setStatus: setEngine } = useEngineStatus();
  const [engineBusy, setEngineBusy] = useState(false);

  // 方案二的起始频率：取听力较差一侧"第一个明显下降"的频点
  const loweringFmin = useMemo(() => {
    if (!config) return 4000;
    const ears = [config.ears.LEFT, config.ears.RIGHT].filter(Boolean) as EarCompensation[];
    const reference = [...ears].sort((a, b) => (b.ptaDbHl ?? 0) - (a.ptaDbHl ?? 0))[0];
    return reference ? planFrequencyLowering(reference.audiogram).fmin : 4000;
  }, [config]);

  // 桌面引擎用的配置：选了方案二就把 frequencyLowering 打开；「原音」时整条链直通
  const engineConfig = useMemo<CompensationConfig | null>(() => {
    if (!config) return null;
    const bypass = !enhanced;
    if (scheme !== 'frequencyLowering') {
      return {
        ...config,
        bypass,
        frequencyLowering: { ...config.frequencyLowering, enabled: false },
      };
    }
    return {
      ...config,
      bypass,
      frequencyLowering: {
        ...config.frequencyLowering,
        enabled: true,
        shiftHz: null,
        fmin: loweringFmin,
        fmax: 8000,
      },
    };
  }, [config, scheme, loweringFmin, enhanced]);

  const fileRef = useRef<File | null>(null);
  const chainRef = useRef<StereoEnhancementChain | null>(null);
  const playbackRef = useRef<PlaybackController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await localStore.getActiveProfile();
      setConfig(configFromProfile(profile));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 记住用户选择的方案
  useEffect(() => {
    void (async () => {
      const saved = await localStore.getSetting(SCHEME_SETTING_KEY);
      if (saved === 'gain' || saved === 'frequencyLowering') {
        setScheme(saved);
      }
    })();
  }, []);

  // 桌面端：把当前档案同步给引擎（托盘/开机自启可以直接用）；切换方案也会触发热更新
  useEffect(() => {
    if (!desktopShell || !engineConfig) return;
    void writeProfile(engineConfig).catch((error) => {
      console.warn('同步补偿配置到桌面端失败', error);
    });
  }, [desktopShell, engineConfig]);

  const selectScheme = async (next: ProcessingScheme) => {
    setScheme(next);
    await localStore.setSetting(SCHEME_SETTING_KEY, next);
    stop();
    // 方案变了，旧处理链作废，下次播放按新方案重建
    chainRef.current?.dispose();
    chainRef.current = null;
  };

  const stop = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlaying(false);
  }, []);

  const toggleSystemEngine = async (next: boolean) => {
    if (!engineConfig) return;
    setEngineBusy(true);
    try {
      const status = next ? await startEngine(engineConfig) : await stopEngine();
      setEngine(status);
      message.success(
        next
          ? '系统级增强已开启：系统所有声音都会按你的听力曲线处理'
          : '系统级增强已关闭，声音恢复原样',
      );
    } catch (error) {
      message.error(engineErrorMessage(error));
      setEngine(await readEngineStatus().catch(() => null));
    } finally {
      setEngineBusy(false);
    }
  };

  useEffect(
    () => () => {
      playbackRef.current?.stop();
      chainRef.current?.dispose();
    },
    [],
  );

  const play = async () => {
    if (!config) return;
    try {
      const context = await ensureAudioReady();
      // 浏览器里只有方案一（Web Audio EQ）；方案二的搬移由桌面引擎执行
      const previewScheme: ProcessingScheme = scheme === 'frequencyLowering' ? 'gain' : scheme;
      if (!chainRef.current) {
        chainRef.current = createProcessor(previewScheme, context, config);
      } else {
        chainRef.current.applyConfig(config);
      }

      let buffer: AudioBuffer;
      if (source === 'sweep') {
        buffer = createSweepBuffer(context, { seconds: 10, startHz: 100, endHz: 8000 });
      } else {
        if (!fileRef.current) {
          message.warning('请先选择一个本地音频文件');
          return;
        }
        buffer = await decodeAudioFile(context, fileRef.current);
      }

      stop();
      playbackRef.current = playBufferThroughStereoChain(context, buffer, chainRef.current, {
        enhanced,
        loop: source === 'sweep',
        onEnded: () => setPlaying(false),
      });
      setPlaying(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '播放失败');
    }
  };

  const handlePreviewUpload: UploadProps['beforeUpload'] = (file) => {
    fileRef.current = file;
    setFileName(file.name);
    setSource('file');
    return false;
  };

  const handleBatchUpload: UploadProps['beforeUpload'] = (file) => {
    if (!config) {
      message.warning('请先完成听力自测');
      return Upload.LIST_IGNORE;
    }
    if (!isAudioFile(file)) {
      message.warning(`${file.name}：当前仅支持音频文件，视频处理将在 v0.2 支持`);
      return Upload.LIST_IGNORE;
    }

    const id = crypto.randomUUID();
    setItems((prev) => [...prev, { id, name: file.name, status: 'processing' }]);

    void (async () => {
      try {
        const result = await processAudioFile(file as File, config, scheme);
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: 'done', blob: result.blob, outputName: result.name }
              : item,
          ),
        );
      } catch (error) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'error',
                  error: error instanceof Error ? error.message : '处理失败',
                }
              : item,
          ),
        );
      }
    })();

    return false;
  };

  if (!loading && !config) {
    return (
      <Card bordered={false}>
        <Empty description="还没有补偿配置，先完成一次双耳听力自测。">
          <Button type="primary" onClick={() => navigate('/hearing-test')}>
            去测听
          </Button>
        </Empty>
      </Card>
    );
  }

  if (!config) {
    return <Card bordered={false} loading />;
  }

  // 方案二的参数规划：取听力较差的一侧作为参考
  const planEar =
    config.ears.LEFT && config.ears.RIGHT
      ? (config.ears.LEFT.ptaDbHl ?? 0) >= (config.ears.RIGHT.ptaDbHl ?? 0)
        ? config.ears.LEFT
        : config.ears.RIGHT
      : config.ears.LEFT ?? config.ears.RIGHT;
  const loweringPlan = planEar ? planFrequencyLowering(planEar.audiogram) : null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false} loading={loading}>
        <Row gutter={[16, 16]} align="middle">
          <Col flex="auto">
            <Typography.Title level={4} style={{ margin: 0 }}>
              声音增强
            </Typography.Title>
            <Typography.Text type="secondary">
              按当前档案的左右耳参数处理：左声道走左耳、右声道走右耳。
            </Typography.Text>
          </Col>

          <Col>
            {desktopShell ? (
              <Space align="center" size={10}>
                <Tag color={engine?.running ? 'green' : 'default'}>
                  {engine?.running ? '系统全局' : '系统级增强未开启'}
                </Tag>
                <Switch
                  checked={Boolean(engine?.running)}
                  loading={engineBusy}
                  onChange={(checked) => void toggleSystemEngine(checked)}
                  checkedChildren="开"
                  unCheckedChildren="关"
                />
              </Space>
            ) : (
              <Tag>系统级增强需桌面版</Tag>
            )}
          </Col>

          <Col>
            <Segmented
              value={enhanced ? 'enhanced' : 'original'}
              onChange={(value) => {
                const next = value === 'enhanced';
                setEnhanced(next);
                playbackRef.current?.setEnhanced(next);
              }}
              options={[
                { label: '原音', value: 'original' },
                { label: '增强', value: 'enhanced' },
              ]}
            />
          </Col>
        </Row>

        {desktopShell ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
            开启后系统默认播放设备会切到 CABLE Input（需已安装 VB-CABLE 虚拟声卡），声音经引擎处理后送到你原来的
            扬声器/耳机；关闭或退出程序会自动还原。当前输出：{enhanced ? '增强' : '原音直通'}，方案：
            {scheme === 'frequencyLowering' ? '频率重映射' : '增益补偿'}（两者在上面切换，1 秒内热更新）。
            {engine?.pid ? `　·　引擎 PID ${engine.pid}` : ''}
          </Typography.Text>
        ) : null}
      </Card>

      <Card bordered={false} title="增强方案">
        <Radio.Group
          value={scheme}
          onChange={(event) => void selectScheme(event.target.value as ProcessingScheme)}
        >
          <Space direction="vertical" size={14}>
            {PROCESSING_SCHEMES.map((item) => (
              <Radio key={item.key} value={item.key} disabled={!item.available}>
                <Space direction="vertical" size={2}>
                  <Space>
                    <Typography.Text strong>{item.label}</Typography.Text>
                    {item.available ? <Tag color="green">可用</Tag> : <Tag>开发中</Tag>}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.summary}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    适合：{item.suitableFor}
                  </Typography.Text>
                  {item.plannedNote ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.plannedNote}
                    </Typography.Text>
                  ) : null}
                </Space>
              </Radio>
            ))}
          </Space>
        </Radio.Group>

        {loweringPlan ? (
          <Alert
            style={{ marginTop: 16 }}
            type={scheme === 'frequencyLowering' ? 'warning' : 'info'}
            showIcon
            message={
              scheme === 'frequencyLowering'
                ? '方案二已选中：系统级增强只做搬移，增益补偿不再叠加'
                : '方案二参数（选中后由桌面引擎执行）'
            }
            description={
              <Space direction="vertical" size={2}>
                <span>
                  起始频率 {loweringPlan.fmin} Hz　·　上边界 {loweringPlan.fmax} Hz　·　搬移量约{' '}
                  {(loweringPlan.fmax - loweringPlan.fmin) / 2} Hz（半个带宽）
                </span>
                <span>策略：bandShift（{loweringPlan.reason}）</span>
                <span>浏览器试听仍按方案一处理；两个方案互斥，系统级增强里只会生效一个。</span>
              </Space>
            }
          />
        ) : null}
      </Card>

      <Card bordered={false} title="① 试听效果">
        <Space wrap>
          <Segmented
            value={source}
            onChange={(value) => {
              setSource(value as 'sweep' | 'file');
              stop();
            }}
            options={[
              { label: '扫频测试音', value: 'sweep' },
              { label: '本地音频', value: 'file' },
            ]}
          />
          <Upload beforeUpload={handlePreviewUpload} showUploadList={false} accept="audio/*">
            <Button>选择试听文件</Button>
          </Upload>
          {fileName ? <Tag color="blue">{fileName}</Tag> : null}
          <Button type="primary" onClick={play}>
            {playing ? '重新播放' : '播放'}
          </Button>
          <Button danger onClick={stop} disabled={!playing}>
            停止
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          扫频音从 100 Hz 扫到 8 kHz，切换「原音 / 增强」最容易听出差异。文件不会上传，全部在本机处理。
        </Typography.Paragraph>
      </Card>

      <Card
        bordered={false}
        title="② 处理本地文件"
        extra={<Typography.Text type="secondary">可一次选多个文件</Typography.Text>}
      >
        <Upload multiple beforeUpload={handleBatchUpload} showUploadList={false} accept="audio/*">
          <Button type="primary">选择音频文件</Button>
        </Upload>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          处理结果为 WAV（16-bit）。视频音轨处理与字幕生成将在 v0.2 支持。
        </Typography.Paragraph>

        {items.length > 0 ? (
          <List
            size="small"
            dataSource={items}
            rowKey="id"
            renderItem={(item) => (
              <List.Item
                actions={[
                  item.status === 'done' && item.blob && item.outputName ? (
                    <Button
                      key="download"
                      size="small"
                      type="primary"
                      onClick={() => downloadBlob(item.blob!, item.outputName!)}
                    >
                      下载
                    </Button>
                  ) : null,
                ].filter(Boolean)}
              >
                <Space>
                  <span>{item.name}</span>
                  {item.status === 'processing' ? <Tag color="processing">处理中</Tag> : null}
                  {item.status === 'done' ? <Tag color="green">完成</Tag> : null}
                  {item.status === 'error' ? <Tag color="red">{item.error}</Tag> : null}
                </Space>
              </List.Item>
            )}
          />
        ) : null}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card bordered={false} title="当前增强链频率响应">
            <ResponseCurveChart config={config} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card bordered={false} title="双耳补偿参数">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {(['LEFT', 'RIGHT'] as Ear[]).map((ear) => {
                const earConfig = config.ears[ear];
                return (
                  <div key={ear}>
                    <Space style={{ marginBottom: 6 }}>
                      <Tag color={ear === 'LEFT' ? 'blue' : 'red'}>{EAR_LABELS[ear]}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {earConfig ? `${earConfig.grade.label} · PTA ${earConfig.ptaDbHl ?? '--'} dB` : '未测听（直通）'}
                      </Typography.Text>
                    </Space>
                    <Table
                      size="small"
                      rowKey="frequency"
                      pagination={false}
                      columns={gainColumns}
                      dataSource={earConfig ? gainRows(earConfig) : []}
                      locale={{ emptyText: '该侧未测听，不做补偿' }}
                    />
                  </div>
                );
              })}
            </Space>
          </Card>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        message="系统级增强已就绪"
        description="桌面版（Tauri + Rust 引擎 + VB-CABLE）能接管整机声音，按左右耳参数做增益补偿与频率重映射；浏览器预览只能处理单个文件。"
      />
    </Space>
  );
}
