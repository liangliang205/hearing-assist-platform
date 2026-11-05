import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { hearingApi } from '../api/endpoints';
import { ensureAudioReady } from '../audio/audioEngine';
import { createStereoChain, type StereoEnhancementChain } from '../audio/enhancementChain';
import {
  createSweepBuffer,
  decodeAudioFile,
  playBufferThroughStereoChain,
  type PlaybackController,
} from '../audio/media';
import { ResponseCurveChart } from '../components/charts';
import { EAR_LABELS, type CompensationConfig, type Ear, type EqBand } from '../types';

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
}

const bandColumns: ColumnsType<EqBand> = [
  { title: '中心频率', dataIndex: 'frequency', render: (value: number) => formatFrequency(value) },
  { title: '增益', dataIndex: 'gainDb', render: (value: number) => `${value} dB` },
];

export function PreviewPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<CompensationConfig | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'sweep' | 'file'>('sweep');
  const [fileName, setFileName] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [enhanced, setEnhanced] = useState(true);

  const fileRef = useRef<File | null>(null);
  const chainRef = useRef<StereoEnhancementChain | null>(null);
  const playbackRef = useRef<PlaybackController | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await hearingApi.getProfile();
        if (!cancelled) {
          setConfig(data.config);
          setMissing(false);
        }
      } catch {
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlaying(false);
  }, []);

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
      if (!chainRef.current) {
        chainRef.current = createStereoChain(context, config);
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

  const handleUpload: UploadProps['beforeUpload'] = (file) => {
    fileRef.current = file;
    setFileName(file.name);
    setSource('file');
    return false; // 不真正上传，仅在浏览器本地解码
  };

  if (!loading && missing) {
    return (
      <Card bordered={false}>
        <Empty description="还没有补偿配置，先完成至少一侧的听力自测。">
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

  const ears: Ear[] = ['LEFT', 'RIGHT'];
  const hasBoth = Boolean(config.ears.LEFT && config.ears.RIGHT);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false}>
        <Row gutter={[16, 16]} align="middle">
          <Col flex="auto">
            <Typography.Title level={4} style={{ margin: 0 }}>
              增强预览（双耳独立处理）
            </Typography.Title>
            <Typography.Text type="secondary">
              整体分级：{config.overallGrade.label}
              {hasBoth ? '　·　左右声道分别按左耳/右耳参数处理' : '　·　当前只有单侧参数，另一侧直通'}
            </Typography.Text>
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

        <Space style={{ marginTop: 16 }} wrap>
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
          <Upload beforeUpload={handleUpload} showUploadList={false} accept="audio/*">
            <Button>选择音频文件</Button>
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
          本地音频不会上传到服务器，全程在浏览器内解码与处理。立体声素材会按声道拆分，左声道走左耳参数、右声道走右耳参数。
        </Typography.Paragraph>
      </Card>

      <Card bordered={false} title="当前双耳增强链频率响应">
        <ResponseCurveChart config={config} />
      </Card>

      <Row gutter={[16, 16]}>
        {ears.map((ear) => {
          const earConfig = config.ears[ear];
          return (
            <Col xs={24} lg={12} key={ear}>
              <Card
                bordered={false}
                title={
                  <Space>
                    <Tag color={ear === 'LEFT' ? 'blue' : 'red'}>{EAR_LABELS[ear]}</Tag>
                    <span>{earConfig ? earConfig.grade.label : '未测听（直通）'}</span>
                  </Space>
                }
              >
                <Table
                  size="small"
                  rowKey="frequency"
                  pagination={false}
                  columns={bandColumns}
                  dataSource={earConfig?.eqBands ?? []}
                  locale={{ emptyText: '该侧未测听，不做补偿' }}
                />
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card bordered={false} title="动态处理参数（双耳共用）">
        <Table
          size="small"
          pagination={false}
          columns={[
            { title: '环节', dataIndex: 'stage' },
            { title: '阈值', dataIndex: 'threshold' },
            { title: '压缩比', dataIndex: 'ratio' },
          ]}
          dataSource={[
            {
              key: 'compressor',
              stage: '压缩器',
              threshold: `${config.ears.LEFT?.compressor.thresholdDb ?? -24} dB`,
              ratio: `${config.ears.LEFT?.compressor.ratio ?? 2}:1`,
            },
            {
              key: 'limiter',
              stage: '限幅器',
              threshold: `${config.ears.LEFT?.limiter.thresholdDb ?? -3} dB`,
              ratio: `${config.ears.LEFT?.limiter.ratio ?? 20}:1`,
            },
          ]}
        />
      </Card>

      <Alert
        type="info"
        showIcon
        message="下一步：系统级实时处理"
        description="当前版本在浏览器内完成双耳处理与 AB 对比。让 Windows 所有声音都经过处理，需要额外的桌面端（WASAPI 环回或 APO/虚拟声卡），它读取的正是这里的同一份双耳配置 JSON。"
      />
    </Space>
  );
}
