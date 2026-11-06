import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { createStereoChain } from '../audio/enhancementChain';
import {
  effectiveGainDb,
  type CompensationConfig,
  type Ear,
  type FrequencyThreshold,
} from '@hearlink/domain';

const EAR_COLORS: Record<Ear, string> = {
  LEFT: '#1677ff',
  RIGHT: '#cf1322',
};

const EAR_NAMES: Record<Ear, string> = {
  LEFT: '左耳',
  RIGHT: '右耳',
};

const CHART_STYLE = { height: 320, width: '100%' };

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
}

/** 收集多个来源出现过的频点，用于对齐 x 轴。 */
function collectFrequencies(
  left: FrequencyThreshold[] | null,
  right: FrequencyThreshold[] | null,
): number[] {
  const set = new Set<number>();
  for (const item of left ?? []) set.add(item.frequency);
  for (const item of right ?? []) set.add(item.frequency);
  return [...set].sort((a, b) => a - b);
}

function alignThresholds(
  audiogram: FrequencyThreshold[] | null,
  frequencies: number[],
): Array<number | null> {
  return frequencies.map((frequency) => {
    const found = audiogram?.find((item) => item.frequency === frequency);
    return found ? found.thresholdDbHl : null;
  });
}

export interface AudiogramChartProps {
  left: FrequencyThreshold[] | null;
  right: FrequencyThreshold[] | null;
}

/** 听力图：右耳红圈、左耳蓝方，纵轴反向 dB HL（越往下越差）。 */
export function AudiogramChart({ left, right }: AudiogramChartProps) {
  const option = useMemo<EChartsOption>(() => {
    const frequencies = collectFrequencies(left, right);
    const labels = frequencies.map((frequency) => formatFrequency(frequency));

    const series: NonNullable<EChartsOption['series']> = [
      {
        name: '正常上限',
        type: 'line',
        data: labels.map(() => 20),
        symbol: 'none',
        silent: true,
        lineStyle: { type: 'dashed', color: '#52c41a', width: 1.5 },
        markArea: {
          silent: true,
          itemStyle: { color: 'rgba(82,196,26,0.10)' },
          data: [[{ yAxis: 0 }, { yAxis: 20 }]],
        },
      },
    ];

    if (right) {
      series.push({
        name: EAR_NAMES.RIGHT,
        type: 'line',
        data: alignThresholds(right, frequencies),
        connectNulls: false,
        symbol: 'circle',
        symbolSize: 9,
        itemStyle: { color: EAR_COLORS.RIGHT },
        lineStyle: { color: EAR_COLORS.RIGHT, width: 2 },
      });
    }

    if (left) {
      series.push({
        name: EAR_NAMES.LEFT,
        type: 'line',
        data: alignThresholds(left, frequencies),
        connectNulls: false,
        symbol: 'rect',
        symbolSize: 9,
        itemStyle: { color: EAR_COLORS.LEFT },
        lineStyle: { color: EAR_COLORS.LEFT, width: 2, type: 'dashed' },
      });
    }

    return {
      grid: { left: 60, right: 24, top: 40, bottom: 52 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      xAxis: {
        type: 'category',
        data: labels,
        name: '频率 (Hz)',
        nameLocation: 'middle',
        nameGap: 32,
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: 'value',
        inverse: true,
        min: -10,
        max: 110,
        interval: 10,
        name: 'dB HL',
      },
      series,
    };
  }, [left, right]);

  return <ReactECharts option={option} style={CHART_STYLE} notMerge />;
}

export interface GainCurveChartProps {
  left: CompensationConfig['ears']['LEFT'];
  right: CompensationConfig['ears']['RIGHT'];
}

/**
 * 有效补偿增益：在 6 个测听频点上，整条 EQ 链**实际**产生的增益
 * （含相邻频带叠加与前置增益），与试听 / 导出听到的效果一致。
 */
export function GainCurveChart({ left, right }: GainCurveChartProps) {
  const option = useMemo<EChartsOption>(() => {
    // 用该档案实际测过的频点（标准 6 点 / 精细 9 点）
    const frequencies = collectFrequencies(left?.audiogram ?? null, right?.audiogram ?? null);
    const labels = frequencies.map((frequency) => formatFrequency(frequency));

    const pick = (ear: CompensationConfig['ears']['LEFT']) =>
      ear
        ? frequencies.map((frequency) => Number(effectiveGainDb(ear, frequency).toFixed(1)))
        : [];

    const series: NonNullable<EChartsOption['series']> = [];
    if (left) {
      series.push({
        name: EAR_NAMES.LEFT,
        type: 'line',
        data: pick(left),
        symbol: 'rect',
        symbolSize: 8,
        itemStyle: { color: EAR_COLORS.LEFT },
        lineStyle: { color: EAR_COLORS.LEFT, width: 2, type: 'dashed' },
      });
    }
    if (right) {
      series.push({
        name: EAR_NAMES.RIGHT,
        type: 'line',
        data: pick(right),
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: EAR_COLORS.RIGHT },
        lineStyle: { color: EAR_COLORS.RIGHT, width: 2 },
      });
    }

    return {
      grid: { left: 60, right: 24, top: 40, bottom: 52 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      xAxis: {
        type: 'category',
        data: labels,
        name: '频率 (Hz)',
        nameLocation: 'middle',
        nameGap: 32,
        axisTick: { alignWithLabel: true },
      },
      yAxis: { type: 'value', min: 0, max: 32, name: '有效增益 (dB)' },
      series,
    };
  }, [left, right]);

  return <ReactECharts option={option} style={CHART_STYLE} notMerge />;
}

/** 实测双耳频率响应：来自 BiquadFilterNode.getFrequencyResponse，不是示意图。 */
export function ResponseCurveChart({ config }: { config: CompensationConfig }) {
  const [points, setPoints] = useState<Record<Ear, Array<[number, number]>>>({
    LEFT: [],
    RIGHT: [],
  });

  useEffect(() => {
    let cancelled = false;
    const offline = new OfflineAudioContext(1, 128, 48000);
    const stereo = createStereoChain(offline, config);

    const frequencies: number[] = [];
    for (let frequency = 100; frequency <= 16000; frequency *= Math.pow(2, 1 / 12)) {
      frequencies.push(Math.round(frequency));
    }
    const gains = stereo.measureResponseDb(frequencies);

    if (!cancelled) {
      const toPairs = (values: number[]) =>
        frequencies.map((frequency, index) => [frequency, Number(values[index].toFixed(2))] as [number, number]);
      setPoints({ LEFT: toPairs(gains.LEFT), RIGHT: toPairs(gains.RIGHT) });
    }
    stereo.dispose();

    return () => {
      cancelled = true;
    };
  }, [config]);

  const option = useMemo<EChartsOption>(() => {
    const series: NonNullable<EChartsOption['series']> = [];
    const ears: Ear[] = ['LEFT', 'RIGHT'];

    for (const ear of ears) {
      if (points[ear].length === 0) continue;
      series.push({
        name: EAR_NAMES[ear],
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: points[ear],
        lineStyle: { color: EAR_COLORS[ear], width: 2 },
        areaStyle: { color: ear === 'LEFT' ? 'rgba(22,119,255,0.08)' : 'rgba(207,19,34,0.08)' },
      });
    }

    return {
      grid: { left: 60, right: 24, top: 40, bottom: 52 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      xAxis: {
        type: 'log',
        min: 100,
        max: 16000,
        name: '频率 (Hz)',
        nameLocation: 'middle',
        nameGap: 32,
      },
      yAxis: { type: 'value', name: '相对增益 (dB)' },
      series,
    };
  }, [points]);

  return <ReactECharts option={option} style={CHART_STYLE} notMerge />;
}
